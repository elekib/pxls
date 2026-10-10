"use server";

// Admin user management for the Users page.

import { revalidatePath } from "next/cache";
import { getAccounts } from "@/lib/auth";
import { USER_ERROR_MESSAGES, type Role } from "@/lib/auth/accounts";
import { requireUser } from "@/lib/auth/session";
import type { FormState } from "./auth";

// Arguments arrive from the browser: check them at runtime, not just in types.
const validId = (id: unknown): id is string => typeof id === "string" && id.length > 0 && id.length < 128;
const notFound = { error: USER_ERROR_MESSAGES["not-found"] };

const audit = (msg: string, fields: Record<string, unknown>) => console.warn(`[security] ${msg}`, JSON.stringify(fields));

export async function createUser(username: string, password: string, roleIn: string): Promise<FormState> {
  const me = await requireUser("admin");
  const role: Role = roleIn === "admin" ? "admin" : "viewer";
  const r = await getAccounts().createUser(String(username ?? "").trim(), String(password ?? ""), role);
  if (!r.ok) return { error: r.error ? USER_ERROR_MESSAGES[r.error] : r.message };
  audit("user created", { admin: me.user.username, user: r.user.username, role });
  revalidatePath("/users");
  return { message: "User created" };
}

export async function updateUser(id: string, change: { role?: Role; disabled?: boolean }): Promise<FormState> {
  const me = await requireUser("admin");
  if (!validId(id)) return notFound;
  const role = change?.role === "admin" || change?.role === "viewer" ? change.role : undefined;
  const disabled = typeof change?.disabled === "boolean" ? change.disabled : undefined;
  const r = await getAccounts().updateUser(id, { role, disabled });
  if (typeof r === "string") return { error: USER_ERROR_MESSAGES[r] };
  audit("user updated", { admin: me.user.username, user: r.username, disabled: r.disabled, role: r.role });
  revalidatePath("/users");
  return { message: role !== undefined ? "Role updated" : r.disabled ? "User disabled" : "User enabled" };
}

export async function resetPassword(id: string, password: string): Promise<FormState> {
  const me = await requireUser("admin");
  const target = validId(id) ? await getAccounts().getUser(id) : null;
  if (!target || typeof password !== "string") return notFound;
  const r = await getAccounts().setPassword(target, password);
  if (!r.ok) return { error: r.message };
  audit("password reset; sessions revoked", { admin: me.user.username, user: target.username });
  return { message: `Password reset for ${target.username}; their sessions were ended` };
}

export async function revokeUserSessions(id: string): Promise<FormState> {
  const me = await requireUser("admin");
  if (!validId(id)) return notFound;
  const n = await getAccounts().revokeUserSessions(id);
  audit("sessions revoked by admin", { admin: me.user.username, user_id: id, sessions: n });
  revalidatePath("/users");
  return { message: "Sessions revoked" };
}

export async function deleteUser(id: string): Promise<FormState> {
  const me = await requireUser("admin");
  if (!validId(id)) return notFound;
  if (id === me.user.id) return { error: "You cannot delete your own account" };
  const r = await getAccounts().deleteUser(id);
  if (r !== true) return { error: USER_ERROR_MESSAGES[r] };
  audit("user deleted", { admin: me.user.username, user_id: id });
  revalidatePath("/users");
  return { message: "User deleted" };
}
