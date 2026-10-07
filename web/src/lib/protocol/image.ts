// Static 16x16 image upload (`0x44`).
//
// Layout, from the public Timebox Evo write-up:
// `00 0A 0A 04 | AA LEN_LO LEN_HI 00 00 00 NN PALETTE PIXELS`
// - `NN` is the palette size (`00` means 256), `PALETTE` is `NN` RGB triples
//   in order of first use.
// - `PIXELS` holds one palette index per pixel, row by row from the top left,
//   `ceil(log2(NN))` bits each (minimum 1), filled least-significant bit first.
//
// Assumption, needs device test: `LEN` is the frame length from `AA` through
// the last pixel byte.
//
// Port of backend/src/device/image.rs. Resizing is the caller's job: the Rust
// encoder resizes with nearest neighbour, here the input must already be 16x16.

export const CMD_IMAGE = 0x44;
export const SIZE = 16;

/** A 16x16 image as packed RGB bytes, row by row from the top left. */
export interface RgbImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export function solid(r: number, g: number, b: number): RgbImage {
  const data = new Uint8Array(SIZE * SIZE * 3);
  for (let i = 0; i < data.length; i += 3) data.set([r, g, b], i);
  return { width: SIZE, height: SIZE, data };
}

/** Arguments for {@link CMD_IMAGE}. */
export function encode(img: RgbImage): Uint8Array {
  if (img.width !== SIZE || img.height !== SIZE || img.data.length !== SIZE * SIZE * 3) {
    throw new Error(`image must be ${SIZE}x${SIZE} RGB, got ${img.width}x${img.height}`);
  }

  // Palette in order of first appearance. 256 pixels, so at most 256 colors.
  const palette: number[] = [];
  const lookup = new Map<number, number>();
  const indexes = new Uint8Array(SIZE * SIZE);
  for (let p = 0; p < indexes.length; p++) {
    const o = p * 3;
    const key = ((img.data[o] as number) << 16) | ((img.data[o + 1] as number) << 8) | (img.data[o + 2] as number);
    let idx = lookup.get(key);
    if (idx === undefined) {
      idx = lookup.size;
      lookup.set(key, idx);
      palette.push(img.data[o] as number, img.data[o + 1] as number, img.data[o + 2] as number);
    }
    indexes[p] = idx;
  }

  const colors = lookup.size;
  const bits = bitsPerPixel(colors);
  const pixels = new Uint8Array(Math.ceil((indexes.length * bits) / 8));
  indexes.forEach((idx, i) => {
    for (let b = 0; b < bits; b++) {
      if ((idx >> b) & 1) {
        const bit = i * bits + b;
        pixels[bit >> 3] = (pixels[bit >> 3] as number) | (1 << (bit & 7));
      }
    }
  });

  // AA + len(2) + 000000 + NN + palette + pixels
  const frameLen = 1 + 2 + 3 + 1 + palette.length + pixels.length;
  return Uint8Array.from([
    0x00, 0x0a, 0x0a, 0x04, 0xaa,
    frameLen & 0xff, frameLen >> 8,
    0x00, 0x00, 0x00,
    colors & 0xff, // 256 wraps to 0, as the format requires
    ...palette,
    ...pixels,
  ]);
}

export function bitsPerPixel(colors: number): number {
  return colors <= 2 ? 1 : Math.ceil(Math.log2(colors));
}
