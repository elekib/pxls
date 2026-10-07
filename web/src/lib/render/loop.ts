// The render loop. Port of rendering/loop_renderer.rs.
//
// Every refresh_interval_ms (1 s by default):
// - Custom mode: rotate the enabled pages every rotation_time_secs. Rendered
//   pages are drawn and pushed; Divoom pages are applied as native modes only
//   on page change or every 10 s, since the device renders them itself.
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
const MIN_INTERVAL_MS = 50;
const FAILURES_BEFORE_RECONNECT = 5;

export interface LoopDeps {
  engine: Pick<Engine, "run" | "getStatus" | "forceReconnect">;
  config: () => Config;
  render: (page: CustomPage) => Promise<Canvas>;
  /** Something else owns the display right now (a tool or a notification). */
  pause?: () => Promise<boolean>;
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

    const pages = enabledPages(cfg.custom_pages);
    const dc = cfg.device_config;

    if (dc.light_mode === "custom" && pages.length > 0) {
      const now = this.now();
      if (now - this.lastSwitch >= cfg.rotation_time_secs * 1000) {
        this.index = (this.index + 1) % pages.length;
        this.lastSwitch = now;
      }
      this.index %= pages.length;
      const page = pages[this.index]!;

      if (isDivoomPage(page.page_type)) {
        const changed = this.lastDivoomIndex !== this.index;
        if (changed || now - this.lastDivoomAt >= NATIVE_REAPPLY_MS) {
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
      if (changed || now - this.lastNativeAt >= NATIVE_REAPPLY_MS) {
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
