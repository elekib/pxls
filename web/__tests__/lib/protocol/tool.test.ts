import { describe, expect, it } from "vitest";
import * as frame from "@/lib/protocol/frame";
import { encode, type ToolInfo } from "@/lib/protocol/tool";

// Golden packets: known byte sequences for each command.
const pkt = (t: ToolInfo) => Array.from(frame.encode(...encode(t)));

describe("tool", () => {
  it("encodes countdown", () => {
    expect(pkt({ kind: "countdown", start: true, minutes: 5, seconds: 0 })).toEqual([
      0x01, 0x07, 0x00, 0x72, 0x03, 0x01, 0x05, 0x00, 0x82, 0x00, 0x02,
    ]);
    expect(pkt({ kind: "countdown", start: false, minutes: 0, seconds: 0 })).toEqual([
      0x01, 0x07, 0x00, 0x72, 0x03, 0x00, 0x00, 0x00, 0x7c, 0x00, 0x02,
    ]);
  });

  it("limits seconds to 0-59", () => {
    expect(() => encode({ kind: "countdown", start: true, minutes: 0, seconds: 59 })).not.toThrow();
    expect(() => encode({ kind: "countdown", start: true, minutes: 0, seconds: 60 })).toThrow(RangeError);
  });

  it("encodes noise", () => {
    expect(pkt({ kind: "noise", start: true })).toEqual([0x01, 0x05, 0x00, 0x72, 0x02, 0x01, 0x7a, 0x00, 0x02]);
    expect(pkt({ kind: "noise", start: false })).toEqual([0x01, 0x05, 0x00, 0x72, 0x02, 0x00, 0x79, 0x00, 0x02]);
  });

  it("encodes timer", () => {
    expect(pkt({ kind: "timer", start: true })).toEqual([0x01, 0x05, 0x00, 0x72, 0x00, 0x01, 0x78, 0x00, 0x02]);
    expect(pkt({ kind: "timer", start: false })).toEqual([0x01, 0x05, 0x00, 0x72, 0x00, 0x00, 0x77, 0x00, 0x02]);
  });

  it("encodes the score tool", () => {
    expect(pkt({ kind: "score", on: true, red: 12, blue: 300 })).toEqual([
      0x01, 0x08, 0x00, 0x50, 0x01, 0x0c, 0x00, 0x2c, 0x01, 0x92, 0x00, 0x02,
    ]);
  });

  it("clamps the score tool to 999", () => {
    expect(pkt({ kind: "score", on: true, red: 1000, blue: 999 }).slice(5, 9)).toEqual([0xe7, 0x03, 0xe7, 0x03]);
  });
});
