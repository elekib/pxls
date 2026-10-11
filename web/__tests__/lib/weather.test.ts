import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getWeather, parseWeather, resetWeatherCache, weatherUrl } from "@/lib/weather";

const reply = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) }) as Response;
const asFetch = (f: unknown) => f as typeof fetch;

beforeEach(() => resetWeatherCache());
afterEach(() => {
  delete process.env.PXLS_WEATHER_URL;
  vi.useRealTimers();
});

describe("parseWeather", () => {
  it("rounds the temperature and keeps a valid code", () => {
    expect(parseWeather({ temp: 21.6, code: 3 })).toEqual({ temp: "22", code: 3 });
    expect(parseWeather({ temp: "-4.2", code: 0 })).toEqual({ temp: "-4", code: 0 });
    expect(parseWeather({ temp: -0.2 })).toEqual({ temp: "0", code: -1 });
  });

  it("drops a bad code but keeps the temperature", () => {
    for (const code of [-1, 100, 3.5, "3", null, undefined]) expect(parseWeather({ temp: 5, code })).toEqual({ temp: "5", code: -1 });
  });

  it("rejects anything without a usable temperature", () => {
    for (const body of [null, "x", 5, [], {}, { temp: "" }, { temp: "warm" }, { temp: NaN }, { temp: 200 }, { temp: -100 }, { temp: null }]) {
      expect(parseWeather(body)).toBeNull();
    }
  });
});

describe("getWeather", () => {
  it("does not fetch when no URL is set", async () => {
    const f = vi.fn();
    expect(weatherUrl({})).toBeNull();
    expect(weatherUrl({ PXLS_WEATHER_URL: "  " })).toBeNull();
    expect(await getWeather("Paris", "celsius", asFetch(f))).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("fills {location} and {unit}, and caches for ten minutes", async () => {
    vi.useFakeTimers();
    process.env.PXLS_WEATHER_URL = "http://bridge.lan/w?q={location}&u={unit}";
    const f = vi.fn(async (_url: string) => reply({ temp: 12, code: 61 }));
    expect(await getWeather("New York,NY", "celsius", asFetch(f))).toEqual({ temp: "12", code: 61 });
    expect(f.mock.calls[0]![0]).toBe("http://bridge.lan/w?q=New%20York%2CNY&u=celsius");
    await getWeather("New York,NY", "celsius", asFetch(f));
    expect(f).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10 * 60_000 + 1);
    await getWeather("New York,NY", "celsius", asFetch(f));
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("uses a fixed URL as it is and defaults the unit to fahrenheit", async () => {
    process.env.PXLS_WEATHER_URL = "http://bridge.lan/now";
    const f = vi.fn(async (_url: string) => reply({ temp: 70 }));
    expect(await getWeather("X", "kelvin", asFetch(f))).toEqual({ temp: "70", code: -1 });
    expect(f.mock.calls[0]![0]).toBe("http://bridge.lan/now");
  });

  it("returns null on HTTP errors, bad JSON, oversized bodies and network failures, and retries after a minute", async () => {
    vi.useFakeTimers();
    process.env.PXLS_WEATHER_URL = "http://bridge.lan/w";
    for (const f of [
      vi.fn(async () => reply({}, 500)),
      vi.fn(async () => reply("not json")),
      vi.fn(async () => reply({ temp: 1, pad: "x".repeat(20_000) })),
      vi.fn(async () => {
        throw new Error("down");
      }),
    ]) {
      resetWeatherCache();
      expect(await getWeather("X", "celsius", asFetch(f))).toBeNull();
    }
    const f = vi.fn(async () => reply({}, 503));
    resetWeatherCache();
    await getWeather("X", "celsius", asFetch(f));
    await getWeather("X", "celsius", asFetch(f));
    expect(f).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_001);
    await getWeather("X", "celsius", asFetch(f));
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("never puts the URL in a log line", async () => {
    process.env.PXLS_WEATHER_URL = "http://bridge.lan/w?token=SECRET";
    const spies = (["log", "warn", "error"] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
    await getWeather("X", "celsius", asFetch(vi.fn(async () => { throw new Error("http://bridge.lan/w?token=SECRET"); })));
    for (const s of spies) {
      expect(s).not.toHaveBeenCalled();
      s.mockRestore();
    }
  });
});
