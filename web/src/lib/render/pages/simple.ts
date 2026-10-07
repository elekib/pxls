// Text and pixel pages. Port of pages/custom_text.rs and custom_pixels.rs.

import { hexToRgb } from "@/lib/config/model";
import { Canvas } from "../canvas";
import { drawText } from "../font";
import type { Pixel } from "../pageTypes";

export interface CustomText {
  text: string;
  y: number;
  color: string;
  background_color: string;
  scroll_speed: number;
  enable_scroll: boolean;
}

const WINDOW = 5;

/** Five characters of text, scrolling over time when longer than five. */
export function renderCustomText(p: CustomText, nowMs = Date.now()): Canvas {
  const c = new Canvas(hexToRgb(p.background_color));
  const color = hexToRgb(p.color);
  const line = [...(p.text.split("\n")[0] ?? "")];
  const speed = p.scroll_speed > 0 ? p.scroll_speed : 500;

  if (p.enable_scroll && line.length > WINDOW) {
    const padded = [...line, ..."     ", ...line];
    const total = padded.length;
    const start = Math.floor((nowMs % (speed * total)) / speed) % total;
    let shown = "";
    for (let i = 0; i < WINDOW; i++) shown += padded[(start + i) % total];
    drawText(c, shown, 0, p.y, color, 0);
  } else {
    const shown = line.slice(0, WINDOW).join("");
    const startX = Math.floor((16 - [...shown].length) / 2);
    drawText(c, shown, startX, p.y, color, 0);
  }
  return c;
}

export function renderCustomPixels(pixels: Pixel[]): Canvas {
  const c = new Canvas();
  for (const p of pixels ?? []) {
    if (p && p.x >= 0 && p.x < 16 && p.y >= 0 && p.y < 16) c.put(p.x, p.y, hexToRgb(String(p.color)));
  }
  return c;
}
