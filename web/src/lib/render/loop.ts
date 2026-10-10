// The render loop. Port of rendering/loop_renderer.rs.
//
// Every refresh_interval_ms (1 s by default):
// - Custom mode: rotate the enabled pages every rotation_time_secs (or the
//   page's own duration_secs). Rendered
//   pages are drawn and pushed; Divoom pages are applied as native modes only
//   on page change or every 10 s (User GIFs: every 5 minutes, since re-sending
//   restarts its slideshow), since the device renders them itself.
// - Native mode: re-apply the mode on change or every 10 s, as display
//   refresh and keep-alive. Never send a set_color heartbeat here: it
//   overwrites the native display (clock, blank, clock flicker).
// Connection handling lives in the engine; tools and notifications hook in
// through `pause`.

import type { Config } from "@/lib/config/model";
import type { Engine } from "@/lib/engine/engine";
import { nativeMode, pageMode } from "@/lib/engine/modes";
import type { LightMode } from "@/lib/protocol";
import type { Canvas } from "./canvas";
import { enabledPages, isDivoomPage, type CustomPage } from "./pageTypes";

export const NATIVE_REAPPLY_MS = 10_000;
/**
 * The User GIFs channel plays its own slideshow, and sending the mode again
 * restarts it from the first GIF. Re-applying every 10 s would show only the
 * GIFs that fit in 10 s, so this one is re-sent rarely, as a safety net.
 */
export const USER_REAPPLY_MS = 5 * 60_000;
const reapplyMs = (kind: string) => (kind === "user" || kind === "DivoomUser" ? USER_REAPPLY_MS : NATIVE_REAPPLY_MS);
const MIN_INTERVAL_MS = 50;
const FAILURES_BEFORE_RECONNECT = 5;

export interface LoopDeps {
  engine: Pick<Engine, "run" | "getStatus" | "forceReconnect">;
  config: () => Config;
  render: (page: CustomPage) => Promise<Canvas>;
  /** A tool owns the display right now: stay quiet. */
  pause?: () => Promise<boolean>;
  /** The active webhook notification as a frame, drawn over everything else. */
  notification?: () => Canvas | null;
  now?: () => number;
}

export class RenderLoop {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private index = 0;
  private lastSwitch: number;
  private lastNative: string | null = null;
  private lastNativeAt = 0;
  private lastDivoomIndex: number | null = null;
  private lastDivoomAt = 0;
  private failures = 0;
  private showingNotification = false;

  constructor(private readonly deps: LoopDeps) {
    this.lastSwitch = this.now();
  }

  private now = () => (this.deps.now ?? Date.now)();

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule(0);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Re-apply on the next tick (after a tool or notification ends). */
  resetNative(): void {
    this.lastNativeAt = 0;
    this.lastDivoomIndex = null;
    this.lastDivoomAt = 0;
  }

  private schedule(ms: number) {
    if (!this.running) return;
    this.timer = setTimeout(async () => {
      let next = 1000;
      try {
        next = await this.tick();
      } catch (e) {
        console.error(`[render] tick failed: ${(e as Error).message}`);
      }
      this.schedule(next);
    }, ms);
    this.timer.unref?.();
  }

  /** One pass; returns the delay until the next. Public for tests. */
  async tick(): Promise<number> {
    const cfg = this.deps.config();
    const interval = Math.max(MIN_INTERVAL_MS, cfg.refresh_interval_ms || 1000);
    if (this.deps.pause && (await this.deps.pause())) {
      this.resetNative();
      return interval;
    }
    if (this.deps.engine.getStatus().device !== "connected") return interval;

    // A notification draws over pages and native modes (every 500 ms at most,
    // so flashing works). When it ends, re-apply at once instead of in 10 s.
    const note = this.deps.notification?.() ?? null;
    if (note) {
      this.showingNotification = true;
      await this.push(note);
      return Math.min(interval, 500);
    }
    if (this.showingNotification) {
      this.showingNotification = false;
      this.resetNative();
    }

    const pages = enabledPages(cfg.custom_pages);
    const dc = cfg.device_config;

    if (dc.light_mode === "custom" && pages.length > 0) {
      const now = this.now();
      // Each page may override the global rotation time for how long it stays up.
      this.index %= pages.length;
      const own = pages[this.index]!.duration_secs;
      const displaySecs = typeof own === "number" && own > 0 ? own : cfg.rotation_time_secs;
      if (now - this.lastSwitch >= displaySecs * 1000) {
        this.index = (this.index + 1) % pages.length;
        this.lastSwitch = now;
      }
      const page = pages[this.index]!;

      if (isDivoomPage(page.page_type)) {
        const changed = this.lastDivoomIndex !== this.index;
        if (changed || now - this.lastDivoomAt >= reapplyMs(page.page_type.type)) {
          this.lastDivoomAt = now;
          const m = pageMode(page.page_type as unknown as { type: string } & Record<string, unknown>);
          if (await this.send(m)) this.lastDivoomIndex = this.index;
        }
      } else {
        this.lastDivoomIndex = null;
        const frame = await this.deps.render(page);
        await this.push(frame);
      }
    } else {
      // Native (device-level) mode.
      const now = this.now();
      const changed = dc.light_mode !== this.lastNative;
      if (changed || now - this.lastNativeAt >= reapplyMs(dc.light_mode)) {
        this.lastNative = dc.light_mode;
        this.lastNativeAt = now;
        await this.send(nativeMode(dc));
      }
    }
    return interval;
  }

  private async send(m: LightMode | null): Promise<boolean> {
    if (!m) return true;
    return this.attempt(() => this.deps.engine.run((p) => p.setMode(m)));
  }

  private async push(frame: Canvas): Promise<boolean> {
    return this.attempt(() => this.deps.engine.run((p) => p.setImage(frame.toImage())));
  }

  private async attempt(fn: () => Promise<void>): Promise<boolean> {
    try {
      await fn();
      this.failures = 0;
      return true;
    } catch (e) {
      // Link errors already make the engine reconnect; this catches a device
      // that keeps refusing without a link error.
      if (++this.failures >= FAILURES_BEFORE_RECONNECT) {
        console.warn(`[render] ${this.failures} failures in a row, reconnecting: ${(e as Error).message}`);
        this.failures = 0;
        this.deps.engine.forceReconnect();
      }
      return false;
    }
  }
}
