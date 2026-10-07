import { testRules } from "@/lib/webhooks/admin";
import { handler } from "../../../../webhook-admin";

export const POST = handler((p, b) => testRules(p.name, b));
