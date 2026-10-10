// Re-run a logged event's payload through its webhook as a new delivery.

import { getDb } from "@/lib/db/sqlite";
import { actionContext } from "@/lib/webhooks/context";
import { ingestWebhook } from "@/lib/webhooks/receiver";
import { recentEvents } from "@/lib/webhooks/store";
import { handler } from "../../../webhook-admin";

export const POST = handler(async (p) => {
  const event = recentEvents(getDb(), null, null).find((e) => e.id === p.event_id);
  if (!event) return { status: 404, body: { success: false, error: `Event '${p.event_id}' not found` } };
  return ingestWebhook(getDb(), event.webhook_name, event.payload, actionContext());
});
