// Device and config operations shared by the API routes and the UI's server
// actions. Port of routes/device.rs and routes/config.rs.

import { getDb } from "@/lib/db/sqlite";
import { deviceConfig, normalizeConfig, pickKnown, type Config, type DeviceConfig } from "@/lib/config/model";
import { loadConfig, preserveSecrets, publicConfig, saveConfig } from "@/lib/config/store";
import { getEngine } from "@/lib/engine/engine";
import { applyDeviceConfig } from "@/lib/engine/modes";

export const MAC_RE = /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/i;

export type Outcome = { ok: true; message: string } | { ok: false; status: number; error: string };

export function getConfig(): Config {
  return loadConfig(getDb());
}

/** Replace the whole config with one sent by a client (secrets preserved). */
export function updateConfig(raw: unknown): Config {
  const db = getDb();
  const stored = loadConfig(db);
  const sentAuth = !!raw && typeof raw === "object" && "beszel_auth" in raw;
  const incoming = normalizeConfig(pickKnown(raw as Record<string, unknown>));
  preserveSecrets(incoming, stored, sentAuth);
  saveConfig(db, incoming);
  // A new MAC takes effect right away, unless the user disconnected on purpose.
  const engine = getEngine();
  if (incoming.pixoo_mac !== stored.pixoo_mac && incoming.pixoo_mac && !engine.getStatus().manualDisconnect) {
    void engine.connectNow();
  }
  return incoming;
}

export { publicConfig };

/** Save the device config and apply it if a device is connected. */
export async function saveDeviceConfig(raw: unknown): Promise<Outcome> {
  const parsed = deviceConfig.safeParse(raw);
  if (!parsed.success) return { ok: false, status: 400, error: "Invalid device configuration" };
  const dc: DeviceConfig = parsed.data;
  const db = getDb();
  const cfg = loadConfig(db);
  cfg.device_config = dc;
  saveConfig(db, cfg);

  const engine = getEngine();
  if (engine.getStatus().device !== "connected") {
    return { ok: true, message: "Device configuration saved (no device connected)" };
  }
  try {
    await engine.run((p) => applyDeviceConfig(p, dc));
    return { ok: true, message: "Device configuration updated and applied" };
  } catch (e) {
    return { ok: false, status: 500, error: `Failed to apply device configuration: ${(e as Error).message}` };
  }
}

/** Connect to `mac`; it is saved only if the connection succeeds. */
export async function connectDevice(mac: string): Promise<Outcome> {
  const m = mac.trim().toUpperCase();
  if (!MAC_RE.test(m)) return { ok: false, status: 400, error: "Invalid MAC address format" };
  const r = await getEngine().connectNow(m);
  if (!r.ok) return { ok: false, status: 500, error: `Failed to connect to device: ${r.error}` };
  const db = getDb();
  const cfg = loadConfig(db);
  cfg.pixoo_mac = m;
  saveConfig(db, cfg);
  return { ok: true, message: `Successfully connected to device ${m}` };
}

export async function disconnectDevice(): Promise<Outcome> {
  await getEngine().disconnect();
  return { ok: true, message: "Device disconnected. You can now use the Divoom app. Click 'Connect' to reconnect." };
}

/** Set the timezone used by the clock pages. */
export function saveTimezone(tz: string): Outcome {
  const zone = tz.trim();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    return { ok: false, status: 400, error: "Unknown timezone" };
  }
  const db = getDb();
  const cfg = loadConfig(db);
  cfg.timezone = zone;
  saveConfig(db, cfg);
  return { ok: true, message: "Timezone saved" };
}

export function connectionStatus() {
  const s = getEngine().getStatus();
  return {
    connected: s.device === "connected",
    manual_disconnect: s.manualDisconnect,
    // Tools arrive in a later phase.
    tool_type: null,
    tool_remaining_secs: null,
  };
}
