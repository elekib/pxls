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

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" ? v : "";
};

const tooMany = (s?: number) => `Too many attempts. Try again in ${Math.ceil((s ?? 60) / 60)} minute(s).`;

export async function login(_: FormState, form: FormData): Promise<FormState> {
  const { ip, userAgent, secure } = await requestInfo();
  const r = await getAuth().login(str(form, "username"), str(form, "password"), ip, userAgent);
  if (!r.ok) return { error: r.error === "throttled" ? tooMany(r.retryAfter) : "Invalid username or password" };
  await setSessionCookie(r.value, secure);
  redirect("/");
}

export async function setup(_: FormState, form: FormData): Promise<FormState> {
  if (str(form, "password") !== str(form, "confirm")) return { error: "Passwords do not match." };
  const { ip, userAgent, secure } = await requestInfo();
  const r = await getAuth().setup(str(form, "setup_code"), str(form, "username").trim(), str(form, "password"), ip, userAgent);
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

export async function changePassword(_: FormState, form: FormData): Promise<FormState> {
  const me = await requireUser();
  if (str(form, "new_password") !== str(form, "confirm")) return { error: "Passwords do not match." };
  const { ip } = await requestInfo();
  const r = await getAuth().changePassword(me.user, str(form, "current_password"), str(form, "new_password"), ip);
  if (!r.ok) {
    if (r.error === "wrong-current") return { error: "Current password is incorrect" };
    if (r.error === "throttled") return { error: tooMany(r.retryAfter) };
    return { error: r.message };
  }
  // Every session was revoked, this one included.
  await clearSessionCookie();
  redirect("/login?changed=1");
}

export async function revokeSession(sessionId: string): Promise<void> {
  const me = await requireUser();
  if (typeof sessionId !== "string") return;
  getAuth().store.revokeSession(me.user.id, sessionId, nowSecs(), "revoked-by-user");
  if (sessionId === me.sessionId) {
    await clearSessionCookie();
    redirect("/login");
  }
  revalidatePath("/account");
}

export async function logoutEverywhere(): Promise<void> {
  const me = await requireUser();
  const n = getAuth().store.revokeUserSessions(me.user.id, null, nowSecs(), "logout-all");
  console.warn("[security] logout everywhere", JSON.stringify({ user: me.user.username, sessions: n }));
  await clearSessionCookie();
  redirect("/login");
}
