import { reorderRules } from "@/lib/webhooks/admin";
import { handler } from "../../../webhook-admin";

export const PUT = handler((p, b) => reorderRules(p.name, b));
