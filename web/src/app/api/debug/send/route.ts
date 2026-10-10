import { requireApi } from "@/lib/auth/api";
import { json, readJson } from "@/lib/auth/http";
import { sendRaw } from "@/lib/tools/diagnostics";

export async function POST(req: Request) {
  const me = await requireApi(req);
  if (me instanceof Response) return me;
  const r = await sendRaw((await readJson<Record<string, unknown>>(req)) ?? {});
  return json(r.status, r.body);
}
