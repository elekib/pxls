// Tool commands for the API: countdown, sound detector, scoreboard, buzzer and
// stop. Port of routes/tools.rs and pixoo_wrapper.rs. Everything goes over the
// open link; PXLS_TOOL_CLOSE_LINK=1 releases it after a tool starts, for
// devices that need that (the engine reconnects when the tool ends).

import { getDb } from "@/lib/db/sqlite";
import type { DeviceConfig } from "@/lib/config/model";
import { loadConfig } from "@/lib/config/store";
import type { Pixoo } from "@/lib/device/pixoo";
import { getEngine, getTools } from "@/lib/engine/engine";
import { applyDeviceConfig } from "@/lib/engine/modes";
import type { ToolKind } from "./state";

/** The noise meter has no end of its own; the UI treats it as running this long. */
export const SOUND_DETECTOR_MS = 300_000;

export type ToolResult = { ok: true; body: Record<string, unknown> } | { ok: false; status: number; error: string };

export const closeLink = () => ["1", "true"].includes(process.env.PXLS_TOOL_CLOSE_LINK ?? "");

/**
 * Put the display back after a tool. A user Stop first sends the tool's own
 * stop command; a timer that ran out needs none.
 */
export async function endTool(p: Pixoo, kind: ToolKind, userStop: boolean, dc: DeviceConfig): Promise<void> {
  if (userStop) {
    if (kind === "countdown") await p.setToolInfo({ kind: "countdown", start: false, minutes: 0, seconds: 0 });
    if (kind === "sound_detector") await p.setToolInfo({ kind: "noise", start: false });
  }
  await applyDeviceConfig(p, dc);
}

/** Record the tool before sending, so the render loop never sees a gap; forget it if sending fails. */
async function startTool(kind: ToolKind, durationMs: number | null, send: (p: Pixoo) => Promise<void>, release = false): Promise<string | null> {
  const tools = getTools();
  tools.begin(kind, durationMs);
  try {
    await getEngine().run(async (p) => {
      await send(p);
      if (release && closeLink()) await p.disconnect();
    });
    return null;
  } catch (e) {
    tools.end();
    return (e as Error).message;
  }
}

const clampScore = (n: number) => Math.max(0, Math.min(999, Math.trunc(n)));

export async function setScoreboard(red: unknown, blue: unknown): Promise<ToolResult> {
  if (typeof red !== "number" || typeof blue !== "number" || red < 0 || blue < 0 || red > 65535 || blue > 65535) {
    return { ok: false, status: 400, error: "Invalid scores" };
  }
  const [r, b] = [Math.trunc(red), Math.trunc(blue)];
  const err = await startTool("scoreboard", null, (p) => p.setMode({ kind: "score", red: clampScore(r), blue: clampScore(b) }));
  if (err) return { ok: false, status: 500, error: `Failed to set scoreboard: ${err}` };
  return { ok: true, body: { success: true, message: `Scoreboard set: Red=${r} Blue=${b}`, red_score: r, blue_score: b } };
}

export async function startCountdown(minutes: unknown, seconds: unknown): Promise<ToolResult> {
  if (!Number.isInteger(minutes) || !Number.isInteger(seconds) || (minutes as number) < 0 || (minutes as number) > 255 || (seconds as number) < 0 || (seconds as number) > 255) {
    return { ok: false, status: 400, error: "Invalid countdown" };
  }
  const [m, s] = [minutes as number, seconds as number];
  if (m * 60 + s === 0) return { ok: false, status: 400, error: "Countdown must be longer than 0 seconds" };
  if (s > 59) return { ok: false, status: 500, error: `Failed to start countdown: Invalid seconds value: ${s} (0-59)` };
  const err = await startTool("countdown", (m * 60 + s) * 1000, (p) => p.setToolInfo({ kind: "countdown", start: true, minutes: m, seconds: s }), true);
  if (err) return { ok: false, status: 500, error: `Failed to start countdown: ${err}` };
  return { ok: true, body: { success: true, message: `Countdown started: ${m}m ${s}s` } };
}

export async function startSoundDetector(): Promise<ToolResult> {
  const err = await startTool("sound_detector", SOUND_DETECTOR_MS, (p) => p.setToolInfo({ kind: "noise", start: true }), true);
  if (err) return { ok: false, status: 500, error: `Failed to start sound detector: ${err}` };
  return { ok: true, body: { success: true, message: "Sound detector started (5 min)" } };
}

/** On the open link; a second Bluetooth connection is refused by the device. */
export async function playBuzzer(totalTime: unknown): Promise<ToolResult> {
  const t = totalTime === undefined ? 1000 : totalTime;
  if (!Number.isInteger(t) || (t as number) < 0) return { ok: false, status: 400, error: "Invalid total_time" };
  const ms = (t as number) & 0xffff; // Rust truncated to u16
  try {
    await getEngine().run((p) => p.playBuzzer(ms));
    return { ok: true, body: { success: true, message: "Buzzer activated", duration_ms: ms } };
  } catch (e) {
    return { ok: false, status: 500, error: `Failed to send buzzer command: ${(e as Error).message}` };
  }
}

export async function stopTool(): Promise<ToolResult> {
  const tools = getTools();
  const kind = tools.kind();
  tools.end();
  if (!kind) return { ok: true, body: { success: true, message: "No tool running" } };
  console.log(`[tools] ${kind} stopped by user`);
  const dc = loadConfig(getDb()).device_config;
  try {
    await getEngine().run((p) => endTool(p, kind, true, dc));
    return { ok: true, body: { success: true, message: "Tool stopped" } };
  } catch {
    // The link is gone (fallback mode or a drop); the engine reconnects and
    // applies the config.
    getEngine().forceReconnect();
    return { ok: true, body: { success: true, message: "Tool stopped, reconnecting to device" } };
  }
}
