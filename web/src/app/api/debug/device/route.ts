// Admin device test endpoint, off unless PXLS_ENABLE_DEBUG=1.

import { requireApi } from "@/lib/auth/api";
import { getEngine } from "@/lib/engine/engine";
import { apply, command } from "@/lib/engine/commands";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const me = await requireApi(req);
  if (me instanceof Response) return me;
  const engine = getEngine();
  if (!engine.config.debug) return Response.json({ error: "debug is disabled" }, { status: 403 });
  // JSON only: other sites cannot send it cross-origin without a CORS
  // preflight, which this app never allows.
  if (!req.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ error: "expected application/json" }, { status: 415 });
  }

  const parsed = command.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid command" }, { status: 400 });

  try {
    await engine.run((p) => apply(p, parsed.data));
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "send failed" }, { status: 503 });
  }
}
