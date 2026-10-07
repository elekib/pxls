// Rendered on the server: reads the engine directly, no API round trip.

import { DeviceTester } from "@/components/DeviceTester";
import { requireUser } from "@/lib/auth/session";
import { getEngine, type DeviceStatus } from "@/lib/engine/engine";

export const dynamic = "force-dynamic";

const DOT: Record<DeviceStatus, string> = {
  connected: "bg-green-500",
  connecting: "bg-amber-500",
  error: "bg-red-500",
  disabled: "bg-gray-500",
};

export default async function DevicePage() {
  const { user } = await requireUser();
  const engine = getEngine();
  const status = engine.getStatus();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Device</h1>
      <section className="card">
        <h2 className="mb-3 font-semibold">Connection</h2>
        <div className="flex items-center gap-3">
          <span className={`h-2.5 w-2.5 rounded-full ${DOT[status.device]}`} />
          <strong className="capitalize">{status.device}</strong>
          {status.connectedAt && <span className="text-sm text-gray-400">since {new Date(status.connectedAt).toLocaleString()}</span>}
        </div>
        {status.error && <p className="mt-2 text-sm text-gray-400">Last error: {status.error}</p>}
        {status.device === "disabled" && <p className="mt-2 text-sm text-gray-400">Set PIXOO_MAC to connect.</p>}
      </section>
      {user.role === "admin" && engine.config.debug && <DeviceTester />}
    </div>
  );
}
