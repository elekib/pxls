import { clearWebhookEvents } from "@/lib/webhooks/admin";
import { handler } from "../../../webhook-admin";

export const POST = handler((p) => clearWebhookEvents(p.webhook_name));
