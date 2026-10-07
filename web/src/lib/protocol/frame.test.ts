import { describe, expect, it } from "vitest";
import { encode } from "./frame";

const bytes = (u: Uint8Array) => Array.from(u);

describe("frame", () => {
  it("encodes empty args", () => {
    expect(bytes(encode(0x46))).toEqual([0x01, 0x03, 0x00, 0x46, 0x49, 0x00, 0x02]);
  });

  it("matches the protocol.md brightness example with fields byte swapped", () => {
    expect(bytes(encode(0x32, [0x80]))).toEqual([0x01, 0x04, 0x00, 0x32, 0x80, 0xb6, 0x00, 0x02]);
  });

  it("uses both checksum bytes above 255", () => {
    const p = encode(0x45, [0xff, 0xff, 0xff]);
    expect(bytes(p.subarray(p.length - 3))).toEqual([0x48, 0x03, 0x02]);
  });

  it("sends argument bytes equal to markers raw", () => {
    expect(bytes(encode(0x74, [0x01]))).toEqual([0x01, 0x04, 0x00, 0x74, 0x01, 0x79, 0x00, 0x02]);
  });

  it("matches the documented brightness 50% packet", () => {
    expect(bytes(encode(0x74, [0x32]))).toEqual([0x01, 0x04, 0x00, 0x74, 0x32, 0xaa, 0x00, 0x02]);
  });
});
