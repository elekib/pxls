import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderCustomScript, renderImageUpload } from "@/lib/render/pages/media";

let dir = "";
beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "pxls-media-"));
  process.env.PXLS_DATA_DIR = dir;
  mkdirSync(path.join(dir, "uploads"));
  await sharp({ create: { width: 40, height: 20, channels: 4, background: { r: 255, g: 136, b: 0, alpha: 1 } } })
    .png()
    .toFile(path.join(dir, "uploads", "orange.png"));
  writeFileSync(path.join(dir, "uploads", "broken.png"), "nope");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("image pages", () => {
  it("resizes an upload to 16x16 RGB", async () => {
    const c = await renderImageUpload("static", "orange.png", 0);
    expect(c.get(0, 0)).toEqual([255, 136, 0]);
    expect(c.get(15, 15)).toEqual([255, 136, 0]);
  });

  it("shows placeholders for missing, unknown and broken files", async () => {
    expect((await renderImageUpload("animated", null, 0)).get(4, 6)).toEqual([100, 100, 100]); // "GIF"
    // The font has no "?" glyph, so (as in Rust) it draws as a solid red block.
    expect((await renderImageUpload("static", "../etc/passwd", 0)).get(7, 6)).toEqual([255, 0, 0]);
    expect((await renderImageUpload("static", "missing.png", 0)).data.some((v) => v === 255)).toBe(true);
    expect((await renderImageUpload("static", "broken.png", 0)).get(3, 6)).toEqual([255, 0, 0]); // "ERR"
  });
});

describe("custom script pages", () => {
  it("draws JSON pixels and passes inputs as INPUT_ variables", async () => {
    const c = await renderCustomScript(`echo "[{\\"x\\":2,\\"y\\":3,\\"color\\":\\"$INPUT_COLOR\\"}]"`, [
      { name: "color", label: "Color", input_type: "color", default_value: "00FF00" },
    ]);
    expect(c.get(2, 3)).toEqual([0, 255, 0]);
  });

  it("shows text output, and ERR on failure or timeout", async () => {
    expect((await renderCustomScript("echo 42", [])).get(0, 6)).toEqual([255, 255, 255]);
    expect((await renderCustomScript("exit 3", [])).get(4, 6)).toEqual([255, 0, 0]);
  });
});
