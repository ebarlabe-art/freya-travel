// @deno-types="npm:@types/web-push@3.6.4"
import webPush from "web-push";
import { createClient } from "supabase-js";

const TEST_NOTIFICATION = {
  notification: {
    title: "Freya Travel",
    body: "Aquesta és una notificació de prova.",
    navigate: "https://ebarlabe-art.github.io/freya-travel/",
  },
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PushSubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  active: boolean;
};

type PushServiceError = Error & {
  statusCode?: number;
};

function jsonResponse(body: Record<string, unknown>, status: number): Response {
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

  const serializedSecretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!serializedSecretKeys) return null;
  try {
    const secretKeys = JSON.parse(serializedSecretKeys) as Record<string, unknown>;
    return typeof secretKeys.default === "string" ? secretKeys.default : null;
  } catch (_) {
    return null;
  }
}

async function handleRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(null, {
      status: 405,
      headers: { Allow: "POST", "Cache-Control": "no-store" },
    });
  }

  const pushTestToken = Deno.env.get("PUSH_TEST_TOKEN");
  const suppliedToken = request.headers.get("x-push-test-token");
  if (!pushTestToken || !suppliedToken || !(await tokensMatch(suppliedToken, pushTestToken))) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return jsonResponse({ error: "Content-Type must be application/json" }, 415);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (_) {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    !("subscription_id" in body) ||
    typeof body.subscription_id !== "string" ||
    !UUID_PATTERN.test(body.subscription_id)
  ) {
    return jsonResponse({ error: "Body must contain only a valid subscription_id" }, 400);
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
  const { data, error } = await admin
    .from("push_subscriptions")
    .select("id,endpoint,p256dh,auth,active")
    .eq("id", body.subscription_id)
    .maybeSingle<PushSubscriptionRow>();

  if (error) {
    return jsonResponse({ error: "Unable to read subscription" }, 500);
  }
  if (!data) {
    return jsonResponse({ error: "Subscription not found" }, 404);
  }
  if (!data.active) {
    return jsonResponse({ error: "Subscription is inactive" }, 409);
  }

  try {
    webPush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  } catch (_) {
    return jsonResponse({ error: "Function is not configured" }, 500);
  }

  try {
    await webPush.sendNotification(
      {
        endpoint: data.endpoint,
        keys: { p256dh: data.p256dh, auth: data.auth },
      },
      JSON.stringify(TEST_NOTIFICATION),
      { TTL: 60 },
    );
    return jsonResponse({ ok: true }, 200);
  } catch (caught) {
    const statusCode = (caught as PushServiceError)?.statusCode;
    if (statusCode === 404 || statusCode === 410) {
      const { error: updateError } = await admin
        .from("push_subscriptions")
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq("id", data.id);
      if (updateError) {
        return jsonResponse({ error: "Unable to disable expired subscription" }, 500);
      }
      return jsonResponse({ error: "Subscription expired and was disabled" }, 410);
    }
    return jsonResponse({ error: "Push delivery failed" }, 502);
  }
}

export default { fetch: handleRequest };
