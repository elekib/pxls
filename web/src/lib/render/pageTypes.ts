// Custom page definitions as stored in config.custom_pages (serde's
// `#[serde(tag = "type")]` layout). Port of the PageType enum in config.rs.

export interface Pixel {
  x: number;
  y: number;
  color: string;
}

export interface ScriptInput {
  name: string;
  label: string;
  input_type: string;
  default_value: string;
}

interface StatsSource {
  source: string;
  dashdot_url?: string | null;
  beszel_hub_url?: string | null;
  beszel_system_id?: string | null;
  brand_text: string;
  brand_color: string;
}

export type PageType =
  | { type: "ClockWeather"; clock_color: string; date_color: string; weather_color: string; weather_location: string; temperature_unit: string }
  | ({ type: "SystemStats" } & StatsSource)
  | ({ type: "GpuStats" } & StatsSource)
  | ({ type: "Temps"; show_cpu: boolean; show_gpu: boolean; show_storage: boolean } & StatsSource)
  | { type: "CustomScript"; script_path: string; interval: number; inputs: ScriptInput[] }
  | { type: "ImageUpload"; mode: string; frame_duration: number; file_path?: string | null }
  | { type: "CustomPixels"; pixels: Pixel[] }
  | { type: "CustomText"; text: string; y: number; color: string; background_color: string; scroll_speed: number; enable_scroll: boolean }
  | { type: "DivoomEnvironment"; time_format: string; clock_design: string; show_divoom: boolean; show_weather: boolean; show_temp: boolean; show_date: boolean; color: [number, number, number] }
  | { type: "DivoomLight"; color: [number, number, number]; brightness: number; effect_mode: number; on: boolean }
  | { type: "DivoomSpecial"; mode: string }
  | { type: "DivoomMusic"; mode: string }
  | { type: "DivoomUser"; mode: string }
  | { type: "DivoomScore"; red_score: number; blue_score: number };

export interface CustomPage {
  name: string;
  enabled: boolean;
  page_type: PageType;
}

const DIVOOM = new Set(["DivoomEnvironment", "DivoomLight", "DivoomSpecial", "DivoomMusic", "DivoomUser", "DivoomScore"]);

export const isDivoomPage = (p: PageType) => DIVOOM.has(p.type);

/** The enabled, well-formed pages from config.custom_pages, in order. */
export function enabledPages(raw: unknown[]): CustomPage[] {
  return raw.filter(
    (p): p is CustomPage =>
      !!p && typeof p === "object" && (p as CustomPage).enabled === true && typeof (p as CustomPage).page_type?.type === "string",
  );
}
