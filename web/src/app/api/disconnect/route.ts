import { requireApi } from "@/lib/auth/api";
import { json } from "@/lib/auth/http";
import { disconnectDevice } from "@/lib/device/service";

export async function POST(req: Request) {
  const me = await requireApi(req);
  if (me instanceof Response) return me;
  const r = await disconnectDevice();
  return json(200, { success: true, message: r.ok ? r.message : "" });
}
