// Picks the weather provider from the environment:
//   PXLS_WEATHER_PROVIDER       provider id (default and only one so far: open-meteo)
//   PXLS_WEATHER_API_URL        Open-Meteo forecast base URL (customer or self-hosted)
//   PXLS_WEATHER_GEOCODING_URL  Open-Meteo geocoding base URL
//   PXLS_WEATHER_API_KEY        Open-Meteo API key (paid plan)

import { createOpenMeteo } from "./openMeteo";
import type { WeatherProvider } from "./types";

export type { Weather, WeatherProvider } from "./types";
export { UNKNOWN } from "./types";

type Env = Record<string, string | undefined>;

const PROVIDERS: Record<string, (env: Env) => WeatherProvider> = {
  "open-meteo": (env) =>
    createOpenMeteo({
      forecastUrl: env.PXLS_WEATHER_API_URL,
      geocodingUrl: env.PXLS_WEATHER_GEOCODING_URL,
      apiKey: env.PXLS_WEATHER_API_KEY,
    }),
};

export const DEFAULT_PROVIDER = "open-meteo";

export function providerId(env: Env = process.env): string {
  const id = (env.PXLS_WEATHER_PROVIDER || DEFAULT_PROVIDER).trim().toLowerCase();
  return id in PROVIDERS ? id : DEFAULT_PROVIDER;
}

let warned = false;

export function weatherProvider(env: Env = process.env): WeatherProvider {
  const wanted = (env.PXLS_WEATHER_PROVIDER || DEFAULT_PROVIDER).trim().toLowerCase();
  if (!(wanted in PROVIDERS) && !warned) {
    warned = true;
    console.warn(`[weather] unknown PXLS_WEATHER_PROVIDER "${wanted}", using ${DEFAULT_PROVIDER}`);
  }
  return PROVIDERS[providerId(env)]!(env);
}
