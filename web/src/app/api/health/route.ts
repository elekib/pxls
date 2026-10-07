import { getEngine } from "@/lib/engine/engine";
import { revision, version } from "@/lib/version";

export const dynamic = "force-dynamic";

export function GET() {
  const { device } = getEngine().getStatus();
  return Response.json({ status: "ok", version: version(), revision: revision(), device });
}
