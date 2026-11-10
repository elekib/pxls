import { getAuth } from "@/lib/auth";
import { requireApi } from "@/lib/auth/api";
import { getEngine } from "@/lib/engine/engine";
import { revision, version } from "@/lib/version";

export const dynamic = "force-dynamic";

/**
 * Public liveness check: always `{"status":"ok"}` for the container healthcheck.
 * The build and device state are for signed-in users only.
 *
 * `?device=1` is a device-link check for monitoring: it needs a session (a
 * bearer token works) and answers 503 while the display is not connected.
 */
export async function GET(req: Request) {
  if (new URL(req.url).searchParams.get("device") === "1") return deviceHealth(req);
  const session = await getAuth()
    .api.getSession({ headers: req.headers })
    .catch(() => null);
  if (!session) return Response.json({ status: "ok" });
  const { device } = getEngine().getStatus();
  return Response.json({ status: "ok", version: version(), revision: revision(), device });
}

async function deviceHealth(req: Request): Promise<Response> {
  const me = await requireApi(req);
  if (me instanceof Response) return me;
  const engine = getEngine();
  const { device, error, connectedAt, manualDisconnect, failingSince, failedAttempts } = engine.getStatus();
  const up = device === "connected";
  return Response.json(
    {
      status: up ? "ok" : "unavailable",
      device,
      error,
      connectedAt,
      manualDisconnect,
      failingSince,
      failedAttempts,
      link: engine.linkHealth(),
    },
    { status: up ? 200 : 503 },
  );
}
