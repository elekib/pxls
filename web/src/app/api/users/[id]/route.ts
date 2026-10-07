import { getAuth } from "@/lib/auth";
import { requireApi } from "@/lib/auth/api";
import { error, json, readJson } from "@/lib/auth/http";
import { nowSecs } from "@/lib/auth/service";
import { parseId, userError } from "../errors";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const me = await requireApi(req);
  if (me instanceof Response) return me;
  const id = parseId((await ctx.params).id);
  if (!id) return userError("not-found");
  const body = await readJson<{ role?: unknown; disabled?: unknown }>(req);
  if (!body) return error(400, "Invalid request");
  if (body.role !== undefined && body.role !== "admin" && body.role !== "viewer") return error(400, "Invalid role");
  if (body.disabled !== undefined && typeof body.disabled !== "boolean") return error(400, "Invalid request");
  const r = getAuth().store.updateUser(id, body.role as "admin" | "viewer" | undefined, body.disabled as boolean | undefined, nowSecs());
  if (typeof r === "string") return userError(r);
  console.warn("[security] user updated", JSON.stringify({ admin: me.user.username, user: r.username, disabled: r.disabled, role: r.role }));
  return json(200, { success: true, user: r });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const me = await requireApi(req);
  if (me instanceof Response) return me;
  const id = parseId((await ctx.params).id);
  if (!id) return userError("not-found");
  if (id === me.user.id) return error(400, "You cannot delete your own account");
  const r = getAuth().store.deleteUser(id);
  if (r !== true) return userError(r);
  console.warn("[security] user deleted", JSON.stringify({ admin: me.user.username, user_id: id }));
  return json(200, { success: true });
}
