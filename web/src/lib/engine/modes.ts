// Divoom native modes from config; unknown names fall back to a default.

import type { DeviceConfig } from "@/lib/config/model";
import type { Pixoo } from "@/lib/device/pixoo";
import { mode, type LightMode } from "@/lib/protocol";

export const CLOCK_DESIGNS: Record<string, mode.ClockDesign> = {
  digital: mode.ClockDesign.Digital,
  digital_rainbow: mode.ClockDesign.DigitalRainbow,
  digital_box: mode.ClockDesign.DigitalBox,
  analog1: mode.ClockDesign.Analog1,
  digital_inverted: mode.ClockDesign.DigitalInverted,
  analog2: mode.ClockDesign.Analog2,
};

export const MUSIC_MODES: Record<string, mode.MusicMode> = {
  bottom_bars: mode.MusicMode.BottomBars,
  center_bars: mode.MusicMode.CenterBars,
  side_bars: mode.MusicMode.SideBars,
  face1: mode.MusicMode.Face1,
  face2: mode.MusicMode.Face2,
  face3: mode.MusicMode.Face3,
  frog_face: mode.MusicMode.FrogFace,
  matrix: mode.MusicMode.Matrix,
  falling_blocks: mode.MusicMode.FallingBlocks,
  fireworks: mode.MusicMode.Fireworks,
  dancing_boy: mode.MusicMode.DancingBoy,
  dancing_girl: mode.MusicMode.DancingGirl,
};

/** Native display modes; "custom" means pxls renders its own pages. */
export const NATIVE_MODES = ["env", "light", "music", "user", "score"] as const;

const effect = (n: number) => (n >= 0 && n <= 4 ? (n as mode.LightEffect) : mode.LightEffect.Normal);

/** The native mode selected in the device config, or null for "custom". */
export function nativeMode(dc: DeviceConfig): LightMode | null {
  switch (dc.light_mode) {
    case "env": {
      const e = dc.environment_config;
      return {
        kind: "env",
        timeFormat: e.time_format === "24h" ? "24h" : "12h",
        clockDesign: CLOCK_DESIGNS[e.clock_design] ?? mode.ClockDesign.Digital,
        showDivoom: e.show_divoom,
        showWeather: e.show_weather,
        showTemp: e.show_temp,
        showDate: e.show_date,
        color: e.color,
      };
    }
    case "light": {
      // One brightness: the device setting also drives Light mode.
      const l = dc.light_config;
      return { kind: "light", color: l.color, brightness: dc.brightness, effect: effect(l.effect_mode), on: l.on };
    }
    case "user":
      return { kind: "user" };
    case "music":
      return { kind: "music", mode: MUSIC_MODES[dc.music_config.mode] ?? mode.MusicMode.BottomBars };
    case "score":
      return { kind: "score", red: dc.score_config.red_score, blue: dc.score_config.blue_score };
    default:
      return null;
  }
}

/** The native mode for a Divoom page in the custom rotation. */
export function pageMode(p: { type: string } & Record<string, unknown>): LightMode | null {
  switch (p.type) {
    case "DivoomEnvironment":
      return {
        kind: "env",
        timeFormat: p.time_format === "24h" ? "24h" : "12h",
        clockDesign: CLOCK_DESIGNS[String(p.clock_design)] ?? mode.ClockDesign.Digital,
        showDivoom: !!p.show_divoom,
        showWeather: !!p.show_weather,
        showTemp: !!p.show_temp,
        showDate: !!p.show_date,
        color: (Array.isArray(p.color) ? p.color : [0, 0, 0]) as [number, number, number],
      };
    case "DivoomLight":
      return {
        kind: "light",
        color: (Array.isArray(p.color) ? p.color : [0, 0, 0]) as [number, number, number],
        brightness: Number(p.brightness) || 0,
        effect: effect(Number(p.effect_mode)),
        on: !!p.on,
      };
    case "DivoomMusic":
      return { kind: "music", mode: MUSIC_MODES[String(p.mode)] ?? mode.MusicMode.BottomBars };
    case "DivoomUser":
      return { kind: "user" };
    case "DivoomScore":
      return { kind: "score", red: Number(p.red_score) || 0, blue: Number(p.blue_score) || 0 };
    default:
      return null;
  }
}

/**
 * Apply brightness, time format and the selected native mode. Runs on connect
 * and on save. In "custom" mode the render loop drives the display instead.
 */
export async function applyDeviceConfig(pixoo: Pixoo, dc: DeviceConfig): Promise<void> {
  await pixoo.setBrightness(dc.brightness);
  await pixoo.setTimeFormat(dc.time_format === "24h" ? "24h" : "12h");
  const m = nativeMode(dc);
  if (m) await pixoo.setMode(m);
}
