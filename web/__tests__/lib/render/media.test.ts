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
  // A 3-frame 32x48 GIF: top half red / bottom half blue, then green, then white.
  const frame = (top: string, bottom: string) =>
    sharp({ create: { width: 32, height: 48, channels: 3, background: top } })
      .composite([{ input: { create: { width: 32, height: 24, channels: 3, background: bottom } }, top: 24, left: 0 }])
      .png()
      .toBuffer();
  const frames = await Promise.all([frame("#ff0000", "#0000ff"), frame("#00ff00", "#00ff00"), frame("#ffffff", "#ffffff")]);
  await sharp(frames, { join: { animated: true } })
    .gif({ delay: [100, 200, 300] })
    .toFile(path.join(dir, "uploads", "anim.gif"));
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
    // The font has no "?" glyph, so it draws as a solid red block.
    expect((await renderImageUpload("static", "../etc/passwd", 0)).get(7, 6)).toEqual([255, 0, 0]);
    expect((await renderImageUpload("static", "missing.png", 0)).data.some((v) => v === 255)).toBe(true);
    expect((await renderImageUpload("static", "broken.png", 0)).get(3, 6)).toEqual([255, 0, 0]); // "ERR"
  });
});

/** GIF colours are quantized, so compare by dominant colour. */
const hue = ([r, g, b]: readonly number[]) => (r > 200 && g > 200 && b > 200 ? "white" : r > 200 ? "red" : g > 200 ? "green" : b > 200 ? "blue" : "other");

describe("animated GIF pages", () => {
  it("scales each frame to 16x16 without stretching", async () => {
    const first = await renderImageUpload("animated", "anim.gif", 0);
    // Top half red and bottom half blue: a stretched frame would be all red.
    expect([0, 6, 9, 15].map((y) => hue(first.get(8, y)))).toEqual(["red", "red", "blue", "blue"]);
  });

  it("plays frames with a fixed duration", async () => {
    const start = Date.now();
    const seen = new Set<string>();
    while (Date.now() - start < 400) {
      seen.add(hue((await renderImageUpload("animated", "anim.gif", 50)).get(8, 0)));
      await new Promise((r) => setTimeout(r, 20));
    }
    expect([...seen].sort()).toEqual(["green", "red", "white"]);
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
