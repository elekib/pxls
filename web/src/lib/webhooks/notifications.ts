// The notification shown on top of everything else, and how it is drawn.
// Image notifications blink when `flash` is set.

import { Canvas, type Rgb } from "@/lib/render/canvas";
import { drawText } from "@/lib/render/font";
import type { Rgba } from "./images";

export interface Notification {
  title: string;
  subtitle: string;
  icon: string;
  iconImage: Rgba | null;
  expiry: number;
  displayMode: string;
  backgroundColor: string;
  textColor: string;
  flash: boolean;
  flashSpeedMs: number;
  image: Rgba | null;
}

export class NotificationManager {
  private active: Notification | null = null;

  constructor(private readonly now: () => number = Date.now) {}

  trigger(n: Omit<Notification, "expiry" | "image"> & { durationSecs: number }): void {
    const { durationSecs, ...rest } = n;
    this.active = { ...rest, image: null, expiry: this.now() + durationSecs * 1000 };
    console.log(`[notify] ${n.title} (${durationSecs}s)`);
  }

  triggerImage(image: Rgba, durationSecs: number, flash: boolean, flashSpeedMs: number): void {
    this.active = {
      title: "", subtitle: "", icon: "", iconImage: null, displayMode: "image", backgroundColor: "", textColor: "",
      flash, flashSpeedMs, image, expiry: this.now() + durationSecs * 1000,
    };
  }

  /** The active notification, clearing it once expired. */
  current(): Notification | null {
    if (this.active && this.now() >= this.active.expiry) this.active = null;
    return this.active;
  }

  clear(): void {
    this.active = null;
  }
}

/** Notification colours default to cyan. */
function hexToRgb(hex: string): Rgb {
  const h = hex.replace(/^#/, "");
  return /^[0-9a-fA-F]{6}$/.test(h) ? [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)] : [0, 255, 255];
}

const CODES: [string, string][] = [["📺", "TV"], ["🎬", "MV"], ["📥", "DL"], ["🧪", "TS"], ["🔔", "NT"], ["⚡", "NR"], ["✅", "OK"], ["❌", "XX"]];

export function iconCode(icon: string): string {
  for (const [emoji, code] of CODES) if (icon.includes(emoji)) return code;
  return [...icon].slice(0, 2).join("").toUpperCase();
}

/** First word, ASCII letters and digits only, at most `max`, upper case. */
export function firstWord(text: string, max: number): string {
  const word = text.trim().split(/\s+/)[0] ?? "";
  return [...word].filter((c) => /^[A-Za-z0-9]$/.test(c)).slice(0, max).join("").toUpperCase();
}

/** Nearest-neighbour scale to 16x16, like the device image encoder; alpha dropped. */
function toFrame(img: Rgba): Canvas {
  const c = new Canvas();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const sx = Math.floor((x * img.width) / 16);
      const sy = Math.floor((y * img.height) / 16);
      const o = (sy * img.width + sx) * 4;
      c.put(x, y, [img.data[o], img.data[o + 1], img.data[o + 2]]);
    }
  }
  return c;
}

/** Alpha-blend an RGBA icon onto the canvas at (x, y). */
function overlay(c: Canvas, icon: Rgba, x: number, y: number) {
  for (let iy = 0; iy < icon.height; iy++) {
    for (let ix = 0; ix < icon.width; ix++) {
      const o = (iy * icon.width + ix) * 4;
      const a = icon.data[o + 3] / 255;
      if (a === 0 || x + ix < 0 || y + iy < 0 || x + ix >= 16 || y + iy >= 16) continue;
      const bg = c.get(x + ix, y + iy);
      c.put(x + ix, y + iy, [0, 1, 2].map((k) => Math.round(icon.data[o + k] * a + bg[k] * (1 - a))) as unknown as Rgb);
    }
  }
}

const centred = (text: string) => Math.trunc((16 - (text.length * 4 - 1)) / 2);

export function renderNotification(n: Notification, nowMs = Date.now()): Canvas {
  const flashOn = n.flash && Math.floor(nowMs / Math.max(1, n.flashSpeedMs)) % 2 === 0;

  if (n.displayMode === "image" && n.image) {
    return n.flash && !flashOn ? new Canvas() : toFrame(n.image);
  }

  const bg = hexToRgb(n.backgroundColor);
  const fg = hexToRgb(n.textColor);
  const [back, text] = flashOn ? [fg, bg] : [bg, fg];
  const c = new Canvas(back);
  const title = firstWord(n.title, 4);
  const subtitle = firstWord(n.subtitle, 4);

  if (n.displayMode === "icon_only") {
    if (n.iconImage) overlay(c, n.iconImage, 4, 4);
    else drawText(c, iconCode(n.icon), 4, 6, text, 1);
  } else if (n.displayMode === "icon_with_text") {
    const code = iconCode(n.icon);
    if (n.iconImage || code) {
      if (n.iconImage) overlay(c, n.iconImage, 4, 1);
      else drawText(c, code, code.length === 2 ? 4 : 6, 1, text, 1);
      if (title) drawText(c, title, centred(title), 7, text, 1);
      if (subtitle) drawText(c, subtitle, centred(subtitle), 12, text, 1);
    } else if (title && subtitle) {
      drawText(c, title, centred(title), 2, text, 1);
      drawText(c, subtitle, centred(subtitle), 8, text, 1);
    } else if (title) {
      drawText(c, title, centred(title), 4, text, 1);
    } else if (subtitle) {
      drawText(c, subtitle, centred(subtitle), 4, text, 1);
    }
  } else {
    if (title) drawText(c, title, centred(title), 2, text, 1);
    if (subtitle) drawText(c, subtitle, centred(subtitle), 8, text, 1);
  }
  return c;
}
