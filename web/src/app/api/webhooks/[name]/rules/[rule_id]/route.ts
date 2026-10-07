import { deleteRule, updateRule } from "@/lib/webhooks/admin";
import { handler } from "../../../../webhook-admin";

export const PUT = handler((p, b) => updateRule(p.name, p.rule_id, b));
export const DELETE = handler((p) => deleteRule(p.name, p.rule_id));
