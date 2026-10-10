import { eventsSummary } from "@/lib/webhooks/admin";
import { handler } from "../../webhook-admin";

export const dynamic = "force-dynamic";
export const GET = handler(() => eventsSummary());
