import { getAuth } from "@/lib/auth";
import { requireApi } from "@/lib/auth/api";
import { json } from "@/lib/auth/http";
import { nowSecs } from "@/lib/auth/service";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const me = await requireApi(req);
  if (me instanceof Response) return me;
  const sessions = getAuth()
    .store.listSessions(me.user.id, nowSecs())
    .map((s) => ({ ...s, current: s.id === me.sessionId }));
  return json(200, { success: true, sessions });
}
