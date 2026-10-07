// HTTP helpers for the /api/auth and /api/users routes: JSON shapes, CSRF
// checks, client IP and the refresh cookie. Port of backend/src/routes/account.rs.

import { isIP } from "node:net";
import type { AuthService, Tokens } from "./service";

export const REFRESH_COOKIE = "pxls_refresh";
const REFRESH_COOKIE_PATH = "/api/auth";
export const CSRF_HEADER = "x-requested-with";
export const CSRF_VALUE = "pxls";

export function json(status: number, body: unknown, headers: HeadersInit = {}): Response {
  const h = new Headers(headers);
  h.set("content-type", "application/json");
  h.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { status, headers: h });
}

export function error(status: number, message: string): Response {
  const r = json(status, { success: false, error: message });
  if (status === 401) r.headers.set("www-authenticate", "Bearer");
  return r;
}

export function throttled(retryAfter: number): Response {
  const r = error(429, "Too many attempts. Try again later.");
  r.headers.set("retry-after", String(retryAfter));
  return r;
}

function isPrivate(ip: string): boolean {
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (isIP(v4) === 4) {
    const [a, b] = v4.split(".").map(Number) as [number, number];
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (isIP(ip) === 6) {
    const first = parseInt(ip.split(":")[0] || "0", 16);
    return ip === "::1" || (first & 0xfe00) === 0xfc00;
  }
  return false;
}

/**
 * The client address for lockout and logs: the real TCP peer (stamped by
 * peer.cjs). `X-Real-IP` is honoured only when the peer itself is private,
 * i.e. a reverse proxy on your network, never from a public peer.
 */
export function clientIp(headers: Headers): string {
  const peer = headers.get("x-pxls-peer")?.trim();
  if (!peer) return "unknown";
  if (isPrivate(peer)) {
    const real = headers.get("x-real-ip")?.trim();
    if (real && isIP(real)) return real;
  }
  return peer.startsWith("::ffff:") ? peer.slice(7) : peer;
}

function hostname(authority: string): string {
  let a = authority.trim().toLowerCase();
  const scheme = a.lastIndexOf("://");
  if (scheme >= 0) a = a.slice(scheme + 3);
  a = a.split("/")[0] ?? a;
  if (a.startsWith("[")) return a.slice(1).split("]")[0] ?? a;
  return a.split(":")[0] ?? a;
}

/**
 * CSRF defence for cookie and credential endpoints: a custom header (a
 * cross-site page cannot send one without a refused CORS preflight) and a
 * same-host or allowlisted Origin when the browser sends one.
 */
export function csrfOk(headers: Headers, auth: AuthService): boolean {
  if (headers.get(CSRF_HEADER) !== CSRF_VALUE) return false;
  const origin = headers.get("origin");
  if (origin) {
    const listed = auth.allowedOrigins.includes(origin.replace(/\/+$/, "").toLowerCase());
    const host = headers.get("host");
    const sameHost = !!host && hostname(host) === hostname(origin);
    if (!listed && !sameHost) return false;
  }
  return true;
}

export function cookieValue(headers: Headers, name: string): string | null {
  for (const pair of (headers.get("cookie") ?? "").split(";")) {
    const i = pair.indexOf("=");
    if (i > 0 && pair.slice(0, i).trim() === name) {
      const v = pair.slice(i + 1).trim();
      if (v) return v;
    }
  }
  return null;
}

export function cookieSecure(headers: Headers): boolean {
  return (
    headers.get("x-forwarded-proto")?.toLowerCase() === "https" ||
    process.env.PXLS_COOKIE_SECURE?.toLowerCase() === "true"
  );
}

function refreshCookie(token: string, maxAge: number, secure: boolean): string {
  return `${REFRESH_COOKIE}=${token}; Path=${REFRESH_COOKIE_PATH}; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

export function tokensResponse(t: Tokens, headers: Headers): Response {
  const r = json(200, { success: true, access_token: t.accessToken, expires_in: t.expiresIn, user: t.user });
  r.headers.append("set-cookie", refreshCookie(t.refreshToken, t.refreshMaxAge, cookieSecure(headers)));
  return r;
}

export function cleared(r: Response, headers: Headers): Response {
  r.headers.append("set-cookie", refreshCookie("", 0, cookieSecure(headers)));
  return r;
}

export async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}
