import { getAuth } from "@/lib/auth";
import { requireApi } from "@/lib/auth/api";
import { error, json } from "@/lib/auth/http";
import { nowSecs } from "@/lib/auth/service";

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await requireApi(req);
  if (me instanceof Response) return me;
  const { id } = await ctx.params;
  return getAuth().store.revokeSession(me.user.id, id, nowSecs(), "revoked-by-user")
    ? json(200, { success: true })
    : error(404, "Session not found");
}
