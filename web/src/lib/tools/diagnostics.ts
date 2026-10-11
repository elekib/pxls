// Admin device diagnostics: send a raw command to the connected display.
// Off unless PXLS_ENABLE_DEBUG=1. While probing, the
// render loop is held off (as a "diagnostics" tool) so it does not overwrite
// what you are looking at.

import { getDb } from "@/lib/db/sqlite";
import { loadConfig } from "@/lib/config/store";
import { getEngine, getTools } from "@/lib/engine/engine";
import { frame } from "@/lib/protocol";
import { endTool } from "./service";

const MAX_ARGS = 256;
export const DEFAULT_HOLD_SECS = 120;
const MAX_HOLD_SECS = 900;

export const DISABLED = "Diagnostics are disabled. Set PXLS_ENABLE_DEBUG=1 and restart pxls.";

export const diagnosticsEnabled = () => ["1", "true"].includes(process.env.PXLS_ENABLE_DEBUG ?? "");

/** Parse hex like `45 03 0A`, `0x45,0x03` or `45030A` into bytes. */
export function parseHex(input: string): number[] {
  const cleaned = input
    .split(/[\s,]+/)
    .map((t) => t.replace(/^0x/i, ""))
    .join("");
  if (cleaned.length % 2 !== 0) throw new Error("hex must have an even number of digits");
  const out: number[] = [];
  for (let i = 0; i < cleaned.length; i += 2) {
    const h = cleaned.slice(i, i + 2);
    if (!/^[0-9a-fA-F]{2}$/.test(h)) throw new Error("invalid hex");
    out.push(parseInt(h, 16));
  }
  return out;
}

export type DiagResult = { status: number; body: Record<string, unknown> };
const err = (status: number, error: string): DiagResult => ({ status, body: { error } });

/** Hold the render loop off for `secs` (capped). */
export function hold(secs: number = DEFAULT_HOLD_SECS): number {
  const s = Math.max(1, Math.min(MAX_HOLD_SECS, Math.trunc(secs)));
  getTools().begin("diagnostics", s * 1000);
  return s;
}

export async function sendRaw(req: { cmd?: unknown; args?: unknown; reset_first?: unknown; hold_secs?: unknown }): Promise<DiagResult> {
  if (!diagnosticsEnabled()) return err(403, DISABLED);
  let cmd: number;
  let args: number[];
  try {
    const c = parseHex(String(req.cmd ?? ""));
    if (c.length !== 1) return err(400, "cmd must be exactly one byte");
    cmd = c[0];
  } catch (e) {
    return err(400, `cmd: ${(e as Error).message}`);
  }
  try {
    args = parseHex(typeof req.args === "string" ? req.args : "");
    if (args.length > MAX_ARGS) return err(400, "too many argument bytes (max 256)");
  } catch (e) {
    return err(400, `args: ${(e as Error).message}`);
  }
  const secs = hold(typeof req.hold_secs === "number" ? req.hold_secs : DEFAULT_HOLD_SECS);
  const engine = getEngine();
  if (engine.getStatus().device !== "connected") return err(409, "No device connected");

  const hex = Buffer.from(frame.encode(cmd, args)).toString("hex");
  try {
    await engine.run(async (p) => {
      if (req.reset_first === true) {
        await p.setMode({ kind: "light", color: [255, 0, 0], brightness: 50, effect: 0, on: true });
        await new Promise((r) => setTimeout(r, 800));
      }
      console.warn("[security] diagnostics raw send", JSON.stringify({ hex }));
      await p.send(cmd, args);
    });
    return { status: 200, body: { success: true, sent: hex, hold_secs: secs } };
  } catch (e) {
    return err(502, `send failed: ${(e as Error).message}`);
  }
}

/** Undo a probe: stop holding the loop and put the configured display back. */
export async function release(): Promise<DiagResult> {
  if (!diagnosticsEnabled()) return err(403, DISABLED);
  getTools().end();
  const dc = loadConfig(getDb()).device_config;
  try {
    await getEngine().run((p) => endTool(p, "diagnostics", false, dc));
    console.warn("[security] diagnostics released, display restored");
    return { status: 200, body: { success: true } };
  } catch (e) {
    getEngine().forceReconnect();
    return err(502, `Released the hold, but could not restore the display: ${(e as Error).message}. Reconnecting.`);
  }
}
