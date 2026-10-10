import { requireApi } from "@/lib/auth/api";
import { json } from "@/lib/auth/http";
import type { Result } from "@/lib/webhooks/admin";

type Params = Record<string, string>;

/** Authenticated handler returning a webhook admin Result. */
export function handler(run: (p: Params, body: Record<string, unknown>, req: Request) => Result | Promise<Result>) {
  return async (req: Request, ctx: { params: Promise<Params> }) => {
    const me = await requireApi(req);
    if (me instanceof Response) return me;
    // Some POSTs (replay, clear) carry no body; only malformed JSON is an error.
    let body: Record<string, unknown> = {};
    if (req.method !== "GET" && req.method !== "DELETE") {
      const text = await req.text();
      if (text.trim()) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          return json(400, { success: false, error: "Request body must be valid JSON" });
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return json(400, { success: false, error: "Request body must be a JSON object" });
        }
        body = parsed as Record<string, unknown>;
      }
    }
    const r = await run(await ctx.params, body, req);
    return json(r.status, r.body);
  };
}
