// The app configuration, stored as one JSON document in `app_config` (row 1).
//
// Fields this app does not model yet (custom pages, webhooks, Beszel) are
// kept as they are, so saving never drops stored data. Missing fields get the
// type's zero value, not the first-run defaults.

import { z } from "zod";

// Numbers are clamped, never rejected: a stored config must always load.
const clamped = (max: number) =>
  z
    .number()
    .catch(0)
    .transform((n) => Math.min(max, Math.max(0, Math.trunc(Number.isFinite(n) ? n : 0))));
const u8 = clamped(255);
const rgb = z.tuple([u8, u8, u8]).catch([0, 0, 0]);
const pct = clamped(100);
const score = clamped(999);
const str = z.string().catch("").transform((s) => s.slice(0, 200));

export const environmentConfig = z.object({
  time_format: str.default(""),
  clock_design: str.default(""),
  show_divoom: z.boolean().catch(false).default(false),
  show_weather: z.boolean().catch(false).default(false),
  show_temp: z.boolean().catch(false).default(false),
  show_date: z.boolean().catch(false).default(false),
  color: rgb.default([0, 0, 0]),
});

export const lightConfig = z.object({
  color: rgb.default([0, 0, 0]),
  brightness: pct.default(0),
  effect_mode: u8.default(0),
  on: z.boolean().catch(false).default(false),
});

export const countdownPreset = z.object({
  name: str.default(""),
  minutes: u8.default(0),
  seconds: u8.default(0),
});

export const deviceConfig = z.object({
  brightness: pct.default(0),
  time_format: str.default(""),
  light_mode: str.default(""),
  environment_config: environmentConfig.default(environmentConfig.parse({})),
  light_config: lightConfig.default(lightConfig.parse({})),
  score_config: z.object({ red_score: score.default(0), blue_score: score.default(0) }).default({ red_score: 0, blue_score: 0 }),
  music_config: z.object({ mode: str.default("") }).default({ mode: "" }),
  countdown_config: z
    .object({
      presets: z.array(countdownPreset).catch([]).default([]),
    })
    .default({ presets: [] }),
});

export type DeviceConfig = z.infer<typeof deviceConfig>;

export interface BeszelAuth {
  email: string;
  password: string;
}

/** Modelled fields; everything else in the stored JSON passes through. */
export interface Config {
  pixoo_mac: string;
  weather_location: string;
  timezone: string;
  refresh_interval_ms: number;
  rotation_time_secs: number;
  clock_color: string;
  date_color: string;
  weather_color: string;
  custom_pages: unknown[];
  device_config: DeviceConfig;
  webhooks: unknown[];
  enhanced_webhooks: unknown[];
  beszel_auth: BeszelAuth | null;
  beszel_token?: { auth_token: string; last_refresh: number | null } | null;
  [other: string]: unknown;
}

/** Top-level fields of the config; a client may only send these. */
export const CONFIG_KEYS = [
  "pixoo_mac", "weather_location", "timezone", "refresh_interval_ms", "rotation_time_secs", "clock_color",
  "date_color", "weather_color", "custom_pages", "device_config", "webhooks", "enhanced_webhooks", "beszel_auth",
] as const;

/** Keep only the known top-level fields (client input only). */
export function pickKnown(raw: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(CONFIG_KEYS.filter((k) => k in raw).map((k) => [k, raw[k]]));
}

/** The first-run config. */
export function defaultConfig(): Config {
  return {
    pixoo_mac: "",
    weather_location: "New York,NY",
    timezone: "America/New_York",
    refresh_interval_ms: 1000,
    rotation_time_secs: 20,
    clock_color: "00FFFF",
    date_color: "FFFF00",
    weather_color: "FFA500",
    custom_pages: [
      {
        name: "Clock & Weather",
        enabled: true,
        page_type: {
          type: "ClockWeather",
          clock_color: "00FFFF",
          date_color: "FFFF00",
          weather_color: "FFA500",
          weather_location: "New York,NY",
          temperature_unit: "fahrenheit",
        },
      },
    ],
    device_config: {
      brightness: 50,
      time_format: "12h",
      light_mode: "custom",
      environment_config: {
        time_format: "12h",
        clock_design: "digital",
        show_divoom: false,
        show_weather: false,
        show_temp: false,
        show_date: true,
        color: [255, 120, 0],
      },
      light_config: { color: [255, 255, 255], brightness: 50, effect_mode: 0, on: true },
      score_config: { red_score: 0, blue_score: 0 },
      music_config: { mode: "bottom_bars" },
      countdown_config: {
        presets: [
          { name: "1 Minute", minutes: 1, seconds: 0 },
          { name: "5 Minutes", minutes: 5, seconds: 0 },
          { name: "15 Minutes", minutes: 15, seconds: 0 },
          { name: "25 min (Pomodoro)", minutes: 25, seconds: 0 },
        ],
      },
    },
    webhooks: [],
    enhanced_webhooks: [],
    beszel_auth: null,
  };
}

const asString = (v: unknown) => (typeof v === "string" ? v : "");
const asNumber = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : 0);
const asArray = (v: unknown) => (Array.isArray(v) ? v : []);

/**
 * A stored or submitted JSON document as a Config: modelled fields get
 * zero-value defaults, unknown fields are kept, numbers are clamped.
 */
export function normalizeConfig(raw: unknown): Config {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const auth = o.beszel_auth as Partial<BeszelAuth> | null | undefined;
  const out: Config = {
    ...o,
    pixoo_mac: asString(o.pixoo_mac),
    weather_location: asString(o.weather_location),
    timezone: asString(o.timezone),
    refresh_interval_ms: asNumber(o.refresh_interval_ms),
    rotation_time_secs: asNumber(o.rotation_time_secs),
    clock_color: asString(o.clock_color),
    date_color: asString(o.date_color),
    weather_color: asString(o.weather_color),
    custom_pages: asArray(o.custom_pages),
    device_config: deviceConfig.parse(o.device_config ?? {}),
    webhooks: asArray(o.webhooks),
    enhanced_webhooks: asArray(o.enhanced_webhooks),
    beszel_auth: auth && typeof auth === "object" ? { email: asString(auth.email), password: asString(auth.password) } : null,
  };
  if (o.beszel_token == null) delete out.beszel_token;
  return out;
}

/** Hex color ("#00FFFF" or "00FFFF") to RGB; anything else is white. */
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return [255, 255, 255];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
