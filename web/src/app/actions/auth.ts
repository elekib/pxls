"use server";

// Sign-in, setup and self-service account actions for the browser UI.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { nowSecs } from "@/lib/auth/service";
import {
  clearSessionCookie,
  requestInfo,
  requireUser,
  sessionToken,
  setSessionCookie,
} from "@/lib/auth/session";

export interface FormState {
  error?: string;
  message?: string;
}

const tooMany = (s?: number) => {
  const mins = s ? Math.ceil(s / 60) : null;
  return `Too many attempts. Try again${mins ? ` in about ${mins} minute${mins === 1 ? "" : "s"}` : " later"}.`;
};

export async function login(username: string, password: string): Promise<FormState> {
  const { ip, userAgent, secure } = await requestInfo();
  const r = await getAuth().login(String(username ?? "").trim(), String(password ?? ""), ip, userAgent);
  if (!r.ok) return { error: r.error === "throttled" ? tooMany(r.retryAfter) : "Invalid username or password." };
  await setSessionCookie(r.value, secure);
  redirect("/");
}

export async function setup(code: string, username: string, password: string): Promise<FormState> {
  const { ip, userAgent, secure } = await requestInfo();
  const r = await getAuth().setup(String(code ?? ""), String(username ?? "").trim(), String(password ?? ""), ip, userAgent);
  if (!r.ok) {
    if (r.error === "throttled") return { error: tooMany(r.retryAfter) };
    if (r.error === "invalid") return { error: r.message };
    return { error: "Setup is not available or the setup code is wrong" };
  }
  await setSessionCookie(r.value, secure);
  redirect("/");
}

export async function logout(): Promise<void> {
  const token = await sessionToken();
  if (token) getAuth().logoutToken(token);
  await clearSessionCookie();
  redirect("/login");
}

export async function changePassword(current: string, next: string): Promise<FormState> {
  const me = await requireUser();
  const { ip } = await requestInfo();
  const r = await getAuth().changePassword(me.user, String(current ?? ""), String(next ?? ""), ip);
  if (!r.ok) {
    if (r.error === "wrong-current") return { error: "Current password is incorrect" };
    if (r.error === "throttled") return { error: tooMany(r.retryAfter) };
    return { error: r.message };
  }
  // Every session was revoked, this one included.
  await clearSessionCookie();
  redirect("/login?changed=1");
}

export async function revokeSession(sessionId: string): Promise<FormState> {
  const me = await requireUser();
  if (typeof sessionId !== "string") return { error: "Session not found" };
  const ok = getAuth().store.revokeSession(me.user.id, sessionId, nowSecs(), "revoked-by-user");
  if (sessionId === me.sessionId) {
    await clearSessionCookie();
    redirect("/login");
  }
  revalidatePath("/account");
  return ok ? { message: "Session signed out" } : { error: "Session not found" };
}

export async function logoutEverywhere(): Promise<void> {
  const me = await requireUser();
  const n = getAuth().store.revokeUserSessions(me.user.id, null, nowSecs(), "logout-all");
  console.warn("[security] logout everywhere", JSON.stringify({ user: me.user.username, sessions: n }));
  await clearSessionCookie();
  redirect("/login");
}
