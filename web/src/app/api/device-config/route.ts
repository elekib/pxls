import { requireApi } from "@/lib/auth/api";
import { json, readJson } from "@/lib/auth/http";
import { saveDeviceConfig } from "@/lib/device/service";

export async function POST(req: Request) {
  const me = await requireApi(req);
  if (me instanceof Response) return me;
  const r = await saveDeviceConfig(await readJson<unknown>(req));
  return r.ok ? json(200, { success: true, message: r.message }) : json(r.status, { error: r.error });
}
