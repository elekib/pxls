// A 16x16 RGB frame, the unit the render loop pushes to the display.

import type { RgbImage } from "@/lib/protocol";

export type Rgb = readonly [number, number, number];

export const SIZE = 16;
export const BLACK: Rgb = [0, 0, 0];

export class Canvas {
  readonly data = new Uint8Array(SIZE * SIZE * 3);

  constructor(fill: Rgb = BLACK) {
    if (fill !== BLACK) this.fill(fill);
  }

  fill(c: Rgb): void {
    for (let i = 0; i < this.data.length; i += 3) this.data.set(c, i);
  }

  /** Set a pixel; anything outside the frame is ignored. */
  put(x: number, y: number, c: Rgb): void {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
    this.data.set(c, (y * SIZE + x) * 3);
  }

  get(x: number, y: number): Rgb {
    const o = (y * SIZE + x) * 3;
    return [this.data[o]!, this.data[o + 1]!, this.data[o + 2]!];
  }

  static from(data: Uint8Array): Canvas {
    const c = new Canvas();
    c.data.set(data.subarray(0, c.data.length));
    return c;
  }

  toImage(): RgbImage {
    return { width: SIZE, height: SIZE, data: this.data };
  }
}
