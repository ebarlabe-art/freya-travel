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
const LEGACY_ITINERARY_URL =
  "https://ebarlabe-art.github.io/freya-travel/freya-travel-v1.5/itinerary.html";
const UNIVERSAL_APP_URL =
  "https://ebarlabe-art.github.io/freya-travel/";

type DeliveryStatus = "retry" | "sent" | "gone" | "failed" | "missed";

type NotificationDeliveryRow = {
  id: string;
  activity_id: string | null;
  reminder_id: string | null;
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

type ReminderSourceKind =
  | "flight"
  | "accommodation"
  | "activity"
  | "itinerary_item";

type ReminderKind =
  | "flight_departure"
  | "accommodation_check_in"
  | "accommodation_check_out"
  | "activity_start"
  | "itinerary_exact";

type TripReminderRow = {
  id: string;
  trip_id: string;
  source_kind: ReminderSourceKind;
  source_id: string;
  reminder_kind: ReminderKind;
  title: string;
  event_at: string;
  default_notify_before_minutes: number;
  enabled: boolean;
};

type DeliveryContext = {
  title: string;
  body: string;
  eventAt: string;
  notifyBeforeMinutes: number;
  enabled: boolean;
  disabledErrorCode: string;
  navigate: string;
};

const UNIVERSAL_REMINDER_KINDS = new Set<ReminderKind>([
  "flight_departure",
  "accommodation_check_in",
  "accommodation_check_out",
  "activity_start",
  "itinerary_exact",
]);

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

function universalReminderBody(reminder: TripReminderRow): string {
  const lead = reminderLead(reminder.default_notify_before_minutes);

  switch (reminder.reminder_kind) {
    case "flight_departure":
      return `${lead}: surt el vol ${reminder.title}`;
    case "accommodation_check_in":
      return `${lead}: check-in a ${reminder.title}`;
    case "accommodation_check_out":
      return `${lead}: check-out de ${reminder.title}`;
    case "activity_start":
    case "itinerary_exact":
      return `${lead}: ${reminder.title}`;
  }
}


function buildUniversalNavigate(reminder: TripReminderRow): string {
  const url = new URL(UNIVERSAL_APP_URL);
  url.searchParams.set("view", "itinerary");
  url.searchParams.set("trip", reminder.trip_id);
  url.searchParams.set("source", reminder.source_kind);
  url.searchParams.set("source_id", reminder.source_id);
  url.searchParams.set("reminder", reminder.id);
  url.searchParams.set("kind", reminder.reminder_kind);
  return url.toString();
}

function deliveryDeadline(
  delivery: NotificationDeliveryRow,
  context: DeliveryContext,
): number {
  const eventAt = Date.parse(context.eventAt);
  const scheduledFor = Date.parse(delivery.scheduled_for);
  if (!Number.isFinite(eventAt) || !Number.isFinite(scheduledFor)) return Number.NaN;
  return Math.min(eventAt, scheduledFor + MAX_LATE_MS);
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
  context: DeliveryContext,
  failure: PushFailure,
): Promise<DeliveryStatus> {
  if (!failure.transient || delivery.attempt_count >= MAX_ATTEMPTS) {
    return finishDelivery(admin, delivery, "failed", failure.code);
  }

  const now = Date.now();
  const delay = delivery.attempt_count === 1 ? FIRST_RETRY_DELAY_MS : SECOND_RETRY_DELAY_MS;
  const nextAttemptAt = now + delay;
  const deadline = deliveryDeadline(delivery, context);
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
  reminder: TripReminderRow | undefined,
  pushSubscription: PushSubscriptionRow | undefined,
  vapid: VapidConfig,
): Promise<DeliveryStatus> {
  if (delivery.attempt_count > MAX_ATTEMPTS) {
    return finishDelivery(admin, delivery, "failed", "max-attempts-exceeded");
  }

  const hasLegacySource = delivery.activity_id !== null;
  const hasUniversalSource = delivery.reminder_id !== null;

  if (hasLegacySource === hasUniversalSource) {
    return finishDelivery(admin, delivery, "failed", "invalid-delivery-source");
  }

  let context: DeliveryContext;

  if (hasLegacySource) {
    if (delivery.notification_kind !== "activity-1h") {
      return finishDelivery(admin, delivery, "failed", "unsupported-notification-kind");
    }
    if (!activity) {
      return finishDelivery(admin, delivery, "failed", "activity-not-found");
    }

    context = {
      title: activity.title,
      body: `${reminderLead(activity.notify_before_minutes)}: ${activity.title}`,
      eventAt: activity.starts_at,
      notifyBeforeMinutes: activity.notify_before_minutes,
      enabled: activity.notifications_enabled,
      disabledErrorCode: "notifications-disabled",
      navigate:
        `${LEGACY_ITINERARY_URL}?activity=${encodeURIComponent(activity.stable_activity_id)}`,
    };
  } else {
    if (!reminder) {
      return finishDelivery(admin, delivery, "failed", "reminder-not-found");
    }
    if (!UNIVERSAL_REMINDER_KINDS.has(reminder.reminder_kind)) {
      return finishDelivery(admin, delivery, "failed", "unsupported-reminder-kind");
    }
    if (delivery.notification_kind !== reminder.reminder_kind) {
      return finishDelivery(admin, delivery, "failed", "reminder-kind-mismatch");
    }

    context = {
      title: reminder.title,
      body: universalReminderBody(reminder),
      eventAt: reminder.event_at,
      notifyBeforeMinutes: reminder.default_notify_before_minutes,
      enabled: reminder.enabled,
      disabledErrorCode: "reminder-disabled",
      navigate: buildUniversalNavigate(reminder),
    };
  }

  if (!pushSubscription) {
    return finishDelivery(admin, delivery, "gone", "subscription-not-found");
  }
  if (!pushSubscription.active) {
    return finishDelivery(admin, delivery, "gone", "subscription-inactive");
  }
  if (!context.enabled) {
    return finishDelivery(admin, delivery, "missed", context.disabledErrorCode);
  }

  const deadline = deliveryDeadline(delivery, context);
  if (!Number.isFinite(deadline)) {
    return finishDelivery(admin, delivery, "failed", "invalid-event-time");
  }
  if (Date.now() >= deadline) {
    return finishDelivery(admin, delivery, "missed", "delivery-expired");
  }

  const payload = {
    notification: {
      title: "Freya Travel",
      body: context.body,
      navigate: context.navigate,
    },
  };

  const subscription: PushSubscriptionData = {
    endpoint: pushSubscription.endpoint,
    keys: { p256dh: pushSubscription.p256dh, auth: pushSubscription.auth },
  };

  const ttl = Math.max(
    60,
    Math.min(
      86400,
      Math.floor((Date.parse(context.eventAt) - Date.now()) / 1000),
    ),
  );

  let delivered: boolean;
  try {
    delivered = await sendPushNotification(
      subscription,
      rawPayload(JSON.stringify(payload)),
      vapid,
      { ttl, timeoutMs: PUSH_TIMEOUT_MS, urgency: "normal" },
    );
  } catch (error) {
    return finishPushFailure(
      admin,
      delivery,
      context,
      classifyPushFailure(error),
    );
  }

  if (delivered) return finishSent(admin, delivery);

  const { error: deactivateError } = await admin
    .from("push_subscriptions")
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("id", pushSubscription.id);

  if (deactivateError) {
    return finishPushFailure(admin, delivery, context, {
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
  const { error: syncError } = await admin.rpc("sync_notification_deliveries");
  if (syncError) return jsonResponse({ error: "Unable to synchronize deliveries" }, 500);

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

  const activityIds = [
    ...new Set(
      deliveries.flatMap((delivery) =>
        delivery.activity_id ? [delivery.activity_id] : []
      ),
    ),
  ];
  const reminderIds = [
    ...new Set(
      deliveries.flatMap((delivery) =>
        delivery.reminder_id ? [delivery.reminder_id] : []
      ),
    ),
  ];
  const subscriptionIds = [
    ...new Set(deliveries.map((delivery) => delivery.subscription_id)),
  ];

  let activityData: ItineraryActivityRow[] = [];
  let reminderData: TripReminderRow[] = [];

  if (activityIds.length > 0) {
    const { data, error } = await admin
      .from("itinerary_activities")
      .select(
        "id,stable_activity_id,title,starts_at,notifications_enabled,notify_before_minutes",
      )
      .in("id", activityIds);

    if (error) {
      return jsonResponse({ error: "Unable to load legacy activities" }, 500);
    }
    activityData = (data ?? []) as ItineraryActivityRow[];
  }

  if (reminderIds.length > 0) {
    const { data, error } = await admin
      .from("trip_reminders")
      .select(
        "id,trip_id,source_kind,source_id,reminder_kind,title,event_at,default_notify_before_minutes,enabled",
      )
      .in("id", reminderIds);

    if (error) {
      return jsonResponse({ error: "Unable to load universal reminders" }, 500);
    }
    reminderData = (data ?? []) as TripReminderRow[];
  }

  const { data: subscriptionData, error: subscriptionError } = await admin
    .from("push_subscriptions")
    .select("id,endpoint,p256dh,auth,active")
    .in("id", subscriptionIds);

  if (subscriptionError) {
    return jsonResponse({ error: "Unable to load push subscriptions" }, 500);
  }

  const activities = new Map(
    activityData.map((activity) => [activity.id, activity]),
  );
  const reminders = new Map(
    reminderData.map((reminder) => [reminder.id, reminder]),
  );
  const subscriptions = new Map(
    ((subscriptionData ?? []) as PushSubscriptionRow[]).map(
      (subscription) => [subscription.id, subscription],
    ),
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
          delivery.activity_id
            ? activities.get(delivery.activity_id)
            : undefined,
          delivery.reminder_id
            ? reminders.get(delivery.reminder_id)
            : undefined,
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
