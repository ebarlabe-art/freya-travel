import {
  rawPayload,
  sendPushNotification,
  type PushSubscriptionData,
  type VapidConfig,
  WebPushError,
} from "standards-web-push";
import { createClient, type SupabaseClient } from "supabase-js";

const BATCH_SIZE = 10;
const LEASE_SECONDS = 600;
const MAX_ATTEMPTS = 3;
const FIRST_RETRY_DELAY_MS = 5 * 60 * 1000;
const SECOND_RETRY_DELAY_MS = 15 * 60 * 1000;
const MAX_LATE_MS = 45 * 60 * 1000;
const PUSH_TIMEOUT_MS = 15 * 1000;
const ITINERARY_URL =
  "https://ebarlabe-art.github.io/freya-travel/freya-travel-v1.5/itinerary.html";

type DeliveryStatus = "retry" | "sent" | "gone" | "failed" | "missed";

type NotificationDeliveryRow = {
  id: string;
  activity_id: string;
  subscription_id: string;
  notification_kind: string;
  scheduled_for: string;
  attempt_count: number;
};

type ItineraryActivityRow = {
  id: string;
  stable_activity_id: string;
  title: string;
  starts_at: string;
  notifications_enabled: boolean;
  notify_before_minutes: number;
};

type PushSubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  active: boolean;
};

type WorkerSummary = {
  claimed: number;
  sent: number;
  retry: number;
  gone: number;
  failed: number;
  missed: number;
};

type DeliveryUpdate = {
  status: DeliveryStatus;
  next_attempt_at: string | null;
  lease_until: null;
  sent_at: string | null;
  last_error_code: string | null;
  updated_at: string;
};

type PushFailure = {
  code: string;
  transient: boolean;
};

function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function tokensMatch(received: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [receivedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(received)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(receivedHash);
  const right = new Uint8Array(expectedHash);
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

function getSupabaseAdminKey(): string | null {
  const legacyServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacyServiceRoleKey) return legacyServiceRoleKey;

  const localSecretKey = Deno.env.get("SUPABASE_SECRET_KEY");
  if (localSecretKey) return localSecretKey;

  const serializedSecretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!serializedSecretKeys) return null;
  try {
    const secretKeys = JSON.parse(serializedSecretKeys) as Record<string, unknown>;
    return typeof secretKeys.default === "string" ? secretKeys.default : null;
  } catch (_) {
    return null;
  }
}

function reminderLead(minutes: number): string {
  if (minutes === 60) return "D'aquí a 1 hora";
  if (minutes > 60 && minutes % 60 === 0) return `D'aquí a ${minutes / 60} hores`;
  if (minutes === 1) return "D'aquí a 1 minut";
  return `D'aquí a ${minutes} minuts`;
}

function deliveryDeadline(delivery: NotificationDeliveryRow, activity: ItineraryActivityRow): number {
  const startsAt = Date.parse(activity.starts_at);
  const scheduledFor = Date.parse(delivery.scheduled_for);
  if (!Number.isFinite(startsAt) || !Number.isFinite(scheduledFor)) return Number.NaN;
  return Math.min(startsAt, scheduledFor + MAX_LATE_MS);
}

