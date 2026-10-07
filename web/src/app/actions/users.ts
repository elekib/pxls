"use server";

// Admin user management for the Users page.

import { revalidatePath } from "next/cache";
import { getAuth } from "@/lib/auth";
import { nowSecs } from "@/lib/auth/service";
import { requireUser } from "@/lib/auth/session";
import { USER_ERROR_MESSAGES, type Role } from "@/lib/auth/store";
import type { FormState } from "./auth";

// Arguments arrive from the browser: check them at runtime, not just in types.
const validId = (id: unknown): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0;
const notFound = { error: USER_ERROR_MESSAGES["not-found"] };

const audit = (msg: string, fields: Record<string, unknown>) => console.warn(`[security] ${msg}`, JSON.stringify(fields));

export async function createUser(_: FormState, form: FormData): Promise<FormState> {
  const me = await requireUser("admin");
  const username = String(form.get("username") ?? "").trim();
  const role: Role = form.get("role") === "admin" ? "admin" : "viewer";
  const r = await getAuth().createUser(username, String(form.get("password") ?? ""), role);
  if (!r.ok) return { error: r.error ? USER_ERROR_MESSAGES[r.error] : r.message };
  audit("user created", { admin: me.user.username, user: r.user.username, role });
  revalidatePath("/users");
  return { message: `Created ${r.user.username}.` };
}

export async function updateUser(id: number, change: { role?: Role; disabled?: boolean }): Promise<FormState> {
  const me = await requireUser("admin");
  if (!validId(id)) return notFound;
  const role = change?.role === "admin" || change?.role === "viewer" ? change.role : undefined;
  const disabled = typeof change?.disabled === "boolean" ? change.disabled : undefined;
  const r = getAuth().store.updateUser(id, role, disabled, nowSecs());
  if (typeof r === "string") return { error: USER_ERROR_MESSAGES[r] };
  audit("user updated", { admin: me.user.username, user: r.username, disabled: r.disabled, role: r.role });
  revalidatePath("/users");
  return {};
}

export async function resetPassword(id: number, password: string): Promise<FormState> {
  const me = await requireUser("admin");
  const target = validId(id) ? getAuth().store.getUser(id) : null;
  if (!target || typeof password !== "string") return notFound;
  const r = await getAuth().adminSetPassword(target, password);
  if (!r.ok) return { error: r.message };
  audit("password reset; sessions revoked", { admin: me.user.username, user: target.username });
  return { message: `Password reset for ${target.username}. Their sessions were signed out.` };
}

export async function revokeUserSessions(id: number): Promise<FormState> {
  const me = await requireUser("admin");
  if (!validId(id)) return notFound;
  const n = getAuth().store.revokeUserSessions(id, null, nowSecs(), "revoked-by-admin");
  audit("sessions revoked by admin", { admin: me.user.username, user_id: id, sessions: n });
  revalidatePath("/users");
  return { message: `Signed out ${n} session(s).` };
}

export async function deleteUser(id: number): Promise<FormState> {
  const me = await requireUser("admin");
  if (!validId(id)) return notFound;
  if (id === me.user.id) return { error: "You cannot delete your own account" };
  const r = getAuth().store.deleteUser(id);
  if (r !== true) return { error: USER_ERROR_MESSAGES[r] };
  audit("user deleted", { admin: me.user.username, user_id: id });
  revalidatePath("/users");
  return {};
}
