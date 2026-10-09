// Better Auth's HTTP API: sign-in, sign-out, sessions, change-password and the
// admin user endpoints. Scripts sign in with POST /api/auth/sign-in/username
// and send the `set-auth-token` response header back as `Authorization: Bearer`.
//
// Only the endpoints pxls uses are exposed. Sign-up is off, and email sign-in
// is blocked because the per-account emails are placeholders.

import { getAuth } from "@/lib/auth";
import { IP_HEADER } from "@/lib/auth/auth";
import { clientIp, error } from "@/lib/auth/http";

export const dynamic = "force-dynamic";

const EXACT = new Set([
  "/sign-in/username",
  "/sign-out",
  "/get-session",
  "/list-sessions",
  "/revoke-session",
  "/revoke-sessions",
  "/revoke-other-sessions",
  "/change-password",
  "/is-username-available",
]);

const PREFIX = "/api/auth";

async function handle(req: Request): Promise<Response> {
  const path = new URL(req.url).pathname.slice(PREFIX.length).replace(/\/+$/, "");
  if (!EXACT.has(path) && !path.startsWith("/admin/")) return error(404, "Not found");
  // The rate limiter and session log read this header, so it carries the
  // address clientIp() trusts, never a client-supplied one.
  const headers = new Headers(req.headers);
  headers.set(IP_HEADER, clientIp(req.headers));
  return getAuth().handler(new Request(req, { headers }));
}

export { handle as GET, handle as POST };
