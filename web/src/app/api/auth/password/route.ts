import { getAuth } from "@/lib/auth";
import { requireApi } from "@/lib/auth/api";
import { cleared, clientIp, error, json, readJson, throttled } from "@/lib/auth/http";

export async function POST(req: Request) {
  const me = await requireApi(req);
  if (me instanceof Response) return me;
  const body = await readJson<{ current_password?: unknown; new_password?: unknown }>(req);
  if (typeof body?.current_password !== "string" || typeof body.new_password !== "string") return error(400, "Invalid request");
  const r = await getAuth().changePassword(me.user, body.current_password, body.new_password, clientIp(req.headers));
  if (r.ok) return cleared(json(200, { success: true }), req.headers);
  if (r.error === "wrong-current") return error(403, "Current password is incorrect");
  if (r.error === "throttled") return throttled(r.retryAfter!);
  return error(400, r.message!);
}
