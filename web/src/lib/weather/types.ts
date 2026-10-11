// A weather source. Adapters map their provider onto this shape so the clock
// page does not depend on any one service.

export interface Weather {
  /** Rounded temperature in the requested unit, or "--" when unknown. */
  temp: string;
  /** WMO weather code (what the page icons are drawn from), or -1 when unknown. */
  code: number;
}

export interface WeatherProvider {
  readonly id: string;
  /** Current weather for a place name such as "New York,NY". Resolves to `UNKNOWN` instead of throwing. */
  fetch(location: string, unit: "celsius" | "fahrenheit"): Promise<Weather>;
}

export const UNKNOWN: Weather = { temp: "--", code: -1 };
