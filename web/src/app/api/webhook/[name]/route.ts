// The public receiver. Senders authenticate with the webhook's own secret;
// unknown webhooks and wrong secrets get the same 401, so names can't be probed.

import { getDb } from "@/lib/db/sqlite";
import { json } from "@/lib/auth/http";
import { actionContext } from "@/lib/webhooks/context";
import { extractWebhookSecret, ingestWebhook, webhookSecretOk } from "@/lib/webhooks/receiver";
import { findWebhook, loadWebhooks } from "@/lib/webhooks/store";
import type { Json } from "@/lib/webhooks/model";

export async function POST(req: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  const provided = extractWebhookSecret(req.headers, new URL(req.url).search);
  let authorized = false;
  try {
    const w = findWebhook(loadWebhooks(getDb()), name);
    authorized = !!w && webhookSecretOk(w.secret, provided);
  } catch (e) {
    console.warn(`[webhook] failed to load webhooks for authentication: ${(e as Error).message}`);
  }
  if (!authorized) {
    console.warn(`[webhook] rejected ${JSON.stringify(name)}: unknown webhook or missing/invalid secret`);
    return json(401, { success: false, error: "Unauthorized" });
  }
  let payload: Json;
  try {
    payload = JSON.parse(await req.text()) as Json;
  } catch {
    return json(400, { success: false, error: "Request body must be valid JSON" });
  }
  const r = await ingestWebhook(getDb(), name, payload, actionContext());
  return json(r.status, r.body);
}
