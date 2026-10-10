import { describe, expect, it } from "vitest";
import { ToolTimer } from "@/lib/tools/state";

function timer() {
  let now = 1_000_000;
  const t = new ToolTimer(() => now);
  return { t, advance: (s: number) => (now += s * 1000) };
}

describe("ToolTimer", () => {
  it("is idle by default", () => {
    const { t } = timer();
    expect([t.isActive(), t.kind(), t.remainingMs()]).toEqual([false, null, null]);
  });

  it("counts a countdown down, then expires", () => {
    const { t, advance } = timer();
    t.begin("countdown", 60_000);
    expect([t.kind(), t.remainingMs()]).toEqual(["countdown", 60_000]);
    advance(45);
    expect(t.remainingMs()).toBe(15_000);
    advance(15);
    expect([t.isActive(), t.kind(), t.remainingMs()]).toEqual([false, null, null]);
  });

  it("reports an expiry exactly once", () => {
    const { t, advance } = timer();
    t.begin("sound_detector", 10_000);
    expect(t.pollExpired()).toBeNull();
    advance(10);
    expect(t.pollExpired()).toBe("sound_detector");
    expect(t.pollExpired()).toBeNull();
  });

  it("never expires the scoreboard", () => {
    const { t, advance } = timer();
    t.begin("scoreboard", null);
    advance(100_000);
    expect([t.kind(), t.remainingMs(), t.pollExpired()]).toEqual(["scoreboard", null, null]);
  });

  it("treats end() as a stop, not an expiry", () => {
    const { t } = timer();
    t.begin("countdown", 5000);
    expect(t.end()).toBe(true);
    expect([t.isActive(), t.pollExpired(), t.end()]).toEqual([false, null, false]);
  });

  it("can stop then start right away", () => {
    const { t } = timer();
    t.begin("countdown", 5000);
    t.end();
    t.begin("scoreboard", null);
    expect(t.kind()).toBe("scoreboard");
  });
});
