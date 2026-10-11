// Divoom-native page types. The device renders these itself, so the server
// validates them strictly: every field must be sent.

export type Rgb = [number, number, number];
export type DivoomData = Record<string, unknown>;

export const DIVOOM_TYPES = [
  'DivoomEnvironment',
  'DivoomLight',
  'DivoomMusic',
  'DivoomUser',
  'DivoomScore',
] as const;

export type DivoomPageType = (typeof DIVOOM_TYPES)[number];

export const divoomTypeLabels: Record<DivoomPageType, string> = {
  DivoomEnvironment: 'Divoom Clock / Environment',
  DivoomLight: 'Divoom Light',
  DivoomMusic: 'Divoom Music Visualizer',
  DivoomUser: 'Divoom User GIFs',
  DivoomScore: 'Divoom Scoreboard',
};

export function isDivoomType(type: string): type is DivoomPageType {
  return (DIVOOM_TYPES as readonly string[]).includes(type);
}

const DEFAULTS: Record<DivoomPageType, DivoomData> = {
  DivoomEnvironment: {
    time_format: '24h',
    clock_design: 'digital',
    show_divoom: false,
    show_weather: false,
    show_temp: false,
    show_date: false,
    color: [255, 255, 255],
  },
  DivoomLight: { color: [255, 255, 255], brightness: 100, effect_mode: 0, on: true },
  DivoomMusic: { mode: 'bottom_bars' },
  DivoomUser: { mode: 'default' },
  DivoomScore: { red_score: 0, blue_score: 0 },
};

export function defaultDivoomData(type: DivoomPageType): DivoomData {
  return structuredClone(DEFAULTS[type]);
}

// Merge a saved page over the defaults, so stale or partial pages still edit.
export function loadDivoomData(type: DivoomPageType, saved: object): DivoomData {
  const data = defaultDivoomData(type);
  for (const key of Object.keys(data)) {
    const value = (saved as DivoomData)[key];
    if (value !== undefined && value !== null) data[key] = value;
  }
  return data;
}

// Build the exact payload the API expects: only known keys, none missing.
export function buildDivoomPayload(type: DivoomPageType, data: DivoomData): DivoomData {
  const payload: DivoomData = { type };
  const defaults = DEFAULTS[type];
  for (const key of Object.keys(defaults)) {
    payload[key] = data[key] ?? defaults[key];
  }
  return payload;
}

export function rgbToHex(rgb: Rgb): string {
  return '#' + rgb.map((c) => c.toString(16).padStart(2, '0')).join('');
}

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) || 0) as Rgb;
}

// Per-page display time from the editor's text box: blank or 0 means "use the
// global rotation time", so it is sent as undefined and omitted from the JSON.
export function parseDuration(text: string): number | undefined {
  const secs = parseInt(text, 10);
  return Number.isFinite(secs) && secs > 0 ? secs : undefined;
}
