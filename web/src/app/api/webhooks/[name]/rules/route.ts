import { createRule, listRules } from "@/lib/webhooks/admin";
import { handler } from "../../../webhook-admin";

export const dynamic = "force-dynamic";
export const GET = handler((p) => listRules(p.name));
export const POST = handler((p, b) => createRule(p.name, b));
