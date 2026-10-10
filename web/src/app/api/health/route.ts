import { getAuth } from "@/lib/auth";
import { getEngine } from "@/lib/engine/engine";
import { revision, version } from "@/lib/version";

export const dynamic = "force-dynamic";

/** Public liveness check. The build and device state are for signed-in users only. */
export async function GET(req: Request) {
  const session = await getAuth()
    .api.getSession({ headers: req.headers })
    .catch(() => null);
  if (!session) return Response.json({ status: "ok" });
  const { device } = getEngine().getStatus();
  return Response.json({ status: "ok", version: version(), revision: revision(), device });
}
