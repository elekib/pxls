import { getAuth } from "@/lib/auth";
import { clientIp, csrfOk, error, readJson, throttled, tokensResponse } from "@/lib/auth/http";

export async function POST(req: Request) {
  const auth = getAuth();
  if (!csrfOk(req.headers, auth)) return error(403, "Forbidden");
  const body = await readJson<{ setup_code?: unknown; username?: unknown; password?: unknown }>(req);
  if (typeof body?.setup_code !== "string" || typeof body.username !== "string" || typeof body.password !== "string") {
    return error(400, "Invalid request");
  }
  const r = await auth.setup(body.setup_code, body.username.trim(), body.password, clientIp(req.headers), req.headers.get("user-agent"));
  if (r.ok) return tokensResponse(r.value, req.headers);
  if (r.error === "throttled") return throttled(r.retryAfter!);
  if (r.error === "invalid") return error(400, r.message!);
  return error(403, "Setup is not available or the setup code is wrong");
}
