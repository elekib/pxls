import { requireApi } from "@/lib/auth/api";
import { json } from "@/lib/auth/http";
import { connectionStatus } from "@/lib/device/service";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const me = await requireApi(req);
  if (me instanceof Response) return me;
  return json(200, connectionStatus());
}
