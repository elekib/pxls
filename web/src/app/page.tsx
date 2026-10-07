// Rendered on the server: reads the engine directly, no API round trip.

import { DeviceTester } from "@/components/DeviceTester";
import { getEngine, type DeviceStatus } from "@/lib/engine/engine";
import { revision, version } from "@/lib/version";

export const dynamic = "force-dynamic";

const COLORS: Record<DeviceStatus, string> = {
  connected: "var(--ok)",
  connecting: "var(--warn)",
  error: "var(--bad)",
  disabled: "var(--muted)",
};

export default function Home() {
  const engine = getEngine();
  const status = engine.getStatus();

  return (
    <main>
      <h1>pxls</h1>
      <p className="muted">
        Next.js preview {version()} <code>{revision().slice(0, 7)}</code>
      </p>

      <section className="card">
        <h2>Device</h2>
        <div className="row">
          <span className="dot" style={{ background: COLORS[status.device] }} />
          <strong>{status.device}</strong>
          {status.connectedAt && <span className="muted">since {status.connectedAt}</span>}
        </div>
        {status.error && <p className="muted">Last error: {status.error}</p>}
        {status.device === "disabled" && <p className="muted">Set PIXOO_MAC to connect.</p>}
      </section>

      {engine.config.debug ? (
        <DeviceTester />
      ) : (
        <p className="muted">Set PXLS_ENABLE_DEBUG=1 to show device test controls.</p>
      )}
    </main>
  );
}
