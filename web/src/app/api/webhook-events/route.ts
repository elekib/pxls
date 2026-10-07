import { listEvents } from "@/lib/webhooks/admin";
import { handler } from "../webhook-admin";

export const dynamic = "force-dynamic";
export const GET = handler((_p, _b, req) => {
  const q = new URL(req.url).searchParams;
  const limit = q.get("limit");
  return listEvents(q.get("webhook_name"), limit !== null && /^\d+$/.test(limit) ? Number(limit) : null);
});
