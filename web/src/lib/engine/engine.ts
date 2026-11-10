// The display engine: owns the Bluetooth link inside the Next.js server process.
//
// One instance per process (see getEngine). Device work goes through run(),
// which queues calls so the API and the render loop never interleave packets.
// A failed send or a hangup drops the link and reconnects, backing off from
// RETRY_MS to MAX_RETRY_MS, unless the user disconnected on purpose (to use
// the Divoom app). A connect that hangs in the kernel is released on timeout
// (rfcomm release), and with PXLS_ADAPTER_RESET=1 repeated timeouts reset the
// Bluetooth adapter.
//
// The MAC comes from the saved config (set with Connect in the UI), falling
// back to PIXOO_MAC. On every connect the device config is applied. What the
// display shows is driven by the render loop (lib/render/loop.ts).

import { getDb } from "@/lib/db/sqlite";
import { loadConfig } from "@/lib/config/store";
import { Pixoo } from "@/lib/device/pixoo";
import { releaseRfcomm, resetAdapter } from "@/lib/device/bluez";
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

/** First retry delay. Each failure doubles it up to MAX_RETRY_MS; a connect resets it. */
export const RETRY_MS = 2000;
export const MAX_RETRY_MS = 60_000;
/** Longest a connect attempt may take: opening the Bluetooth serial port blocks until the device answers. */
export const CONNECT_TIMEOUT_MS = 20_000;
/** After a timeout, how long to wait for `rfcomm release` to free the blocked open(). */
export const RELEASE_SETTLE_MS = 5_000;
/** Connect timeouts in a row before the adapter is reset (only with PXLS_ADAPTER_RESET=1). */
export const ADAPTER_RESET_AFTER = 3;
/**
 * Most timed-out attempts left blocked in the kernel at once. Each holds one of
 * libuv's 4 worker threads (file I/O, crypto); keep one free for the rest of the app.
 */
export const MAX_ABANDONED = 3;
/** A repeating failure is logged at most this often, and at least once per attempt after it. */
export const FAILURE_LOG_MS = 60_000;

export type DeviceStatus = "disabled" | "connecting" | "connected" | "disconnected" | "error";

export interface EngineStatus {
  device: DeviceStatus;
  error: string | null;
  connectedAt: string | null;
  mac: string | null;
  /** The user disconnected on purpose; no automatic reconnect. */
  manualDisconnect: boolean;
  /** When connect attempts started failing, while they still fail. */
  failingSince: string | null;
  /** Failed connect attempts since failingSince. */
  failedAttempts: number;
}

/** Internals of the reconnect logic, for health checks and tests. */
export interface LinkHealth {
  retryDelayMs: number;
  consecutiveTimeouts: number;
  /** Timed-out attempts whose open() has still not returned. */
  abandoned: number;
}

export type Connector = (mac: string, onHangup: (e?: Error) => void) => Promise<Transport>;

/** Host-side recovery for a link stuck in the kernel (see lib/device/bluez.ts). */
export interface LinkControl {
  /** Unbind the rfcomm TTY so a blocked open() returns. */
  release(): Promise<void>;
  /** Power-cycle the Bluetooth adapter; returns how it was done. */
  resetAdapter(): Promise<string>;
}

export interface EngineHooks {
  getMac: () => string | null;
  onConnected?: (pixoo: Pixoo) => Promise<void>;
  /** Don't reconnect yet (a tool is running and owns the display). */
  holdReconnect?: () => boolean;
}

export interface EngineOptions {
  link: LinkControl;
  maxRetryMs: number;
  releaseSettleMs: number;
}

const log = (msg: string) => console.log(`[engine] ${msg}`);
const warn = (msg: string) => console.warn(`[engine] ${msg}`);

class ConnectTimeoutError extends Error {}

/** The BlueZ commands for this engine's rfcomm device and adapter. */
export function bluezLink(config: EngineConfig): LinkControl {
  return {
    release: () => releaseRfcomm(config.rfcommDev),
    resetAdapter: () => resetAdapter(config.adapterIndex),
  };
}

export class Engine {
  private pixoo: Pixoo | null = null;
  private status: Omit<EngineStatus, "mac" | "manualDisconnect" | "failingSince" | "failedAttempts"> = {
    device: "disabled",
    error: null,
    connectedAt: null,
  };
  private queue: Promise<unknown> = Promise.resolve();
  private retry: NodeJS.Timeout | null = null;
  private stopped = true;
  private manual = false;
  /** Bumped on every (re)connect so a stale attempt cannot install its link. */
  private generation = 0;
  /** MAC for a manual connect that is not saved yet (saved only on success). */
  private trying: string | null = null;
  /**
   * The connect that is running now. Only one at a time, so blocked open()
   * calls cannot pile up on the worker pool. Always cleared when connectWithin
   * returns, so it can never latch.
   */
  private inFlight: { since: number } | null = null;
  /** Timed-out attempts that are still blocked after release, by start time. */
  private readonly abandoned = new Set<{ since: number }>();
  private retryDelay: number;
  private consecutiveTimeouts = 0;
  private readonly failures = new FailureLog();
  private readonly opts: EngineOptions;

