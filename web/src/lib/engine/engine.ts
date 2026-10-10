// The display engine: owns the Bluetooth link inside the Next.js server process.
//
// One instance per process (see getEngine). Device work goes through run(),
// which queues calls so the API and the render loop never interleave packets.
// A failed send or a hangup drops the link and reconnects every RETRY_MS,
// unless the user disconnected on purpose (to use the Divoom app).
//
// The MAC comes from the saved config (set with Connect in the UI), falling
// back to PIXOO_MAC. On every connect the device config is applied. What the
// display shows is driven by the render loop (lib/render/loop.ts).

import { getDb } from "@/lib/db/sqlite";
import { loadConfig } from "@/lib/config/store";
import { Pixoo } from "@/lib/device/pixoo";
import { RfcommTransport } from "@/lib/device/rfcomm";
import type { Transport } from "@/lib/device/types";
import { TokenManager } from "@/lib/render/beszel";
import { renderPage } from "@/lib/render";
import { RenderLoop } from "@/lib/render/loop";
import { endTool } from "@/lib/tools/service";
import { NotificationManager, renderNotification } from "@/lib/webhooks/notifications";
import { ToolTimer } from "@/lib/tools/state";
import { readConfig, type EngineConfig } from "./config";
import { applyDeviceConfig } from "./modes";

export const RETRY_MS = 2000;
/** Longest a connect attempt may take: opening the Bluetooth serial port blocks until the device answers. */
export const CONNECT_TIMEOUT_MS = 20_000;

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
  /** Don't reconnect yet (a tool is running and owns the display). */
  holdReconnect?: () => boolean;
}

const log = (msg: string) => console.log(`[engine] ${msg}`);

export class Engine {
  private pixoo: Pixoo | null = null;
  private status: Omit<EngineStatus, "mac" | "manualDisconnect"> = { device: "disabled", error: null, connectedAt: null };
  private queue: Promise<unknown> = Promise.resolve();
  private retry: NodeJS.Timeout | null = null;
  private stopped = true;
  private manual = false;
  /** Bumped on every (re)connect so a stale attempt cannot install its link. */
  private generation = 0;
  /** MAC for a manual connect that is not saved yet (saved only on success). */
  private trying: string | null = null;
  /** The connector call that is still running, including one that timed out. */
  private inFlight: Promise<unknown> | null = null;

  constructor(
    readonly config: EngineConfig,
    private readonly connector: Connector,
    private readonly hooks: EngineHooks,
    private readonly retryMs = RETRY_MS,
    private readonly connectTimeoutMs = CONNECT_TIMEOUT_MS,
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
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
    if (!this.trying && this.hooks.holdReconnect?.()) {
      this.schedule();
      return;
    }
    const mac = this.trying ?? this.hooks.getMac();
    if (!mac) {
      this.status = { device: "disabled", error: null, connectedAt: null };
      return;
    }
    // A timed-out attempt may still be blocked in the OS. Starting another
    // would pile up blocked threads, so wait for it to finish first.
    if (this.inFlight) {
      this.status = { device: "error", error: "a previous connection attempt is still in progress", connectedAt: null };
      this.schedule();
      return;
    }
    const gen = ++this.generation;
    this.status = { ...this.status, device: "connecting" };
    try {
      const transport = await this.connectWithin(mac, (e) => {
        if (gen === this.generation) void this.drop(e ?? new Error("device hung up"));
      });
      if (this.stopped || this.manual || gen !== this.generation) {
        await transport.close();
        return;
      }
      // PXLS_LOG_PACKETS=1 logs every packet sent, in hex.
      this.pixoo = new Pixoo(transport, process.env.PXLS_LOG_PACKETS === "1" ? (m) => log(m) : undefined);
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

  /**
   * Run the connector for at most connectTimeoutMs. If it finishes later, the
   * link it opened is closed instead of leaked.
   */
  private async connectWithin(mac: string, onHangup: (e?: Error) => void): Promise<Transport> {
    const attempt = this.connector(mac, onHangup);
    const settled = attempt.then(
      () => undefined,
      () => undefined,
    );
    this.inFlight = settled;
    void settled.then(() => {
      if (this.inFlight === settled) this.inFlight = null;
    });
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`timed out after ${Math.round(this.connectTimeoutMs / 1000)}s connecting to ${mac}`)),
        this.connectTimeoutMs,
      );
    });
    try {
      return await Promise.race([attempt, timeout]);
    } catch (e) {
      void attempt.then((late) => late.close()).catch(() => {});
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Drop the link and reconnect (the render loop gives up on a stuck device). */
  forceReconnect(): void {
    if (this.manual || this.stopped) return;
    void this.drop(new Error("forced reconnect"));
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
  var __pxlsTokens: TokenManager | undefined;
  var __pxlsTools: ToolTimer | undefined;
  var __pxlsNotifications: NotificationManager | undefined;
  var __pxlsLoop: RenderLoop | undefined;
}

/** The process-wide engine and its render loop. Survives dev-mode reloads. */
export function getEngine(): Engine {
  if (!globalThis.__pxlsEngine) {
    const config = readConfig();
    const settings = () => loadConfig(getDb());
    const tools = new ToolTimer();
    const engine = new Engine(
      config,
      (mac, onHangup) => RfcommTransport.connect({ mac, channel: config.channel, dev: config.rfcommDev, onHangup }),
      {
        getMac: () => settings().pixoo_mac.trim() || config.mac,
        // A running tool owns the display: don't overwrite it on reconnect.
        onConnected: async (p) => {
          if (!tools.isActive()) await applyDeviceConfig(p, settings().device_config);
        },
        holdReconnect: () => tools.isActive(),
      },
    );
    const tokens = new TokenManager(settings);
    const notifications = new NotificationManager();
    const loop = new RenderLoop({
      notification: () => {
        const n = notifications.current();
        return n ? renderNotification(n) : null;
      },
      engine,
      config: settings,
      render: (page) => renderPage(page, { timeZone: settings().timezone, tokens }),
      // Tools pause rendering. When a timed tool runs out, put the display back
      // at once on the same link (no reconnect), then rendering resumes.
      pause: async () => {
        const expired = tools.pollExpired();
        if (expired) {
          await engine
            .run((p) => endTool(p, expired, false, settings().device_config))
            .then(() => console.log(`[tools] ${expired} finished, display restored`))
            .catch((e) => console.warn(`[tools] restoring the display failed: ${(e as Error).message}`));
        }
        return tools.isActive();
      },
    });
    globalThis.__pxlsTools = tools;
    globalThis.__pxlsNotifications = notifications;
    globalThis.__pxlsTokens = tokens;
    globalThis.__pxlsLoop = loop;
    // Close the link cleanly when the container stops.
    process.once("SIGTERM", () => {
      loop.stop();
      void engine.stop();
    });
    globalThis.__pxlsEngine = engine;
    loop.start();
  }
  return globalThis.__pxlsEngine;
}

/** Webhook notifications shown by the render loop. */
export function getNotifications(): NotificationManager {
  getEngine();
  return globalThis.__pxlsNotifications!;
}

/** The running-tool record shared by the routes, status and render loop. */
export function getTools(): ToolTimer {
  getEngine();
  return globalThis.__pxlsTools!;
}

/** The Beszel token manager shared by the pages and the Beszel API. */
export function getTokens(): TokenManager {
  getEngine();
  return globalThis.__pxlsTokens!;
}
