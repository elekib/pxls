import { requireApi } from "@/lib/auth/api";
import { json } from "@/lib/auth/http";
import { release } from "@/lib/tools/diagnostics";

export async function POST(req: Request) {
  const me = await requireApi(req);
  if (me instanceof Response) return me;
  const r = await release();
  return json(r.status, r.body);
}
