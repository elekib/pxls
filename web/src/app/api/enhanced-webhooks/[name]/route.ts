import { deleteWebhook, getWebhook, updateWebhook } from "@/lib/webhooks/admin";
import { handler } from "../../webhook-admin";

export const dynamic = "force-dynamic";
export const GET = handler((p) => getWebhook(p.name));
export const PUT = handler((p, b) => updateWebhook(p.name, b));
export const DELETE = handler((p) => deleteWebhook(p.name));
