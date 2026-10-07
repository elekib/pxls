// The display engine: owns the Bluetooth link inside the Next.js server process.
//
// One instance per process (see getEngine). Device work goes through run(),
// which queues calls so the API and the render loop never interleave packets.
// A failed send or a hangup drops the link and reconnects every RETRY_MS,
// unless the user disconnected on purpose (to use the Divoom app).
//
// The MAC comes from the saved config (set with Connect in the UI), falling
// back to PIXOO_MAC. On every connect the device config is applied; every
// TICK_MS the tick hook runs (native-mode keep-alive, later the render loop).

import { getDb } from "@/lib/db/sqlite";
import { loadConfig } from "@/lib/config/store";
import { Pixoo } from "@/lib/device/pixoo";
import { RfcommTransport } from "@/lib/device/rfcomm";
import type { Transport } from "@/lib/device/types";
import { readConfig, type EngineConfig } from "./config";
import { applyDeviceConfig, nativeMode } from "./modes";

export const RETRY_MS = 2000;
export const TICK_MS = 10_000;

export type DeviceStatus = "disabled" | "connecting" | "connected" | "disconnected" | "error";

export interface EngineStatus {
  device: DeviceStatus;
  error: string | null;
  connectedAt: string | null;
  mac: string | null;
  /** The user disconnected on purpose; no automatic reconnect. */
  manualDisconnect: boolean;
}

export type Connector = (mac: string, onHangup: (e?: Error) => void) => Promise<Transport>;

export interface EngineHooks {
  getMac: () => string | null;
  onConnected?: (pixoo: Pixoo) => Promise<void>;
  onTick?: (pixoo: Pixoo) => Promise<void>;
}

const log = (msg: string) => console.log(`[engine] ${msg}`);

export class Engine {
  private pixoo: Pixoo | null = null;
  private status: Omit<EngineStatus, "mac" | "manualDisconnect"> = { device: "disabled", error: null, connectedAt: null };
  private queue: Promise<unknown> = Promise.resolve();
  private retry: NodeJS.Timeout | null = null;
  private ticker: NodeJS.Timeout | null = null;
  private stopped = true;
  private manual = false;
  /** Bumped on every (re)connect so a stale attempt cannot install its link. */
  private generation = 0;
  /** MAC for a manual connect that is not saved yet (saved only on success). */
  private trying: string | null = null;

  constructor(
    readonly config: EngineConfig,
    private readonly connector: Connector,
    private readonly hooks: EngineHooks,
    private readonly retryMs = RETRY_MS,
    private readonly tickMs = TICK_MS,
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.ticker = setInterval(() => void this.tick(), this.tickMs);
    this.ticker.unref?.();
    void this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    this.clearRetry();
    await this.drop(null);
    this.status = { device: "disabled", error: null, connectedAt: null };
  }

  getStatus(): EngineStatus {
    return { ...this.status, mac: this.hooks.getMac(), manualDisconnect: this.manual };
  }

  /** Run `fn` on the connected device, after any queued work. */
  run<T>(fn: (pixoo: Pixoo) => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      const pixoo = this.pixoo;
      if (!pixoo) {
        const { device, error } = this.status;
        throw new Error(error ? `device ${device}: ${error}` : `device ${device}`);
      }
      try {
        return await fn(pixoo);
      } catch (e) {
        if (!pixoo.isConnected || isLinkError(e)) await this.drop(e);
        throw e;
      }
    });
    this.queue = next.catch(() => {});
    return next;
  }

  /**
   * Connect now (the UI's Connect button), to `mac` or the saved MAC. Clears a
   * manual disconnect. On failure the engine keeps retrying the saved MAC.
   */
  async connectNow(mac?: string): Promise<{ ok: true } | { ok: false; error: string }> {
    this.manual = false;
    this.clearRetry();
    await this.drop(null);
    this.trying = mac ?? null;
    try {
      await this.connect();
    } finally {
      this.trying = null;
    }
    return this.pixoo ? { ok: true } : { ok: false, error: this.status.error ?? `device ${this.status.device}` };
  }

  /** Release the device (e.g. to use the Divoom app) and stop reconnecting. */
  async disconnect(): Promise<void> {
    this.manual = true;
    this.clearRetry();
    await this.drop(null);
    this.status = { device: "disconnected", error: null, connectedAt: null };
    log("disconnected by user");
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.manual) return;
    const mac = this.trying ?? this.hooks.getMac();
    if (!mac) {
      this.status = { device: "disabled", error: null, connectedAt: null };
      return;
    }
    const gen = ++this.generation;
    this.status = { ...this.status, device: "connecting" };
    try {
      const transport = await this.connector(mac, (e) => {
        if (gen === this.generation) void this.drop(e ?? new Error("device hung up"));
      });
      if (this.stopped || this.manual || gen !== this.generation) {
        await transport.close();
        return;
      }
      this.pixoo = new Pixoo(transport);
      this.status = { device: "connected", error: null, connectedAt: new Date().toISOString() };
      log(`connected to ${mac}`);
      if (this.hooks.onConnected) {
        await this.run((p) => this.hooks.onConnected!(p)).catch((e) => log(`applying device config failed: ${message(e)}`));
      }
    } catch (e) {
      if (gen !== this.generation) return;
      this.status = { device: "error", error: message(e), connectedAt: null };
      this.schedule();
    }
  }

  private async tick(): Promise<void> {
    if (!this.pixoo || !this.hooks.onTick) return;
    await this.run((p) => this.hooks.onTick!(p)).catch((e) => log(`tick failed: ${message(e)}`));
  }

  private async drop(cause: unknown): Promise<void> {
    const pixoo = this.pixoo;
    this.pixoo = null;
    if (pixoo) await pixoo.disconnect();
    if (cause === null || this.stopped || this.manual) return;
    log(`link lost: ${message(cause)}`);
    this.status = { device: "error", error: message(cause), connectedAt: null };
    this.schedule();
  }

  private schedule(): void {
    if (this.stopped || this.manual || this.retry) return;
    this.retry = setTimeout(() => {
      this.retry = null;
      void this.connect();
    }, this.retryMs);
  }

  private clearRetry(): void {
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
  }
}

const LINK_ERRORS = new Set(["EIO", "ENOTCONN", "EPIPE", "ECONNRESET", "EHOSTDOWN", "EHOSTUNREACH", "EBADF"]);

function isLinkError(e: unknown): boolean {
  const code = (e as NodeJS.ErrnoException | null)?.code;
  return code !== undefined && LINK_ERRORS.has(code);
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

declare global {
  var __pxlsEngine: Engine | undefined;
}

/** The process-wide engine. Survives dev-mode module reloads. */
export function getEngine(): Engine {
  if (!globalThis.__pxlsEngine) {
    const config = readConfig();
    const settings = () => loadConfig(getDb());
    const engine = new Engine(
      config,
      (mac, onHangup) => RfcommTransport.connect({ mac, channel: config.channel, dev: config.rfcommDev, onHangup }),
      {
        getMac: () => settings().pixoo_mac.trim() || config.mac,
        onConnected: (p) => applyDeviceConfig(p, settings().device_config),
        // Native modes are re-applied as keep-alive. Never send a set_color
        // heartbeat here: it overwrites the native display (clock, blank, clock).
        onTick: async (p) => {
          const m = nativeMode(settings().device_config);
          if (m) await p.setMode(m);
        },
      },
    );
    // Close the link cleanly when the container stops.
    process.once("SIGTERM", () => void engine.stop());
    globalThis.__pxlsEngine = engine;
  }
  return globalThis.__pxlsEngine;
}
