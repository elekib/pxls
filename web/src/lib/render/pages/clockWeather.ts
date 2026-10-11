// Clock, date and current weather.
//
// Time uses the saved timezone. The weather row is drawn only when the weather
// URL gave a reading (see lib/weather.ts); otherwise the page is just clock and date.

import { hexToRgb } from "@/lib/config/model";
import { Canvas, type Rgb } from "../canvas";
import { drawText } from "../font";
import { getWeather, type Weather } from "@/lib/weather";

const ICON_FRAME_MS = 333;

const anim = { frame: 0, at: 0 };

function animationFrame(now = Date.now()): number {
  if (anim.at === 0) anim.at = now;
  else if (now - anim.at >= ICON_FRAME_MS) {
    anim.frame = (anim.frame + 1) % 3;
    anim.at = now;
  }
  return anim.frame;
}

export interface ClockParts {
  hour: string;
  minute: string;
  month: string;
  day: string;
  second: number;
}

/** Clock fields in `timeZone` (falls back to the server's zone if invalid). */
export function clockParts(date: Date, timeZone?: string): ClockParts {
  let parts: Intl.DateTimeFormatPart[];
  const opts: Intl.DateTimeFormatOptions = {
    hour: "numeric", minute: "2-digit", second: "2-digit", month: "short", day: "2-digit", hour12: true,
  };
  try {
    parts = new Intl.DateTimeFormat("en-US", { ...opts, timeZone: timeZone || undefined }).formatToParts(date);
  } catch {
    parts = new Intl.DateTimeFormat("en-US", opts).formatToParts(date);
  }
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "";
  return { hour: get("hour"), minute: get("minute").padStart(2, "0"), month: get("month"), day: get("day"), second: Number(get("second")) };
}

const WHITE: Rgb = [255, 255, 255];
const YELLOW: Rgb = [255, 200, 0];
const ORANGE: Rgb = [255, 140, 0];
const BLUE: Rgb = [0, 150, 255];
const LIGHT_BLUE: Rgb = [200, 220, 255];
const PURPLE: Rgb = [180, 0, 255];
const GRAY: Rgb = [180, 180, 180];

function layer(c: Canvas, x: number, y: number, icon: number[], color: Rgb) {
  icon.forEach((bits, row) => {
    for (let col = 0; col < 5; col++) if ((bits >> (4 - col)) & 1) c.put(x + col, y + row, color);
  });
}

/** 5x5 animated weather icon for a WMO weather code. */
export function drawWeatherIcon(c: Canvas, code: number, x: number, y: number, frame: number) {
  const f = frame % 3;
  let base: number[];
  let over: number[] | null = null;
  let baseColor = WHITE;
  let overColor = WHITE;
  if (code === 0) {
    base = [[0b10001, 0b01010, 0b00100, 0b01010, 0b10001], [0b01010, 0b00100, 0b01110, 0b00100, 0b01010], [0b10001, 0b01010, 0b00100, 0b01010, 0b10001]][f]!;
    over = [[0, 0b00100, 0b01110, 0b00100, 0], [0, 0b01110, 0b01110, 0b01110, 0], [0, 0b00100, 0b01110, 0b00100, 0]][f]!;
    baseColor = YELLOW;
    overColor = ORANGE;
  } else if (code >= 1 && code <= 3) {
    base = [0b00110, 0b01111, 0b11111, 0b11111, 0b01100];
    over = [[0b00110, 0b01110, 0b01100, 0, 0], [0b00011, 0b00111, 0b00110, 0, 0], [0b00110, 0b01110, 0b01100, 0, 0]][f]!;
    overColor = YELLOW;
  } else if (code === 45 || code === 48) {
    base = [[0b00100, 0b01110, 0b11111, 0b11111, 0b01010], [0b00010, 0b00111, 0b11111, 0b11111, 0b10100], [0b01000, 0b01110, 0b11111, 0b11111, 0b01010]][f]!;
    baseColor = GRAY;
  } else if (code >= 51 && code <= 65) {
    base = [0b01110, 0b11111, 0b11111, 0, 0];
    over = [[0, 0, 0, 0b10101, 0], [0, 0, 0, 0, 0b10101], [0, 0, 0, 0b01010, 0]][f]!;
    overColor = BLUE;
  } else if (code >= 71 && code <= 77) {
    base = [0b01110, 0b11111, 0b11111, 0, 0];
    over = [[0, 0, 0, 0b01010, 0], [0, 0, 0, 0, 0b01010], [0, 0, 0, 0b00100, 0]][f]!;
    overColor = LIGHT_BLUE;
  } else if (code >= 95 && code <= 99) {
    base = [0b01110, 0b11111, 0b11111, 0, 0];
    over = [[0, 0b00010, 0b00110, 0b01100, 0b01000], [0, 0, 0b00110, 0, 0], [0, 0b00010, 0b00110, 0b01100, 0b01000]][f]!;
    overColor = PURPLE;
  } else {
    base = [0b00100, 0b01110, 0b11111, 0b11111, 0b01010];
  }
  layer(c, x, y, base, baseColor);
  if (over) layer(c, x, y, over, overColor);
}

export interface ClockWeather {
  clock_color: string;
  date_color: string;
  weather_color: string;
  weather_location: string;
  temperature_unit: string;
}

/** Draw the page for given clock fields and weather (pure; used by tests). */
export function drawClockWeather(p: ClockWeather, t: ClockParts, w: Weather | null, frame: number): Canvas {
  const c = new Canvas();
  const clock = hexToRgb(p.clock_color);
  const date = hexToRgb(p.date_color);
  const weather = hexToRgb(p.weather_color);

  drawText(c, t.hour, 0, 0, clock, 1);
  const hourWidth = t.hour.length * 4 - 1;
  if (t.second % 2 === 0) drawText(c, ":", hourWidth, 0, clock, 1);
  drawText(c, t.minute, hourWidth + 1, 0, clock, 1);

  drawText(c, t.month, 0, 5, date, 0);
  drawText(c, t.day, t.month.length * 3, 5, date, 1);

  if (!w) return c;
  const tempWidth = w.temp.length * 4 - 1;
  drawText(c, w.temp, 0, 11, weather, 1);
  drawText(c, "*", tempWidth + 1, 11, weather, 0);
  if (w.code >= 0) drawWeatherIcon(c, w.code, tempWidth + 3, 11, frame);
  return c;
}

export async function renderClockWeather(p: ClockWeather, timeZone: string): Promise<Canvas> {
  const w = await getWeather(p.weather_location, p.temperature_unit);
  return drawClockWeather(p, clockParts(new Date(), timeZone), w, animationFrame());
}
