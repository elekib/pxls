// Device and config operations shared by the API routes and the UI's server
// actions.

import { getDb } from "@/lib/db/sqlite";
import { deviceConfig, normalizeConfig, pickKnown, type Config, type DeviceConfig } from "@/lib/config/model";
import { loadConfig, preserveSecrets, publicConfig, saveConfig } from "@/lib/config/store";
import { getEngine, getTokens, getTools } from "@/lib/engine/engine";
import { clearSystemCache } from "@/lib/render/beszel";
import { applyDeviceConfig, nativeMode } from "@/lib/engine/modes";

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
  const authChanged = preserveSecrets(incoming, stored, sentAuth);
  saveConfig(db, incoming);
  if (authChanged) {
    getTokens().invalidate();
    clearSystemCache();
  }
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
  dc.light_config.brightness = dc.brightness; // one brightness for both
  const db = getDb();
  const cfg = loadConfig(db);
  cfg.device_config = dc;
  saveConfig(db, cfg);

  // A running tool owns the display; the render loop applies the saved config when it ends.
  if (getTools().isActive()) {
    return { ok: true, message: "Device configuration saved; it will apply when the running tool ends" };
  }
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

/**
 * Set brightness now and save it. One brightness drives both the device and
 * Light mode (whose command carries its own brightness), so the two never
 * disagree.
 */
export async function applyBrightness(percent: number): Promise<Outcome> {
  if (!Number.isFinite(percent)) return { ok: false, status: 400, error: "Invalid brightness" };
  const pct = Math.max(0, Math.min(100, Math.round(percent)));
  const db = getDb();
  const cfg = loadConfig(db);
  cfg.device_config.brightness = pct;
  cfg.device_config.light_config.brightness = pct;
  saveConfig(db, cfg);

  const engine = getEngine();
  if (engine.getStatus().device !== "connected") return { ok: true, message: "Brightness saved (no device connected)" };
  try {
    await engine.run(async (p) => {
      await p.setBrightness(pct);
      // Light mode carries its own brightness, but never overwrite a running tool.
      if (cfg.device_config.light_mode === "light" && !getTools().isActive()) await p.setMode(nativeMode(cfg.device_config)!);
    });
    return { ok: true, message: `Brightness ${pct}%` };
  } catch (e) {
    return { ok: false, status: 500, error: `Failed to set brightness: ${(e as Error).message}` };
  }
}

/** Save the Score mode scores; update the display if Score mode is on. */
export async function applyScores(red: number, blue: number): Promise<Outcome> {
  if (!Number.isFinite(red) || !Number.isFinite(blue)) return { ok: false, status: 400, error: "Invalid score" };
  const clamp = (n: number) => Math.max(0, Math.min(999, Math.trunc(n)));
  const db = getDb();
  const cfg = loadConfig(db);
  cfg.device_config.score_config = { red_score: clamp(red), blue_score: clamp(blue) };
  saveConfig(db, cfg);
  const engine = getEngine();
  if (cfg.device_config.light_mode !== "score" || engine.getStatus().device !== "connected" || getTools().isActive()) {
    return { ok: true, message: "Scores saved" };
  }
  try {
    await engine.run((p) => p.setMode(nativeMode(cfg.device_config)!));
    return { ok: true, message: "Scores updated" };
  } catch (e) {
    return { ok: false, status: 500, error: `Failed to update scores: ${(e as Error).message}` };
  }
}

/** Connect to `mac`; it is saved only if the connection succeeds. */
export async function connectDevice(mac: string): Promise<Outcome> {
  const m = mac.trim().toUpperCase();
  if (!MAC_RE.test(m)) return { ok: false, status: 400, error: "Invalid MAC address format" };
  // A fresh link has no tool running on it.
  getTools().end();
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
  const tools = getTools();
  const left = tools.remainingMs();
  return {
    connected: s.device === "connected",
    manual_disconnect: s.manualDisconnect,
    // The running tool (null when none or expired) and seconds left (null
    // for tools without a timer, such as the scoreboard).
    tool_type: tools.kind(),
    tool_remaining_secs: left === null ? null : Math.ceil(left / 1000),
  };
}
