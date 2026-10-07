// 3x5 bitmap font and text drawing. Port of backend/src/font.rs and renderer.rs;
// glyphs, widths and spacing match the Rust renderer exactly.

import type { Canvas, Rgb } from "./canvas";

const GLYPHS: Record<string, number[]> = {
  "0": [0b111, 0b101, 0b101, 0b101, 0b111],
  "1": [0b010, 0b110, 0b010, 0b010, 0b111],
  "2": [0b111, 0b001, 0b111, 0b100, 0b111],
  "3": [0b111, 0b001, 0b011, 0b001, 0b111],
  "4": [0b101, 0b101, 0b111, 0b001, 0b001],
  "5": [0b111, 0b100, 0b111, 0b001, 0b111],
  "6": [0b111, 0b100, 0b111, 0b101, 0b111],
  "7": [0b111, 0b001, 0b010, 0b100, 0b100],
  "8": [0b111, 0b101, 0b111, 0b101, 0b111],
  "9": [0b111, 0b101, 0b111, 0b001, 0b111],
  A: [0b010, 0b101, 0b111, 0b101, 0b101],
  B: [0b110, 0b101, 0b110, 0b101, 0b110],
  C: [0b111, 0b100, 0b100, 0b100, 0b111],
  D: [0b110, 0b101, 0b101, 0b101, 0b110],
  E: [0b111, 0b100, 0b111, 0b100, 0b111],
  F: [0b111, 0b100, 0b110, 0b100, 0b100],
  G: [0b111, 0b100, 0b101, 0b101, 0b111],
  H: [0b101, 0b101, 0b111, 0b101, 0b101],
  I: [0b111, 0b010, 0b010, 0b010, 0b111],
  J: [0b001, 0b001, 0b001, 0b101, 0b011],
  K: [0b101, 0b110, 0b100, 0b110, 0b101],
  L: [0b100, 0b100, 0b100, 0b100, 0b111],
  M: [0b101, 0b111, 0b101, 0b101, 0b101],
  N: [0b110, 0b101, 0b101, 0b101, 0b101],
  O: [0b111, 0b101, 0b101, 0b101, 0b111],
  P: [0b111, 0b101, 0b111, 0b100, 0b100],
  Q: [0b111, 0b101, 0b111, 0b001, 0b001],
  R: [0b110, 0b101, 0b110, 0b101, 0b101],
  S: [0b111, 0b100, 0b111, 0b001, 0b111],
  T: [0b111, 0b010, 0b010, 0b010, 0b010],
  U: [0b101, 0b101, 0b101, 0b101, 0b111],
  V: [0b101, 0b101, 0b101, 0b101, 0b010],
  W: [0b101, 0b101, 0b101, 0b111, 0b101],
  X: [0b101, 0b101, 0b010, 0b101, 0b101],
  Y: [0b101, 0b101, 0b010, 0b010, 0b010],
  Z: [0b111, 0b001, 0b010, 0b100, 0b111],
  ":": [0b000, 0b100, 0b000, 0b100, 0b000],
  "-": [0b000, 0b000, 0b100, 0b000, 0b000],
  "*": [0b100, 0b000, 0b000, 0b000, 0b000], // degree symbol
  "/": [0b001, 0b010, 0b010, 0b100, 0b100],
  "%": [0b101, 0b001, 0b010, 0b100, 0b101],
  " ": [0b000, 0b000, 0b000, 0b000, 0b000],
};
const UNKNOWN = [0b111, 0b111, 0b111, 0b111, 0b111];

/** Rust uppercases ASCII only. */
const upper = (ch: string) => (ch >= "a" && ch <= "z" ? ch.toUpperCase() : ch);

export const glyph = (ch: string) => GLYPHS[upper(ch)] ?? UNKNOWN;

const NARROW = new Set([":", "-", ".", " ", "*"]);
const NO_GAP = new Set([":", "-", ".", ",", " ", "*"]);

/** Draw `text` with its top-left corner at (x, y). */
export function drawText(c: Canvas, text: string, x: number, y: number, color: Rgb, spacing: number): void {
  let cursor = x;
  for (const ch of text) {
    const rows = glyph(ch);
    const width = NARROW.has(ch) ? 1 : 3;
    rows.forEach((bits, row) => {
      for (let col = 0; col < width; col++) {
        if ((bits >> (2 - col)) & 1) c.put(cursor + col, y + row, color);
      }
    });
    cursor += width + (NO_GAP.has(ch) ? 0 : spacing);
  }
}
