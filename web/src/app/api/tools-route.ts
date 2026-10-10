import { requireApi } from "@/lib/auth/api";
import { json, readJson } from "@/lib/auth/http";
import type { ToolResult } from "@/lib/tools/service";

/** POST handler for a tool command: admin only, JSON body, Rust response shapes. */
export function toolRoute(run: (body: Record<string, unknown>) => Promise<ToolResult>) {
  return async (req: Request) => {
    const me = await requireApi(req);
    if (me instanceof Response) return me;
    const body = (await readJson<Record<string, unknown>>(req)) ?? {};
    const r = await run(typeof body === "object" && body ? body : {});
    return r.ok ? json(200, r.body) : json(r.status, { error: r.error });
  };
}
