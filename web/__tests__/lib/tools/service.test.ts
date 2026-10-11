import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deviceConfig } from "@/lib/config/model";
import { frame } from "@/lib/protocol";
import { MemoryTransport } from "@/lib/device/memory";
import { Pixoo } from "@/lib/device/pixoo";
import { ToolTimer } from "@/lib/tools/state";

// A stand-in engine over an in-memory link.
const h = vi.hoisted(() => ({ t: null as unknown as MemoryTransport, p: null as unknown as Pixoo, tools: null as unknown as ToolTimer, reconnects: 0 }));
vi.mock("@/lib/engine/engine", () => ({
  getEngine: () => ({ run: (fn: (p: Pixoo) => Promise<unknown>) => fn(h.p), forceReconnect: () => void h.reconnects++ }),
  getTools: () => h.tools,
}));
vi.mock("@/lib/db/sqlite", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/config/store", async () => ({ loadConfig: () => ({ device_config: deviceConfig.parse({ brightness: 50, light_mode: "user" }) }) }));

const { endTool, playBuzzer, setScoreboard, startCountdown, startSoundDetector, stopTool } = await import("@/lib/tools/service");

const packet = (cmd: number, args: number[]) => Array.from(frame.encode(cmd, args));
const sent = () => h.t.packets.map((p) => Array.from(p));

beforeEach(() => {
  h.t = new MemoryTransport();
  h.p = new Pixoo(h.t);
  h.tools = new ToolTimer();
  h.reconnects = 0;
  delete process.env.PXLS_TOOL_CLOSE_LINK;
});
afterEach(() => delete process.env.PXLS_TOOL_CLOSE_LINK);

describe("tools", () => {
  it("sends the buzzer on the open link", async () => {
    expect(await playBuzzer(1000)).toMatchObject({ ok: true, body: { duration_ms: 1000 } });
    expect(sent()).toEqual([packet(0x31, [0xe8, 0x03])]);
    expect(h.t.closes).toBe(0);
  });

  it("starts a countdown with one packet, records it, keeps the link open", async () => {
    expect(await startCountdown(1, 5)).toMatchObject({ ok: true, body: { message: "Countdown started: 1m 5s" } });
    expect(sent()).toEqual([packet(0x72, [0x03, 1, 1, 5])]);
    expect(h.tools.kind()).toBe("countdown");
    expect(h.tools.remainingMs()).toBeGreaterThan(64_000);
    expect(h.t.isOpen).toBe(true);
  });

  it("rejects zero and bad seconds without sending", async () => {
    expect(await startCountdown(0, 0)).toMatchObject({ ok: false, status: 400 });
    expect(await startCountdown(1, 60)).toMatchObject({ ok: false, status: 500 });
    expect(await startCountdown("1", 5)).toMatchObject({ ok: false, status: 400 });
    expect(h.t.packets).toHaveLength(0);
    expect(h.tools.isActive()).toBe(false);
  });

  it("starts the sound detector for five minutes", async () => {
    await startSoundDetector();
    expect(sent()).toEqual([packet(0x72, [0x02, 1])]);
    expect(h.tools.kind()).toBe("sound_detector");
  });

  it("closes the link after a tool in fallback mode", async () => {
    process.env.PXLS_TOOL_CLOSE_LINK = "1";
    await startCountdown(0, 30);
    expect(h.t.packets).toHaveLength(1);
    expect(h.t.closes).toBe(1);
  });

  it("updates the scoreboard with exactly one mode packet", async () => {
    expect(await setScoreboard(12, 1500)).toMatchObject({ ok: true, body: { red_score: 12, blue_score: 1500 } });
    expect(sent()).toEqual([packet(0x45, [0x06, 0x00, 12, 0, 0xe7, 0x03])]);
    expect(h.tools.kind()).toBe("scoreboard");
    expect(await setScoreboard(-1, 2)).toMatchObject({ ok: false, status: 400 });
  });

  it("forgets the tool when sending fails", async () => {
    await h.t.close();
    expect(await startSoundDetector()).toMatchObject({ ok: false, status: 500 });
    expect(h.tools.isActive()).toBe(false);
  });

  it("stop sends the tool's stop, then the config, on the same link", async () => {
    await startCountdown(1, 0);
    h.t.packets.length = 0;
    expect(await stopTool()).toMatchObject({ ok: true, body: { message: "Tool stopped" } });
    expect(sent()[0]).toEqual(packet(0x72, [0x03, 0, 0, 0]));
    expect(sent()[1]![3]).toBe(0x74);
    expect(h.tools.isActive()).toBe(false);
    expect(await stopTool()).toMatchObject({ body: { message: "No tool running" } });
  });

  it("an expired timer only re-applies the config", async () => {
    await endTool(h.p, "countdown", false, deviceConfig.parse({ brightness: 50, light_mode: "user" }));
    expect(sent().map((p) => p[3])).toEqual([0x74, 0x45]);
  });

  it("reconnects when stop cannot reach the device", async () => {
    await startSoundDetector();
    await h.t.close();
    expect(await stopTool()).toMatchObject({ body: { message: "Tool stopped, reconnecting to device" } });
    expect(h.reconnects).toBe(1);
  });
});
