import { requireApi } from "@/lib/auth/api";
import { json } from "@/lib/auth/http";
import { diagnosticsEnabled } from "@/lib/tools/diagnostics";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const me = await requireApi(req);
  if (me instanceof Response) return me;
  return json(200, { enabled: diagnosticsEnabled() });
}