function classifyPushFailure(error: unknown): PushFailure {
  if (error instanceof WebPushError) {
    if (
      error.statusCode === 408 ||
      error.statusCode === 425 ||
      error.statusCode === 429 ||
      error.statusCode >= 500
    ) {
      return {
        code: error.statusCode === 429 ? "push-rate-limited" : "push-provider-transient",
        transient: true,
      };
    }
    return { code: "push-provider-rejected", transient: false };
  }

  if (
    error instanceof TypeError ||
    (error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError"))
  ) {
    return { code: "push-network-error", transient: true };
  }

  return { code: "push-invalid-config-or-data", transient: false };
}

async function updateDelivery(
  admin: SupabaseClient,
  delivery: NotificationDeliveryRow,
  update: DeliveryUpdate,
): Promise<void> {
  const { data, error } = await admin
    .from("notification_deliveries")
    .update(update)
    .eq("id", delivery.id)
    .eq("status", "processing")
    .eq("attempt_count", delivery.attempt_count)
    .select("id")
    .maybeSingle();
  if (error || !data) throw new Error("delivery-update-failed");
}

async function finishDelivery(
  admin: SupabaseClient,
  delivery: NotificationDeliveryRow,
  status: Exclude<DeliveryStatus, "retry" | "sent">,
  errorCode: string,
): Promise<DeliveryStatus> {
  await updateDelivery(admin, delivery, {
    status,
    next_attempt_at: null,
    lease_until: null,
    sent_at: null,
    last_error_code: errorCode,
    updated_at: new Date().toISOString(),
  });
  return status;
}

async function finishSent(
  admin: SupabaseClient,
  delivery: NotificationDeliveryRow,
): Promise<DeliveryStatus> {
  const sentAt = new Date().toISOString();
  await updateDelivery(admin, delivery, {
    status: "sent",
    next_attempt_at: null,
    lease_until: null,
    sent_at: sentAt,
    last_error_code: null,
    updated_at: sentAt,
  });
  return "sent";
}

async function finishPushFailure(
  admin: SupabaseClient,
  delivery: NotificationDeliveryRow,
  activity: ItineraryActivityRow,
  failure: PushFailure,
): Promise<DeliveryStatus> {
  if (!failure.transient || delivery.attempt_count >= MAX_ATTEMPTS) {
    return finishDelivery(admin, delivery, "failed", failure.code);
  }

  const now = Date.now();
  const delay = delivery.attempt_count === 1 ? FIRST_RETRY_DELAY_MS : SECOND_RETRY_DELAY_MS;
  const nextAttemptAt = now + delay;
  const deadline = deliveryDeadline(delivery, activity);
  if (!Number.isFinite(deadline) || nextAttemptAt >= deadline) {
    return finishDelivery(admin, delivery, "missed", "retry-window-expired");
  }

  await updateDelivery(admin, delivery, {
    status: "retry",
    next_attempt_at: new Date(nextAttemptAt).toISOString(),
    lease_until: null,
    sent_at: null,
    last_error_code: failure.code,
    updated_at: new Date(now).toISOString(),
  });
  return "retry";
}

async function processDelivery(
  admin: SupabaseClient,
  delivery: NotificationDeliveryRow,
  activity: ItineraryActivityRow | undefined,
  pushSubscription: PushSubscriptionRow | undefined,
  vapid: VapidConfig,
): Promise<DeliveryStatus> {
  if (delivery.attempt_count > MAX_ATTEMPTS) {
    return finishDelivery(admin, delivery, "failed", "max-attempts-exceeded");
  }
  if (delivery.notification_kind !== "activity-1h") {
    return finishDelivery(admin, delivery, "failed", "unsupported-notification-kind");
  }
  if (!activity) return finishDelivery(admin, delivery, "failed", "activity-not-found");
  if (!pushSubscription) {
    return finishDelivery(admin, delivery, "gone", "subscription-not-found");
  }
  if (!pushSubscription.active) {
    return finishDelivery(admin, delivery, "gone", "subscription-inactive");
  }
  if (!activity.notifications_enabled) {
    return finishDelivery(admin, delivery, "missed", "notifications-disabled");
  }

  const deadline = deliveryDeadline(delivery, activity);
  if (!Number.isFinite(deadline)) {
    return finishDelivery(admin, delivery, "failed", "invalid-activity-time");
  }
  if (Date.now() >= deadline) {
    return finishDelivery(admin, delivery, "missed", "delivery-expired");
  }

  const navigate = `${ITINERARY_URL}?activity=${encodeURIComponent(activity.stable_activity_id)}`;
  const payload = {
    notification: {
      title: "Freya Travel",
      body: `${reminderLead(activity.notify_before_minutes)}: ${activity.title}`,
      navigate,
    },
  };
  const subscription: PushSubscriptionData = {
    endpoint: pushSubscription.endpoint,
    keys: { p256dh: pushSubscription.p256dh, auth: pushSubscription.auth },
  };
  const ttl = Math.max(60, Math.min(86400, Math.floor((Date.parse(activity.starts_at) - Date.now()) / 1000)));

  let delivered: boolean;
  try {
    delivered = await sendPushNotification(
      subscription,
      rawPayload(JSON.stringify(payload)),
      vapid,
      { ttl, timeoutMs: PUSH_TIMEOUT_MS, urgency: "normal" },
    );
  } catch (error) {
    return finishPushFailure(admin, delivery, activity, classifyPushFailure(error));
  }

  if (delivered) return finishSent(admin, delivery);

  const { error: deactivateError } = await admin
    .from("push_subscriptions")
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("id", pushSubscription.id);
  if (deactivateError) {
    return finishPushFailure(admin, delivery, activity, {
      code: "subscription-disable-failed",
      transient: true,
    });
  }
  return finishDelivery(admin, delivery, "gone", "subscription-gone");
}

async function handleRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(null, {
      status: 405,
      headers: { Allow: "POST", "Cache-Control": "no-store" },
    });
  }

  const cronToken = Deno.env.get("ITINERARY_CRON_TOKEN");
  const suppliedToken = request.headers.get("x-itinerary-cron-token");
  if (!cronToken || !suppliedToken || !(await tokensMatch(suppliedToken, cronToken))) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const rawRequestBody = await request.text();
  if (rawRequestBody.trim()) {
    let requestBody: unknown;
    try {
      requestBody = JSON.parse(rawRequestBody);
    } catch (_) {
      return jsonResponse({ error: "Invalid request body" }, 400);
    }
    if (
      !requestBody ||
      typeof requestBody !== "object" ||
      Array.isArray(requestBody) ||
      Object.keys(requestBody).length !== 0
    ) {
      return jsonResponse({ error: "Request body must be empty" }, 400);
    }
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const adminKey = getSupabaseAdminKey();
  const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT");
  if (!supabaseUrl || !adminKey || !vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    return jsonResponse({ error: "Function is not configured" }, 500);
  }

  const admin = createClient(supabaseUrl, adminKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: claimData, error: claimError } = await admin.rpc(
    "claim_notification_deliveries",
    { p_batch_size: BATCH_SIZE, p_lease_seconds: LEASE_SECONDS },
  );
  if (claimError) return jsonResponse({ error: "Unable to claim deliveries" }, 500);

  const deliveries = (claimData ?? []) as NotificationDeliveryRow[];
  const summary: WorkerSummary = {
    claimed: deliveries.length,
    sent: 0,
    retry: 0,
    gone: 0,
    failed: 0,
    missed: 0,
  };
  if (deliveries.length === 0) return jsonResponse(summary, 200);

  const activityIds = [...new Set(deliveries.map((delivery) => delivery.activity_id))];
  const subscriptionIds = [...new Set(deliveries.map((delivery) => delivery.subscription_id))];
  const [{ data: activityData, error: activityError }, { data: subscriptionData, error: subscriptionError }] =
    await Promise.all([
      admin
        .from("itinerary_activities")
        .select("id,stable_activity_id,title,starts_at,notifications_enabled,notify_before_minutes")
        .in("id", activityIds),
      admin
        .from("push_subscriptions")
        .select("id,endpoint,p256dh,auth,active")
        .in("id", subscriptionIds),
    ]);
  if (activityError || subscriptionError) {
    return jsonResponse({ error: "Unable to load claimed deliveries" }, 500);
  }

  const activities = new Map(
    ((activityData ?? []) as ItineraryActivityRow[]).map((activity) => [activity.id, activity]),
  );
  const subscriptions = new Map(
    ((subscriptionData ?? []) as PushSubscriptionRow[]).map((subscription) => [subscription.id, subscription]),
  );
  const vapid: VapidConfig = {
    subject: vapidSubject,
    publicKey: vapidPublicKey,
    privateKey: vapidPrivateKey,
  };

  const outcomes = await Promise.all(
    deliveries.map(async (delivery): Promise<DeliveryStatus | null> => {
      try {
        return await processDelivery(
          admin,
          delivery,
          activities.get(delivery.activity_id),
          subscriptions.get(delivery.subscription_id),
          vapid,
        );
      } catch (_) {
        console.error("Delivery processing failed", {
          deliveryId: delivery.id,
          category: "delivery-processing-error",
        });
        return null;
      }
    }),
  );
  for (const outcome of outcomes) {
    if (outcome) summary[outcome] += 1;
  }
  return jsonResponse(summary, 200);
}

export default { fetch: handleRequest };
