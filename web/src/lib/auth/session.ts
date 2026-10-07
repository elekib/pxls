// Browser sessions for server components and server actions.

import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from ".";
import { clientIp, cookieSecure } from "./http";
import { SESSION_MAX_SECS, type AuthUser, type Tokens } from "./service";
import { SESSION_COOKIE } from "./session-cookie";
import { ROLE_RANK, type Role } from "./store";

/** The signed-in user, or null. */
export async function currentUser(): Promise<AuthUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? getAuth().authenticateCookie(token) : null;
}

/** The signed-in user with at least `role`; otherwise redirect. */
export async function requireUser(role: Role = "viewer"): Promise<AuthUser> {
  const me = await currentUser();
  if (!me) redirect("/login");
  if (ROLE_RANK[me.user.role] < ROLE_RANK[role]) redirect("/");
  return me;
}

/** Request details for lockout and the session list. */
export async function requestInfo(): Promise<{ ip: string; userAgent: string | null; secure: boolean }> {
  const h = await headers();
  return { ip: clientIp(h), userAgent: h.get("user-agent"), secure: cookieSecure(h) };
}

/** Store a new session's token in the browser cookie. */
export async function setSessionCookie(t: Tokens, secure: boolean) {
  (await cookies()).set(SESSION_COOKIE, t.refreshToken, {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    secure,
    // The server enforces the idle and absolute limits; the cookie just needs
    // to outlive them.
    maxAge: SESSION_MAX_SECS,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** The raw cookie token (for logout). */
export async function sessionToken(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}