  constructor(
    readonly config: EngineConfig,
    private readonly connector: Connector,
    private readonly hooks: EngineHooks,
    private readonly retryMs = RETRY_MS,
    private readonly connectTimeoutMs = CONNECT_TIMEOUT_MS,
    opts: Partial<EngineOptions> = {},
  ) {
    this.opts = {
      link: opts.link ?? bluezLink(config),
      maxRetryMs: Math.max(opts.maxRetryMs ?? MAX_RETRY_MS, retryMs),
      releaseSettleMs: opts.releaseSettleMs ?? RELEASE_SETTLE_MS,
    };
    this.retryDelay = retryMs;
  }

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
    const { since, attempts } = this.failures.state();
    return {
      ...this.status,
      mac: this.hooks.getMac(),
      manualDisconnect: this.manual,
      failingSince: since === null ? null : new Date(since).toISOString(),
      failedAttempts: attempts,
    };
  }

  linkHealth(): LinkHealth {
    return { retryDelayMs: this.retryDelay, consecutiveTimeouts: this.consecutiveTimeouts, abandoned: this.abandoned.size };
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
    this.failures.reset();
    log("disconnected by user");
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.manual || this.pixoo) return;
    if (!this.trying && this.hooks.holdReconnect?.()) {
      this.schedule(false);
      return;
    }
    const mac = this.trying ?? this.hooks.getMac();
    if (!mac) {
      this.status = { device: "disabled", error: null, connectedAt: null };
      this.failures.reset();
      return;
    }
    if (this.inFlight) {
      // Another connect (e.g. the Connect button during a retry) is still
      // running. It ends within the timeout plus the release wait.
      const error = "a previous connection attempt is still in progress";
      this.status = { device: "error", error, connectedAt: null };
      this.logFailure(`${error} (for ${duration(Date.now() - this.inFlight.since)})`, "in-flight");
      this.schedule();
      return;
    }
    if (this.abandoned.size >= MAX_ABANDONED) {
      // Starting another would block one more worker thread. Keep trying to
      // free the stuck ones instead; this counts as a timeout for the reset.
      const oldest = Math.min(...[...this.abandoned].map((a) => a.since));
      const error = `${this.abandoned.size} timed-out connection attempts are still blocked in the kernel (oldest for ${duration(Date.now() - oldest)})`;
      this.status = { device: "error", error, connectedAt: null };
      this.logFailure(error, "abandoned");
      await this.release();
      await this.countTimeout();
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
      this.clearRetry();
      this.retryDelay = this.retryMs;
      this.consecutiveTimeouts = 0;
      const { since, attempts } = this.failures.state();
      this.failures.reset();
      log(since === null ? `connected to ${mac}` : `connected to ${mac} after ${attempts} failed attempt${attempts === 1 ? "" : "s"} over ${duration(Date.now() - since)}`);
      if (this.hooks.onConnected) {
        await this.run((p) => this.hooks.onConnected!(p)).catch((e) => log(`applying device config failed: ${message(e)}`));
      }
    } catch (e) {
      if (gen !== this.generation) return;
      this.status = { device: "error", error: message(e), connectedAt: null };
      const timedOut = e instanceof ConnectTimeoutError;
      this.logFailure(message(e), timedOut ? "timeout" : message(e));
      if (timedOut) await this.countTimeout();
      this.schedule();
    }
  }

  /**
   * Run the connector for at most connectTimeoutMs. On timeout, release the
   * rfcomm device to free an open() blocked in the kernel and wait a bounded
   * time for the attempt to return. If it finishes later, the link it opened
   * is closed instead of leaked.
   */
  private async connectWithin(mac: string, onHangup: (e?: Error) => void): Promise<Transport> {
    const entry = { since: Date.now() };
    this.inFlight = entry;
    let timer: NodeJS.Timeout | undefined;
    try {
      const attempt = this.connector(mac, onHangup);
      let done = false;
      const settled = attempt.then(
        () => (done = true),
        () => (done = true),
      );
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new ConnectTimeoutError(`timed out after ${Math.round(this.connectTimeoutMs / 1000)}s connecting to ${mac}`)),
          this.connectTimeoutMs,
        );
      });
      try {
        return await Promise.race([attempt, timeout]);
      } catch (e) {
        void attempt.then((late) => late.close()).catch(() => {});
        if (e instanceof ConnectTimeoutError) await this.cancel(entry, settled, () => done);
        throw e;
      }
    } finally {
      clearTimeout(timer);
      if (this.inFlight === entry) this.inFlight = null;
    }
  }

  /** Free a timed-out attempt: release the TTY, then give it a bounded time to return. */
  private async cancel(entry: { since: number }, settled: Promise<unknown>, isDone: () => boolean): Promise<void> {
    await this.release();
    let wait: NodeJS.Timeout | undefined;
    await Promise.race([settled, new Promise<void>((r) => (wait = setTimeout(r, this.opts.releaseSettleMs)))]);
    clearTimeout(wait);
    const dev = `rfcomm${this.config.rfcommDev}`;
    if (isDone()) {
      log(`connect timed out; released ${dev} and the blocked open() returned`);
      return;
    }
    // Still blocked: stop waiting so the engine cannot stay stuck, but keep
    // count so blocked threads cannot pile up (see MAX_ABANDONED).
    this.abandoned.add(entry);
    void settled.then(() => {
      if (this.abandoned.delete(entry)) log(`an abandoned connect attempt returned after ${duration(Date.now() - entry.since)}`);
    });
    warn(
      `connect timed out; released ${dev} but open() is still blocked after ${duration(this.opts.releaseSettleMs)}; ` +
        `abandoning it (${this.abandoned.size} blocked)`,
    );
  }

  private async release(): Promise<void> {
    await this.opts.link.release().catch((e) => warn(`rfcomm release ${this.config.rfcommDev} failed: ${message(e)}`));
  }

  /** Count a connect timeout; reset the adapter after ADAPTER_RESET_AFTER in a row if allowed. */
  private async countTimeout(): Promise<void> {
    this.consecutiveTimeouts++;
    if (this.consecutiveTimeouts < ADAPTER_RESET_AFTER) return;
    const hci = `hci${this.config.adapterIndex}`;
    if (!this.config.adapterReset) {
      if (this.consecutiveTimeouts === ADAPTER_RESET_AFTER) {
        warn(
          `${ADAPTER_RESET_AFTER} connect timeouts in a row; the Bluetooth controller may be stuck. ` +
            `Run \`hciconfig ${hci} reset\` on the host, or set PXLS_ADAPTER_RESET=1 to let pxls reset ${hci}.`,
        );
      }
      return;
    }
    this.consecutiveTimeouts = 0;
    warn(`${ADAPTER_RESET_AFTER} connect timeouts in a row; resetting Bluetooth adapter ${hci} (PXLS_ADAPTER_RESET=1)`);
    try {
      const how = await this.opts.link.resetAdapter();
      log(`reset ${hci} with ${how}`);
      // A reset usually clears it; try again soon.
      this.retryDelay = this.retryMs;
    } catch (e) {
      warn(`resetting ${hci} failed: ${message(e)}`);
    }
  }

  private logFailure(error: string, key: string): void {
    const line = this.failures.failure(error, key, Date.now());
    if (line) warn(line);
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

  /** Retry later. With `backoff`, the delay doubles each time up to maxRetryMs. */
  private schedule(backoff = true): void {
    if (this.stopped || this.manual || this.retry) return;
    const delay = backoff ? this.retryDelay : this.retryMs;
    if (backoff) this.retryDelay = Math.min(this.retryDelay * 2, this.opts.maxRetryMs);
    this.retry = setTimeout(() => {
      this.retry = null;
      void this.connect();
    }, delay);
  }

  private clearRetry(): void {
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
  }
}

/**
 * Rate-limits connect failure logs: a new kind of failure is logged at once,
 * a repeat at most every FAILURE_LOG_MS, always with how long it has lasted.
 */
export class FailureLog {
  private since: number | null = null;
  private attempts = 0;
  private lastKey: string | null = null;
  private lastLogged = 0;

  constructor(private readonly everyMs = FAILURE_LOG_MS) {}

  /** Record a failure; returns the line to log, or null to stay quiet. */
  failure(error: string, key: string, now: number): string | null {
    this.since ??= now;
    this.attempts++;
    const repeat = key === this.lastKey && now - this.lastLogged < this.everyMs;
    this.lastKey = key;
    if (repeat) return null;
    this.lastLogged = now;
    const n = this.attempts;
    return `device down for ${duration(now - this.since)} (${n} failed attempt${n === 1 ? "" : "s"}): ${error}`;
  }

  state(): { since: number | null; attempts: number } {
    return { since: this.since, attempts: this.attempts };
  }

  reset(): void {
    this.since = null;
    this.attempts = 0;
    this.lastKey = null;
    this.lastLogged = 0;
  }
}

/** 4s, 2m05s, 1h03m. */
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`;
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
