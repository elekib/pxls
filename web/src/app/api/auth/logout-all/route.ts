import { getAuth } from "@/lib/auth";
import { requireApi } from "@/lib/auth/api";
import { cleared, json } from "@/lib/auth/http";
import { nowSecs } from "@/lib/auth/service";

export async function POST(req: Request) {
  const me = await requireApi(req);
  if (me instanceof Response) return me;
  const n = getAuth().store.revokeUserSessions(me.user.id, null, nowSecs(), "logout-all");
  console.warn("[security] logout everywhere", JSON.stringify({ user: me.user.username, sessions: n }));
  return cleared(json(200, { success: true }), req.headers);
}
