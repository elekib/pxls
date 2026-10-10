import { requireApi } from "@/lib/auth/api";
import { json, readJson } from "@/lib/auth/http";
import { getConfig } from "@/lib/device/service";
import { getTokens } from "@/lib/engine/engine";

/** Try a login with the given (or stored) credentials without changing anything. */
export async function POST(req: Request) {
  const me = await requireApi(req);
  if (me instanceof Response) return me;
  const body = await readJson<{ email?: unknown; password?: unknown }>(req);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" && body.password ? body.password : (getConfig().beszel_auth?.password ?? "");
  if (!email || !password) return json(200, { success: false, error: "Enter an email and password" });
  try {
    await getTokens().testLogin(email, password);
    return json(200, { success: true });
  } catch (e) {
    return json(200, { success: false, error: (e as Error).message });
  }
}
