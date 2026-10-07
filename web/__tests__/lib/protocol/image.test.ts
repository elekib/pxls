import { describe, expect, it } from "vitest";
import * as frame from "@/lib/protocol/frame";
import { CMD_IMAGE, bitsPerPixel, encode, solid, type RgbImage } from "@/lib/protocol/image";

const bytes = (u: Uint8Array) => Array.from(u);

function put(img: RgbImage, x: number, y: number, rgb: [number, number, number]) {
  img.data.set(rgb, (y * img.width + x) * 3);
}

describe("image", () => {
  it("picks the bit depth", () => {
    expect([1, 2, 3, 4, 5, 256].map(bitsPerPixel)).toEqual([1, 1, 2, 2, 3, 8]);
  });

  it("encodes a solid image", () => {
    const want = [0x00, 0x0a, 0x0a, 0x04, 0xaa, 0x2a, 0x00, 0x00, 0x00, 0x00, 0x01, 0xff, 0x00, 0x00];
    expect(bytes(encode(solid(255, 0, 0)))).toEqual([...want, ...new Array(32).fill(0)]);
  });

  it("packs two colors LSB first", () => {
    const img = solid(255, 0, 0);
    put(img, 0, 0, [0, 0, 255]);
    const want = [
      0x00, 0x0a, 0x0a, 0x04, 0xaa, 0x2d, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0xff, 0xff, 0x00,
      0x00, 0xfe,
    ];
    expect(bytes(encode(img))).toEqual([...want, ...new Array(31).fill(0xff)]);
  });

  it("uses two bits for three colors", () => {
    const img = solid(0, 0, 0);
    put(img, 1, 0, [1, 1, 1]);
    put(img, 2, 0, [2, 2, 2]);
    const args = encode(img);
    expect(args[10]).toBe(3);
    expect(args[20]).toBe(0x24);
    expect(args.length).toBe(20 + 64);
  });

  it("wraps a 256 color palette to 0", () => {
    const img = solid(0, 0, 0);
    for (let i = 0; i < 256; i++) put(img, i % 16, i >> 4, [i, 0, 0]);
    const args = encode(img);
    expect(args[10]).toBe(0);
    expect(args.length).toBe(11 + 256 * 3 + 256);
  });

  it("rejects other sizes", () => {
    expect(() => encode({ width: 64, height: 64, data: new Uint8Array(64 * 64 * 3) })).toThrow();
  });

  it("matches the full packet checksum", () => {
    const img = solid(255, 0, 0);
    put(img, 0, 0, [0, 0, 255]);
    const pkt = frame.encode(CMD_IMAGE, encode(img));
    expect(bytes(pkt.subarray(0, 4))).toEqual([0x01, 0x34, 0x00, 0x44]);
    expect(bytes(pkt.subarray(pkt.length - 3))).toEqual([0x46, 0x23, 0x02]);
  });
});
