// Rendered on the server: reads the engine and config directly.

import { DeviceTester } from "@/components/DeviceTester";
import { ConnectionControls } from "@/components/device/ConnectionCard";
import { DeviceSettingsForm } from "@/components/device/DeviceSettingsForm";
import { TimezoneForm } from "@/components/device/TimezoneForm";
import { requireUser } from "@/lib/auth/session";
import { getConfig } from "@/lib/device/service";
import { getEngine, type DeviceStatus } from "@/lib/engine/engine";

export const dynamic = "force-dynamic";

const DOT: Record<DeviceStatus, string> = {
  connected: "bg-green-500",
  connecting: "bg-amber-500",
  error: "bg-red-500",
  disconnected: "bg-gray-500",
  disabled: "bg-gray-500",
};

const LABEL: Record<DeviceStatus, string> = {
  connected: "Connected",
  connecting: "Connecting…",
  error: "Not connected",
  disconnected: "Disconnected (you can use the Divoom app now)",
  disabled: "No device set",
};

export default async function DevicePage() {
  const { user } = await requireUser();
  const admin = user.role === "admin";
  const engine = getEngine();
  const status = engine.getStatus();
  const config = getConfig();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Device</h1>

      <section className="card space-y-4">
        <h2 className="font-semibold">Connection</h2>
        <div>
          <div className="flex items-center gap-3">
            <span className={`h-2.5 w-2.5 rounded-full ${DOT[status.device]}`} />
            <strong>{LABEL[status.device]}</strong>
          </div>
          <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm text-gray-400 sm:grid-cols-[auto_1fr]">
            <dt>Current MAC</dt>
            <dd className="font-mono text-gray-300">{status.mac ?? "not set"}</dd>
            {status.connectedAt && (
              <>
                <dt>Connected since</dt>
                <dd>{new Date(status.connectedAt).toLocaleString()}</dd>
              </>
            )}
            {status.error && (
              <>
                <dt>Last error</dt>
                <dd>{status.error}</dd>
              </>
            )}
          </dl>
        </div>
        {admin && <ConnectionControls mac={config.pixoo_mac || status.mac || ""} connected={status.device === "connected"} />}
      </section>

      <section className="card space-y-4">
        <h2 className="font-semibold">Device Configuration</h2>
        <DeviceSettingsForm initial={config.device_config} readOnly={!admin} />
      </section>

      <section className="card space-y-4">
        <h2 className="font-semibold">Timezone</h2>
        <p className="text-sm text-gray-400">Used by the clock pages.</p>
        <TimezoneForm timezone={config.timezone} readOnly={!admin} />
      </section>

      {admin && engine.config.debug && <DeviceTester />}
    </div>
  );
}
