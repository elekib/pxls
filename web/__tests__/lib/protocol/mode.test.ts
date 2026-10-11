import { describe, expect, it } from "vitest";
import * as frame from "@/lib/protocol/frame";
import { CMD_MODE, ClockDesign, LightEffect, MusicMode, encode, type LightMode } from "@/lib/protocol/mode";

// Golden packets: known byte sequences for each command.
const pkt = (m: LightMode) => Array.from(frame.encode(CMD_MODE, encode(m)));

describe("mode", () => {
  it("encodes clock", () => {
    expect(
      pkt({
        kind: "env", timeFormat: "24h", clockDesign: ClockDesign.Digital, showDivoom: true,
        showWeather: true, showTemp: true, showDate: true, color: [255, 0, 0],
      }),
    ).toEqual([0x01, 0x0d, 0x00, 0x45, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x01, 0xff, 0x00, 0x00, 0x56, 0x01, 0x02]);
  });

  it("uses documented clock design indexes", () => {
    expect(Object.values(ClockDesign)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("encodes light", () => {
    expect(pkt({ kind: "light", color: [255, 120, 0], brightness: 50, effect: LightEffect.Normal, on: true })).toEqual([
      0x01, 0x0d, 0x00, 0x45, 0x01, 0xff, 0x78, 0x00, 0x32, 0x00, 0x01, 0x00, 0x00, 0x00, 0xfd, 0x01, 0x02,
    ]);
  });

  it("encodes music", () => {
    expect(pkt({ kind: "music", mode: MusicMode.BottomBars })).toEqual([0x01, 0x05, 0x00, 0x45, 0x04, 0x00, 0x4e, 0x00, 0x02]);
    expect(pkt({ kind: "music", mode: MusicMode.Fireworks })).toEqual([0x01, 0x05, 0x00, 0x45, 0x04, 0x0a, 0x58, 0x00, 0x02]);
  });

  it("keeps the observed music order", () => {
    expect(Object.keys(MusicMode)).toEqual([
      "BottomBars", "Face3", "CenterBars", "Face1", "Matrix", "FrogFace",
      "SideBars", "Face2", "FallingBlocks", "DancingBoy", "Fireworks", "DancingGirl",
    ]);
    expect(Object.values(MusicMode)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("encodes user", () => {
    expect(pkt({ kind: "user" })).toEqual([0x01, 0x05, 0x00, 0x45, 0x05, 0x00, 0x4f, 0x00, 0x02]);
  });

  it("encodes score", () => {
    expect(pkt({ kind: "score", red: 12, blue: 34 })).toEqual([
      0x01, 0x09, 0x00, 0x45, 0x06, 0x00, 0x0c, 0x00, 0x22, 0x00, 0x82, 0x00, 0x02,
    ]);
  });

  it("supports a score of 999 and clamps above it", () => {
    const p = pkt({ kind: "score", red: 999, blue: 999 });
    expect(p.slice(5, 10)).toEqual([0x00, 0xe7, 0x03, 0xe7, 0x03]);
    expect(pkt({ kind: "score", red: 5000, blue: 5000 })).toEqual(p);
  });
});
