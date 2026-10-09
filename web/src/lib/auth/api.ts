// Guard for API route handlers: a bearer session token (scripts) or the browser
// session cookie (the UI's own client components), then the role policy.

import { getAuth } from ".";
import { ROLE_RANK, toAuthUser, type AuthUser } from "./accounts";
import { CSRF_HEADER, CSRF_VALUE, error } from "./http";
import { requiredRole } from "./policy";

function hasBearer(headers: Headers): boolean {
  return /^bearer\s+\S/i.test(headers.get("authorization") ?? "");
}

/** The signed-in caller, or the 401/403 response to return. */
export async function requireApi(req: Request): Promise<AuthUser | Response> {
  const path = new URL(req.url).pathname;
  const me = toAuthUser(await getAuth().api.getSession({ headers: req.headers }));
  if (!me) return error(401, "Unauthorized");
  // A cookie is sent automatically, so state changes need the custom header
  // that a cross-site page cannot add without a refused preflight.
  const safe = req.method === "GET" || req.method === "HEAD";
  if (!safe && !hasBearer(req.headers) && req.headers.get(CSRF_HEADER) !== CSRF_VALUE) return error(403, "Forbidden");
  if (ROLE_RANK[me.user.role] < ROLE_RANK[requiredRole(req.method, path)]) return error(403, "Forbidden");
  return me;
}
