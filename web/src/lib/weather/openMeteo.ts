// Open-Meteo (https://open-meteo.com/). The free API needs no key and is for
// non-commercial use; a paid plan uses the customer hosts and an API key, and
// Open-Meteo can also be self-hosted. See README, "Third-party services".

import { UNKNOWN, type WeatherProvider } from "./types";

export const DEFAULT_FORECAST_URL = "https://api.open-meteo.com";
export const DEFAULT_GEOCODING_URL = "https://geocoding-api.open-meteo.com";
const FETCH_TIMEOUT_MS = 5000;

export interface OpenMeteoOptions {
  forecastUrl?: string;
  geocodingUrl?: string;
  /** Sent as the `apikey` query parameter. Never logged. */
  apiKey?: string;
  fetchFn?: typeof fetch;
}

const trimSlash = (u: string) => u.replace(/\/+$/, "");

export function createOpenMeteo(opts: OpenMeteoOptions = {}): WeatherProvider {
  const forecastUrl = trimSlash(opts.forecastUrl || DEFAULT_FORECAST_URL);
  const geocodingUrl = trimSlash(opts.geocodingUrl || DEFAULT_GEOCODING_URL);
  const doFetch = opts.fetchFn ?? fetch;
  const key = opts.apiKey ? `&apikey=${encodeURIComponent(opts.apiKey)}` : "";

  // Errors carry the status only: the URL holds the API key.
  async function json(url: string): Promise<unknown> {
    const r = await doFetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  return {
    id: "open-meteo",
    async fetch(location, unit) {
      try {
        const city = (location.split(",")[0] ?? location).trim();
        const geo = (await json(
          `${geocodingUrl}/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json${key}`,
        )) as { results?: { latitude?: number; longitude?: number }[] };
        const first = geo.results?.[0];
        if (!first) return UNKNOWN;
        const w = (await json(
          `${forecastUrl}/v1/forecast?latitude=${first.latitude ?? 0}&longitude=${first.longitude ?? 0}&current_weather=true&temperature_unit=${unit}${key}`,
        )) as { current_weather?: { temperature?: number; weathercode?: number } };
        const t = w.current_weather?.temperature;
        const code = w.current_weather?.weathercode;
        return {
          temp: typeof t === "number" ? t.toFixed(0) : "--",
          code: typeof code === "number" ? code : -1,
        };
      } catch {
        return UNKNOWN;
      }
    },
  };
}
