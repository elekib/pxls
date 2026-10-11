// Weather for the clock page, from one URL you provide (PXLS_WEATHER_URL).
//
// pxls names no weather service. It GETs that URL and expects JSON with the two
// values the page draws:
//
//   { "temp": 21.6, "code": 3 }
//
// - temp: the temperature as a number (or numeric string), in the unit asked for.
// - code: a WMO weather code (0 clear, 1-3 cloudy, 45/48 fog, 51-65 rain,
//   71-77 snow, 95-99 storm), optional. Without it the page draws no icon.
//
// `{location}` and `{unit}` in the URL are replaced (URL-encoded) with the
// page's location and "celsius" or "fahrenheit". With no URL set, or on any
// error or malformed reply, there is no weather and the page draws none.
// The URL is set by the operator and may hold a token, so it is never logged
// and no private-address guard applies (a bridge on your LAN is the usual case).

export interface Weather {
  /** Rounded temperature, for example "22" or "-4". */
  temp: string;
  /** WMO weather code, or -1 for none. */
  code: number;
}

const TTL_MS = 10 * 60_000;
const RETRY_MS = 60_000;
const FETCH_TIMEOUT_MS = 5000;
const MAX_BODY = 16 * 1024;

let cache: { key: string; at: number; ttl: number; value: Weather | null } | null = null;
let inflight: { key: string; promise: Promise<Weather | null> } | null = null;

/** Parse a reply body. Null when there is no usable temperature. */
export function parseWeather(body: unknown): Weather | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  const raw = typeof o.temp === "string" ? (o.temp.trim() === "" ? NaN : Number(o.temp)) : o.temp;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < -99 || raw > 199) return null;
  const code = typeof o.code === "number" && Number.isInteger(o.code) && o.code >= 0 && o.code <= 99 ? o.code : -1;
  return { temp: String(Math.round(raw)), code };
}

export function weatherUrl(env: Record<string, string | undefined> = process.env): string | null {
  const u = env.PXLS_WEATHER_URL?.trim();
  return u ? u : null;
}

async function request(url: string, fetchFn: typeof fetch): Promise<Weather | null> {
  try {
    const r = await fetchFn(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!r.ok) return null;
    const text = await r.text();
    if (text.length > MAX_BODY) return null;
    return parseWeather(JSON.parse(text));
  } catch {
    return null;
  }
}

/**
 * Current weather, or null when no URL is set or it gave nothing usable.
 * Cached for 10 minutes; a failure is retried after one minute.
 */
export async function getWeather(location: string, unit: string, fetchFn: typeof fetch = fetch): Promise<Weather | null> {
  const template = weatherUrl();
  if (!template) return null;
  const u = unit === "celsius" ? "celsius" : "fahrenheit";
  const url = template.replaceAll("{location}", encodeURIComponent(location)).replaceAll("{unit}", u);
  if (cache && cache.key === url && Date.now() - cache.at < cache.ttl) return cache.value;
  if (!inflight || inflight.key !== url) {
    const promise = request(url, fetchFn).finally(() => {
      if (inflight?.promise === promise) inflight = null;
    });
    inflight = { key: url, promise };
  }
  const value = await inflight.promise;
  cache = { key: url, at: Date.now(), ttl: value ? TTL_MS : RETRY_MS, value };
  return value;
}

/** For tests. */
export function resetWeatherCache(): void {
  cache = null;
  inflight = null;
}
