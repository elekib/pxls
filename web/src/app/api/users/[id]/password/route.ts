import { getAuth } from "@/lib/auth";
import { requireApi } from "@/lib/auth/api";
import { error, json, readJson } from "@/lib/auth/http";
import { parseId, userError } from "../../errors";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await requireApi(req);
  if (me instanceof Response) return me;
  const id = parseId((await ctx.params).id);
  const target = id ? getAuth().store.getUser(id) : null;
  if (!target) return userError("not-found");
  const body = await readJson<{ new_password?: unknown }>(req);
  if (typeof body?.new_password !== "string") return error(400, "Invalid request");
  const r = await getAuth().adminSetPassword(target, body.new_password);
  if (!r.ok) return error(400, r.message!);
  console.warn("[security] password reset; sessions revoked", JSON.stringify({ admin: me.user.username, user: target.username }));
  return json(200, { success: true });
}
