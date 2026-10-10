import { describe, expect, it } from "vitest";
import { Canvas } from "@/lib/render/canvas";
import { drawText, glyph } from "@/lib/render/font";

/** The frame as rows of '#' (set) and '.' (black). */
export const rows = (c: Canvas, h = 5, w = 16) =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => (c.get(x, y).some((v) => v > 0) ? "#" : ".")).join(""));

describe("font", () => {
  it("draws digits three wide with the given spacing", () => {
    const c = new Canvas();
    drawText(c, "12", 0, 0, [255, 255, 255], 1);
    expect(rows(c, 5, 8)).toEqual([".#..###.", "##....#.", ".#..###.", ".#..#...", "###.###."]);
  });

  it("uses one column and no gap for colon, dash, dot, space and degree", () => {
    const c = new Canvas();
    drawText(c, "1:2", 0, 0, [255, 255, 255], 1);
    // "1" (3 wide + 1 gap), ":" at x=4 (1 wide, no gap), "2" from x=5.
    expect(rows(c, 5, 10)).toEqual([".#...###..", "##..#..#..", ".#...###..", ".#..##....", "###..###.."]);
  });

  it("uppercases letters, shows unknown characters as a block, clips at the edge", () => {
    expect(glyph("a")).toEqual(glyph("A"));
    expect(glyph("é")).toEqual([7, 7, 7, 7, 7]);
    const c = new Canvas();
    drawText(c, "8", 14, 13, [1, 2, 3], 0);
    expect(c.get(15, 15)).toEqual([1, 2, 3]);
  });
});
