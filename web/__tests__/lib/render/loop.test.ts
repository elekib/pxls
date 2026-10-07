import { describe, expect, it } from "vitest";
import { normalizeConfig } from "@/lib/config/model";
import { Pixoo } from "@/lib/device/pixoo";
import { MemoryTransport } from "@/lib/device/memory";
import { Canvas } from "@/lib/render/canvas";
import { RenderLoop } from "@/lib/render/loop";

function setup(cfg: object, opts: { connected?: boolean; pause?: boolean } = {}) {
  const t = new MemoryTransport();
  const pixoo = new Pixoo(t);
  let now = 1_000_000;
  let reconnects = 0;
  const rendered: string[] = [];
  const config = normalizeConfig(cfg);
  const loop = new RenderLoop({
    engine: {
      run: (fn) => fn(pixoo),
      getStatus: () => ({ device: opts.connected === false ? "error" : "connected", error: null, connectedAt: null, mac: null, manualDisconnect: false }),
      forceReconnect: () => void reconnects++,
    },
    config: () => config,
    render: async (page) => {
      rendered.push(page.name);
      return new Canvas([255, 0, 0]);
    },
    pause: async () => !!opts.pause,
    now: () => now,
  });
  return { loop, t, rendered, config, advance: (ms: number) => (now += ms), reconnects: () => reconnects };
}

const page = (name: string, type: object, enabled = true) => ({ name, enabled, page_type: type });
const text = (name: string) => page(name, { type: "CustomText", text: name, y: 0, color: "FFFFFF", background_color: "000000", scroll_speed: 500, enable_scroll: false });
const cmds = (t: MemoryTransport) => t.packets.map((p) => p[3]);

describe("RenderLoop", () => {
  it("rotates enabled pages every rotation_time_secs and pushes images", async () => {
    const s = setup({
      refresh_interval_ms: 1000,
      rotation_time_secs: 5,
      device_config: { light_mode: "custom" },
      custom_pages: [text("A"), text("off", ), { ...text("B") }, page("C", { type: "CustomPixels", pixels: [] }, false)].map((p, i) => (i === 1 ? { ...p, enabled: false } : p)),
    });
    expect(await s.loop.tick()).toBe(1000);
    s.advance(4000);
    await s.loop.tick();
    s.advance(1000);
    await s.loop.tick();
    s.advance(5000);
    await s.loop.tick();
    expect(s.rendered).toEqual(["A", "A", "B", "A"]);
    expect(cmds(s.t).every((c) => c === 0x44)).toBe(true);
  });

  it("applies Divoom pages only on change or every 10 s", async () => {
    const s = setup({
      rotation_time_secs: 60,
      device_config: { light_mode: "custom" },
      custom_pages: [page("D", { type: "DivoomMusic", mode: "fireworks" })],
    });
    for (let i = 0; i < 9; i++) {
      await s.loop.tick();
      s.advance(1000);
    }
    expect(s.t.packets).toHaveLength(1);
    expect(Array.from(s.t.packets[0]!.subarray(3, 6))).toEqual([0x45, 0x04, 0x0a]);
    s.advance(1000);
    await s.loop.tick();
    expect(s.t.packets).toHaveLength(2);
  });

  it("re-applies native modes on change or every 10 s, never a colour heartbeat", async () => {
    const s = setup({ device_config: { light_mode: "user" } });
    await s.loop.tick();
    s.advance(5000);
    await s.loop.tick();
    expect(s.t.packets).toHaveLength(1);
    s.config.device_config.light_mode = "score";
    await s.loop.tick();
    s.advance(10_000);
    await s.loop.tick();
    expect(cmds(s.t)).toEqual([0x45, 0x45, 0x45]);
  });

  it("sends nothing while disconnected or paused, and re-applies after a pause", async () => {
    const off = setup({ device_config: { light_mode: "user" } }, { connected: false });
    await off.loop.tick();
    expect(off.t.packets).toHaveLength(0);
    const paused = setup({ device_config: { light_mode: "user" } }, { pause: true });
    await paused.loop.tick();
    expect(paused.t.packets).toHaveLength(0);
  });

  it("forces a reconnect after five failed sends in a row", async () => {
    const s = setup({ device_config: { light_mode: "user" } });
    await s.t.close();
    for (let i = 0; i < 5; i++) {
      s.advance(10_000);
      await s.loop.tick();
    }
    expect(s.reconnects()).toBe(1);
  });
});

describe("RenderLoop with tools", () => {
  it("stays quiet while paused and re-applies the native mode right after", async () => {
    let paused = true;
    const t = new MemoryTransport();
    const pixoo = new Pixoo(t);
    const config = normalizeConfig({ device_config: { light_mode: "user" } });
    const loop = new RenderLoop({
      engine: {
        run: (fn) => fn(pixoo),
        getStatus: () => ({ device: "connected", error: null, connectedAt: null, mac: null, manualDisconnect: false }),
        forceReconnect: () => {},
      },
      config: () => config,
      render: async () => new Canvas(),
      pause: async () => paused,
      now: () => 0,
    });
    await loop.tick();
    expect(t.packets).toHaveLength(0);
    paused = false;
    await loop.tick();
    expect(t.packets).toHaveLength(1); // no 10 s wait after a tool
  });
});
