import { requireApi } from "@/lib/auth/api";
import { json } from "@/lib/auth/http";
import { getTokens } from "@/lib/engine/engine";

export const dynamic = "force-dynamic";

/** Current Beszel login state, for the UI. Contains no secrets. */
export async function GET(req: Request) {
  const me = await requireApi(req);
  if (me instanceof Response) return me;
  return json(200, getTokens().status());
}
