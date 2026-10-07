import { getAuth } from "@/lib/auth";
import { clientIp, csrfOk, error, readJson, throttled, tokensResponse } from "@/lib/auth/http";

export async function POST(req: Request) {
  const auth = getAuth();
  if (!csrfOk(req.headers, auth)) return error(403, "Forbidden");
  const body = await readJson<{ username?: unknown; password?: unknown }>(req);
  if (typeof body?.username !== "string" || typeof body.password !== "string") return error(400, "Invalid request");
  const r = await auth.login(body.username, body.password, clientIp(req.headers), req.headers.get("user-agent"));
  if (r.ok) return tokensResponse(r.value, req.headers);
  if (r.error === "throttled") return throttled(r.retryAfter!);
  return error(401, "Invalid username or password");
}
