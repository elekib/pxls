// Guard for API route handlers: a bearer access token (scripts) or the browser
// session cookie (the UI's own client components), then the role policy.

import { getAuth } from ".";
import { CSRF_HEADER, CSRF_VALUE, cookieValue, error } from "./http";
import { requiredRole } from "./policy";
import type { AuthUser } from "./service";
import { ROLE_RANK } from "./store";
import { SESSION_COOKIE } from "./session-cookie";

function bearer(headers: Headers): string | null {
  const v = headers.get("authorization");
  const i = v?.indexOf(" ") ?? -1;
  if (!v || i < 0 || v.slice(0, i).toLowerCase() !== "bearer") return null;
  return v.slice(i + 1).trim() || null;
}

/** The signed-in caller, or the 401/403 response to return. */
export async function requireApi(req: Request): Promise<AuthUser | Response> {
  const auth = getAuth();
  const path = new URL(req.url).pathname;
  let me: AuthUser | null = null;

  const token = bearer(req.headers);
  if (token) {
    me = await auth.authenticate(token);
  } else {
    const cookie = cookieValue(req.headers, SESSION_COOKIE);
    if (cookie) {
      // A cookie is sent automatically, so state changes need the custom header
      // that a cross-site page cannot add without a refused preflight.
      const safe = req.method === "GET" || req.method === "HEAD";
      if (!safe && req.headers.get(CSRF_HEADER) !== CSRF_VALUE) return error(403, "Forbidden");
      me = auth.authenticateCookie(cookie);
    }
  }
  if (!me) return error(401, "Unauthorized");
  if (ROLE_RANK[me.user.role] < ROLE_RANK[requiredRole(req.method, path)]) return error(403, "Forbidden");
  return me;
}
