// The display engine: owns the Bluetooth link inside the Next.js server process.
//
// One instance per process (see getEngine). Device work goes through run(),
// which queues calls so the API and the render loop never interleave packets.
// A failed send or a hangup drops the link and reconnects every RETRY_MS.

import { Pixoo } from "@/lib/device/pixoo";
import { RfcommTransport } from "@/lib/device/rfcomm";
import type { Transport } from "@/lib/device/types";
import { readConfig, type EngineConfig } from "./config";

export const RETRY_MS = 2000;

export type DeviceStatus = "disabled" | "connecting" | "connected" | "error";

export interface EngineStatus {
  device: DeviceStatus;
  error: string | null;
  connectedAt: string | null;
}

export type Connector = (onHangup: (e?: Error) => void) => Promise<Transport>;

const log = (msg: string) => console.log(`[engine] ${msg}`);

export class Engine {
  private pixoo: Pixoo | null = null;
  private status: EngineStatus = { device: "disabled", error: null, connectedAt: null };
  private queue: Promise<unknown> = Promise.resolve();
  private retry: NodeJS.Timeout | null = null;
  private stopped = true;

  constructor(
    readonly config: EngineConfig,
    private readonly connector: Connector,
    private readonly retryMs = RETRY_MS,
  ) {}

  start(): void {
    if (!this.stopped) return;
    if (!this.config.mac) {
      log("PIXOO_MAC is not set; device disabled");
      return;
    }
    this.stopped = false;
    void this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    await this.drop(null);
    this.status = { device: "disabled", error: null, connectedAt: null };
  }

  getStatus(): EngineStatus {
    return { ...this.status };
  }

  /** Run `fn` on the connected device, after any queued work. */
  run<T>(fn: (pixoo: Pixoo) => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      const pixoo = this.pixoo;
      if (!pixoo) throw new Error(`device ${this.status.device}`);
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

  private async connect(): Promise<void> {
    if (this.stopped) return;
    this.status = { ...this.status, device: "connecting" };
    try {
      const transport = await this.connector((e) => void this.drop(e ?? new Error("device hung up")));
      if (this.stopped) {
        await transport.close();
        return;
      }
      this.pixoo = new Pixoo(transport);
      this.status = { device: "connected", error: null, connectedAt: new Date().toISOString() };
      log("connected");
    } catch (e) {
      this.status = { device: "error", error: message(e), connectedAt: null };
      this.schedule();
    }
  }

  private async drop(cause: unknown): Promise<void> {
    const pixoo = this.pixoo;
    this.pixoo = null;
    if (pixoo) await pixoo.disconnect();
    if (cause === null || this.stopped) return;
    log(`link lost: ${message(cause)}`);
    this.status = { device: "error", error: message(cause), connectedAt: null };
    this.schedule();
  }

  private schedule(): void {
    if (this.stopped || this.retry) return;
    this.retry = setTimeout(() => {
      this.retry = null;
      void this.connect();
    }, this.retryMs);
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
    const engine = new Engine(config, (onHangup) =>
      RfcommTransport.connect({
        mac: config.mac!,
        channel: config.channel,
        dev: config.rfcommDev,
        onHangup,
      }),
    );
    // Close the link cleanly when the container stops.
    process.once("SIGTERM", () => void engine.stop());
    globalThis.__pxlsEngine = engine;
  }
  return globalThis.__pxlsEngine;
}
