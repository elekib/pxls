import { getAuth } from "@/lib/auth";
import { REFRESH_COOKIE, cleared, clientIp, cookieValue, csrfOk, error, tokensResponse } from "@/lib/auth/http";

export async function POST(req: Request) {
  const auth = getAuth();
  if (!csrfOk(req.headers, auth)) return error(403, "Forbidden");
  const token = cookieValue(req.headers, REFRESH_COOKIE);
  if (!token) return error(401, "Unauthorized");
  const r = await auth.refresh(token, clientIp(req.headers));
  return r.ok ? tokensResponse(r.value, req.headers) : cleared(error(401, "Unauthorized"), req.headers);
}
