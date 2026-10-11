import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { decodeBmp } from "@/lib/uploads/bmp";
import { contentTypeFor, resolveUploadPath, sanitizeStem, sniffFormat, validateImageBytes } from "@/lib/uploads/guard";

const make = (fmt: "png" | "jpeg" | "gif" | "webp", w = 4, h = 4) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 255, g: 0, b: 0 } } }).toFormat(fmt).toBuffer();

function bmp(w: number, h: number, rgb: [number, number, number]): Uint8Array {
  const stride = Math.ceil((w * 3) / 4) * 4;
  const b = Buffer.alloc(54 + stride * h);
  b.write("BM", 0);
  b.writeUInt32LE(b.length, 2);
  b.writeUInt32LE(54, 10);
  b.writeUInt32LE(40, 14);
  b.writeInt32LE(w, 18);
  b.writeInt32LE(h, 22);
  b.writeUInt16LE(1, 26);
  b.writeUInt16LE(24, 28);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) b.set([rgb[2], rgb[1], rgb[0]], 54 + y * stride + x * 3);
  return b;
}

describe("image guard", () => {
  it("accepts real images and names the extension from the content", async () => {
    expect(await validateImageBytes(await make("png"))).toBe("png");
    expect(await validateImageBytes(await make("jpeg"))).toBe("jpg");
    expect(await validateImageBytes(await make("gif"))).toBe("gif");
    expect(await validateImageBytes(await make("webp"))).toBe("webp");
    expect(await validateImageBytes(bmp(3, 2, [1, 2, 3]))).toBe("bmp");
  });

  it("rejects non-images even with image names", async () => {
    for (const bad of ["<svg xmlns='http://www.w3.org/2000/svg'></svg>", "#!/bin/sh\nrm -rf /\n", "", "GIF89a"]) {
      await expect(validateImageBytes(Buffer.from(bad))).rejects.toThrow();
    }
  });

  it("rejects oversized dimensions from the header", async () => {
    await expect(validateImageBytes(await make("png", 4097, 1))).rejects.toThrow(/too large/);
    expect(sniffFormat(bmp(5000, 1, [0, 0, 0]))).toBe("bmp");
    await expect(validateImageBytes(bmp(5000, 1, [0, 0, 0]))).rejects.toThrow(/too large/);
  });

  it("sanitizes filenames", () => {
    expect(sanitizeStem("My Photo.PNG")).toBe("My_Photo");
    expect(sanitizeStem("../../etc/passwd")).toBe("passwd");
    expect(sanitizeStem("..\\..\\boot.ini")).toBe("boot");
    expect(sanitizeStem(".hidden")).toBe("hidden");
    expect(sanitizeStem("a<b>|c.gif")).toBe("a_b__c");
    expect(sanitizeStem("")).toBe("upload");
    expect(sanitizeStem(".....")).toBe("upload");
    expect(sanitizeStem("x".repeat(500))).toHaveLength(64);
    expect(sanitizeStem("evil\0name.png")).not.toContain("\0");
  });

  it("serves only image content types", () => {
    expect(contentTypeFor("a.png")).toBe("image/png");
    expect(contentTypeFor("a.JPG")).toBe("image/jpeg");
    expect(contentTypeFor("a.html")).toBeNull();
    expect(contentTypeFor("noext")).toBeNull();
  });

  it("blocks traversal and symlinks out of the uploads folder", () => {
    const root = mkdtempSync(path.join(tmpdir(), "pxls-up-"));
    try {
      const uploads = path.join(root, "uploads");
      mkdirSync(uploads);
      writeFileSync(path.join(uploads, "ok.png"), "x");
      writeFileSync(path.join(root, "secret.png"), "x");
      symlinkSync(path.join(root, "secret.png"), path.join(uploads, "link.png"));
      expect(resolveUploadPath(uploads, "ok.png")).toBeTruthy();
      for (const bad of ["missing.png", "../secret.png", "/etc/passwd", ".ok.png", "a/b.png", "a\\b.png", "", "link.png"]) {
        expect(resolveUploadPath(uploads, bad)).toBeNull();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("decodes bottom-up 24-bit BMPs", () => {
    const raw = decodeBmp(bmp(3, 2, [10, 20, 30]));
    expect([raw.width, raw.height]).toEqual([3, 2]);
    expect(Array.from(raw.data.subarray(0, 3))).toEqual([10, 20, 30]);
  });
});
