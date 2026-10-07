import { getAuth } from "@/lib/auth";
import { requireApi } from "@/lib/auth/api";
import { json } from "@/lib/auth/http";
import { nowSecs } from "@/lib/auth/service";
import { parseId, userError } from "../../errors";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const me = await requireApi(req);
  if (me instanceof Response) return me;
  const id = parseId((await ctx.params).id);
  if (!id) return userError("not-found");
  return json(200, { success: true, sessions: getAuth().store.listSessions(id, nowSecs()) });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const me = await requireApi(req);
  if (me instanceof Response) return me;
  const id = parseId((await ctx.params).id);
  if (!id) return userError("not-found");
  const n = getAuth().store.revokeUserSessions(id, null, nowSecs(), "revoked-by-admin");
  console.warn("[security] sessions revoked by admin", JSON.stringify({ admin: me.user.username, user_id: id, sessions: n }));
  return json(200, { success: true, revoked: n });
}
