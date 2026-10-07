import { createWebhook, listWebhooks } from "@/lib/webhooks/admin";
import { handler } from "../webhook-admin";

export const dynamic = "force-dynamic";
export const GET = handler(() => listWebhooks());
export const POST = handler((_p, b) => createWebhook(b));
