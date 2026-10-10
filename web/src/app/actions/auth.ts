"use server";

// First-run setup and self-service account actions for the browser UI. Sign-in
// itself goes through /api/auth/sign-in/username (see LoginScreen) so the rate
// limiter applies.

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAccounts, getAuth } from "@/lib/auth";
import { requireUser } from "@/lib/auth/session";

export interface FormState {
  error?: string;
  message?: string;
}

const audit = (msg: string, fields: Record<string, unknown>) => console.warn(`[security] ${msg}`, JSON.stringify(fields));

export async function setup(code: string, username: string, password: string): Promise<FormState> {
  const name = String(username ?? "").trim();
  const pw = String(password ?? "");
  const r = await getAccounts().setup(String(code ?? ""), name, pw);
  if (!r.ok) return { error: r.error === "invalid" ? r.message : "Setup is not available or the setup code is wrong" };
  // Sets the session cookie through nextCookies().
  await getAuth().api.signInUsername({ body: { username: name, password: pw }, headers: await headers() });
  redirect("/");
}

export async function logout(): Promise<void> {
  await getAuth().api.signOut({ headers: await headers() });
  redirect("/login");
}

export async function changePassword(current: string, next: string): Promise<FormState> {
  const me = await requireUser();
  try {
    await getAuth().api.changePassword({
      body: { currentPassword: String(current ?? ""), newPassword: String(next ?? ""), revokeOtherSessions: true },
      headers: await headers(),
    });
  } catch (e) {
    const msg = (e as { body?: { message?: string } }).body?.message ?? "";
    return { error: /password/i.test(msg) && /invalid|incorrect/i.test(msg) ? "Current password is incorrect" : msg || "Could not change the password" };
  }
  audit("password changed; all sessions revoked", { user: me.user.username });
  // Sign in again with the new password, on every device.
  await getAuth().api.signOut({ headers: await headers() });
  redirect("/login?changed=1");
}

export async function revokeSession(sessionId: string): Promise<FormState> {
  const me = await requireUser();
  if (typeof sessionId !== "string") return { error: "Session not found" };
  if (sessionId === me.sessionId) {
    await getAuth().api.signOut({ headers: await headers() });
    redirect("/login");
  }
  const ok = await getAccounts().revokeSession(me.user.id, sessionId);
  revalidatePath("/account");
  return ok ? { message: "Session signed out" } : { error: "Session not found" };
}

export async function logoutEverywhere(): Promise<void> {
  const me = await requireUser();
  await getAuth().api.signOut({ headers: await headers() });
  const n = await getAccounts().revokeUserSessions(me.user.id);
  audit("logout everywhere", { user: me.user.username, sessions: n });
  redirect("/login");
}
