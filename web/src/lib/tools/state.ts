// Which on-device tool is running and for how long. One source of truth for
// the routes, the status endpoint and the render loop. The clock is injected so expiry
// can be tested.

export type ToolKind = "countdown" | "sound_detector" | "scoreboard" | "diagnostics";

interface Running {
  kind: ToolKind;
  /** Null runs until end(). */
  until: number | null;
}

export class ToolTimer {
  private running: Running | null = null;

  constructor(private readonly now: () => number = Date.now) {}

  /** Record a tool as running, replacing any earlier one. Call before sending. */
  begin(kind: ToolKind, durationMs: number | null): void {
    this.running = { kind, until: durationMs === null ? null : this.now() + durationMs };
  }

  /** Stop the tool. Returns whether one was recorded (even if expired). */
  end(): boolean {
    const was = this.running !== null;
    this.running = null;
    return was;
  }

  isActive(): boolean {
    return this.kind() !== null;
  }

  /** The running tool, or null when none was started or its time is up. */
  kind(): ToolKind | null {
    const r = this.running;
    if (!r) return null;
    return r.until !== null && this.now() >= r.until ? null : r.kind;
  }

  /** Milliseconds left on a timed tool; null for untimed tools and when expired. */
  remainingMs(): number | null {
    const r = this.running;
    if (!r || r.until === null) return null;
    const left = r.until - this.now();
    return left > 0 ? left : null;
  }

  /** The tool that just ran out, exactly once, then forgets it. */
  pollExpired(): ToolKind | null {
    const r = this.running;
    if (r && r.until !== null && this.kind() === null) {
      this.running = null;
      return r.kind;
    }
    return null;
  }
}
