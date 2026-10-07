import { describe, expect, it } from "vitest";
import { deviceConfig } from "@/lib/config/model";
import { Pixoo } from "@/lib/device/pixoo";
import { MemoryTransport } from "@/lib/device/memory";
import { applyDeviceConfig, nativeMode } from "@/lib/engine/modes";

const dc = (o: object) => deviceConfig.parse(o);

describe("native modes", () => {
  it("maps names like the Rust code, with fallbacks", () => {
    expect(nativeMode(dc({ light_mode: "custom" }))).toBeNull();
    expect(nativeMode(dc({ light_mode: "env", environment_config: { clock_design: "analog2", color: [1, 2, 3] } }))).toMatchObject({ kind: "env", clockDesign: 5, color: [1, 2, 3] });
    expect(nativeMode(dc({ light_mode: "env", environment_config: { clock_design: "??" } }))).toMatchObject({ clockDesign: 0 });
    expect(nativeMode(dc({ light_mode: "music", music_config: { mode: "fireworks" } }))).toEqual({ kind: "music", mode: 10 });
    expect(nativeMode(dc({ light_mode: "music", music_config: { mode: "??" } }))).toEqual({ kind: "music", mode: 0 });
    expect(nativeMode(dc({ light_mode: "special", special_config: { mode: "wave" } }))).toEqual({ kind: "special", mode: 3 });
    expect(nativeMode(dc({ light_mode: "light", brightness: 40, light_config: { effect_mode: 9, brightness: 90, on: true } }))).toMatchObject({ effect: 0, brightness: 40, on: true });
    expect(nativeMode(dc({ light_mode: "score", score_config: { red_score: 3, blue_score: 4 } }))).toEqual({ kind: "score", red: 3, blue: 4 });
  });

  it("applies brightness, then the native mode (time format is not sent)", async () => {
    const t = new MemoryTransport();
    await applyDeviceConfig(new Pixoo(t), dc({ brightness: 60, time_format: "24h", light_mode: "user" }));
    expect(t.packets.map((p) => Array.from(p))).toEqual([
      [0x01, 0x04, 0x00, 0x74, 0x3c, 0xb4, 0x00, 0x02],
      [0x01, 0x05, 0x00, 0x45, 0x05, 0x00, 0x4f, 0x00, 0x02],
    ]);
  });

  it("sends only brightness in custom mode", async () => {
    const t = new MemoryTransport();
    await applyDeviceConfig(new Pixoo(t), dc({ brightness: 50, light_mode: "custom" }));
    expect(t.packets).toHaveLength(1);
  });
});
