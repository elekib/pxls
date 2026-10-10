import { requireApi } from "@/lib/auth/api";
import { json, readJson } from "@/lib/auth/http";
import { connectDevice } from "@/lib/device/service";

export async function POST(req: Request) {
  const me = await requireApi(req);
  if (me instanceof Response) return me;
  const body = await readJson<{ mac?: unknown }>(req);
  const r = await connectDevice(typeof body?.mac === "string" ? body.mac : "");
  return r.ok ? json(200, { success: true, message: r.message }) : json(r.status, { error: r.error });
}
