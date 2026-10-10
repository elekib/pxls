import { getAuth } from "@/lib/auth";
import { requireApi } from "@/lib/auth/api";
import { error, json, readJson } from "@/lib/auth/http";
import { USER_ERROR_MESSAGES } from "@/lib/auth/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const me = await requireApi(req);
  if (me instanceof Response) return me;
  return json(200, { success: true, users: getAuth().store.listUsers() });
}

export async function POST(req: Request) {
  const me = await requireApi(req);
  if (me instanceof Response) return me;
  const body = await readJson<{ username?: unknown; password?: unknown; role?: unknown }>(req);
  if (typeof body?.username !== "string" || typeof body.password !== "string") return error(400, "Invalid request");
  if (body.role !== undefined && body.role !== "admin" && body.role !== "viewer") return error(400, "Invalid role");
  const r = await getAuth().createUser(body.username.trim(), body.password, (body.role as "admin" | "viewer") ?? "viewer");
  if (r.ok) {
    console.warn("[security] user created", JSON.stringify({ admin: me.user.username, user: r.user.username, role: r.user.role }));
    return json(201, { success: true, user: r.user });
  }
  return r.error ? error(409, USER_ERROR_MESSAGES[r.error]) : error(400, r.message!);
}
