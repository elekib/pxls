export type Tab =
  | 'device'
  | 'pages'
  | 'tools'
  | 'webhooks'
  | 'webhook_events'
  | 'account'
  | 'users'
  | 'diagnostics';

export interface Config {
  pixoo_mac: string;
  weather_location: string;
  timezone: string;
  refresh_interval_ms: number;
  rotation_time_secs: number;
  clock_color: string;
  date_color: string;
  weather_color: string;
  custom_pages: CustomPage[];
  device_config: DeviceConfig;
  webhooks: WebhookConfig[];
  beszel_auth?: BeszelAuthConfig;
}

export interface BeszelAuthConfig {
  email: string;
  /** Never returned by the backend; blank on load, only sent when changing it. */
  password?: string;
  password_set?: boolean;
}

export interface BeszelAuthStatus {
  configured: boolean;
  mode: 'credentials' | 'legacy_token' | 'none';
  logged_in: boolean;
  token_expires?: number | null;
  last_error?: string | null;
}

export interface EnvironmentConfig {
  clock_design: string; // "digital" or "analog1"
  show_divoom: boolean;
  show_weather: boolean;
  show_temp: boolean;
  show_date: boolean;
  color: [number, number, number]; // RGB color
}

export interface LightConfig {
  color: [number, number, number]; // RGB color
  brightness: number; // 0-100
  effect_mode: number; // 0-4
  on: boolean;
}

export interface ScoreConfig {
  red_score: number; // 0-999
  blue_score: number; // 0-999
}

export interface MusicConfig {
  mode: string; // music visualization mode
}

export interface CountdownPreset {
  name: string;
  minutes: number;
  seconds: number;
}

export interface CountdownConfig {
  presets: CountdownPreset[];
}

export interface DeviceConfig {
  brightness: number; // 0-70 (device limitation)
  light_mode: string; // "custom" for our pages, or native modes
  // Native mode configurations
  environment_config: EnvironmentConfig;
  light_config: LightConfig;
  score_config: ScoreConfig;
  music_config: MusicConfig;
  countdown_config: CountdownConfig;
}

export interface CustomPage {
  name: string;
  enabled: boolean;
  page_type: PageTypeData;
}

export interface PageTypeData {
  type: string;
  clock_color?: string;
  date_color?: string;
  weather_color?: string;
  weather_location?: string;
  temperature_unit?: string;
  // SystemStats - supports both Dashdot and Beszel
  source?: string;  // "dashdot" or "beszel"
  dashdot_url?: string;
  beszel_hub_url?: string;
  beszel_system_id?: string;
  brand_text?: string;
  brand_color?: string;
  // Temps display options
  show_cpu?: boolean;
  show_gpu?: boolean;
  show_storage?: boolean;
  script_path?: string;
  interval?: number;
  inputs?: ScriptInput[];
  mode?: string;
  frame_duration?: number;
  file_path?: string;
  pixels?: Pixel[];
  text?: string;
  y?: number;
  color?: string;
  background_color?: string;
  scroll_speed?: number;
  enable_scroll?: boolean;
  // Divoom native modes
  clock_design?: string;
  show_divoom?: boolean;
  show_weather?: boolean;
  show_temp?: boolean;
  show_date?: boolean;
  mode_color?: [number, number, number]; // renamed to avoid conflict with 'color'
  brightness?: number;
  effect_mode?: number;
  on?: boolean;
  red_score?: number;
  blue_score?: number;
}

export interface ScriptInput {
  name: string;
  label: string;
  input_type: string;
  default_value: string;
}

export interface Pixel {
  x: number;
  y: number;
  color: string;
}

export interface Notification {
  message: string;
  type: 'success' | 'error';
}

export interface WebhookConfig {
  name: string;
  enabled: boolean;
  path: string;
  duration_secs: number;
  icon: string;
  icon_image_url: string;
  title_field: string;
  subtitle_field: string;
  display_mode: 'text' | 'icon_only' | 'icon_with_text' | 'image';
  background_color: string;
  text_color: string;
  flash: boolean;
  flash_speed_ms: number;
  image_url_field: string;
}

export const typeLabels: Record<string, string> = {
  'ClockWeather': '🕐 Clock',
  'SystemStats': '💻 System Stats',
  'GpuStats': '🎮 GPU Stats',
  'Temps': '🌡️ Temps',
  'CustomScript': '📜 Script',
  'ImageUpload': '🖼️ Image',
  'CustomPixels': '🎨 Pixels',
  'CustomText': '📝 Text'
};

// Same-origin: nginx proxies /api to the backend in production, and the Vite dev
// server does the same (see vite.config.ts).
export const API_URL = '';
