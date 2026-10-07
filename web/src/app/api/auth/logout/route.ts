import { getAuth } from "@/lib/auth";
import { REFRESH_COOKIE, cleared, cookieValue, csrfOk, error, json } from "@/lib/auth/http";

export async function POST(req: Request) {
  const auth = getAuth();
  if (!csrfOk(req.headers, auth)) return error(403, "Forbidden");
  const token = cookieValue(req.headers, REFRESH_COOKIE);
  if (token) auth.logoutToken(token);
  return cleared(json(200, { success: true }), req.headers);
}
