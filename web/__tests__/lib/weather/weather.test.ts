import { describe, expect, it, vi } from "vitest";
import { createOpenMeteo } from "@/lib/weather/openMeteo";
import { providerId, weatherProvider } from "@/lib/weather";

const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;

function fakeFetch(handlers: { geo?: unknown; forecast?: unknown; status?: number }) {
  return vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    if (handlers.status) return reply({}, handlers.status);
    return reply(u.includes("/v1/search") ? handlers.geo : handlers.forecast);
  });
}

const geo = { results: [{ latitude: 40.7, longitude: -74 }] };
const forecast = { current_weather: { temperature: 21.6, weathercode: 3 } };

describe("open-meteo provider", () => {
  it("geocodes the city, then reads the current weather", async () => {
    const f = fakeFetch({ geo, forecast });
    const w = await createOpenMeteo({ fetchFn: f as unknown as typeof fetch }).fetch("New York,NY", "celsius");
    expect(w).toEqual({ temp: "22", code: 3 });
    const urls = f.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toBe("https://geocoding-api.open-meteo.com/v1/search?name=New%20York&count=1&language=en&format=json");
    expect(urls[1]).toBe("https://api.open-meteo.com/v1/forecast?latitude=40.7&longitude=-74&current_weather=true&temperature_unit=celsius");
  });

  it("uses custom base URLs and sends the API key on both calls", async () => {
    const f = fakeFetch({ geo, forecast });
    await createOpenMeteo({
      forecastUrl: "https://customer-api.open-meteo.com/",
      geocodingUrl: "https://customer-geocoding-api.open-meteo.com",
      apiKey: "k e/y",
      fetchFn: f as unknown as typeof fetch,
    }).fetch("Paris", "fahrenheit");
    const urls = f.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toMatch(/^https:\/\/customer-geocoding-api\.open-meteo\.com\/v1\/search\?.*&apikey=k%20e%2Fy$/);
    expect(urls[1]).toMatch(/^https:\/\/customer-api\.open-meteo\.com\/v1\/forecast\?.*temperature_unit=fahrenheit&apikey=k%20e%2Fy$/);
  });

  it("returns unknown for an unknown place, an HTTP error or a network failure", async () => {
    const unknown = { temp: "--", code: -1 };
    expect(await createOpenMeteo({ fetchFn: fakeFetch({ geo: {} }) as unknown as typeof fetch }).fetch("Nowhere", "celsius")).toEqual(unknown);
    expect(await createOpenMeteo({ fetchFn: fakeFetch({ status: 429 }) as unknown as typeof fetch }).fetch("X", "celsius")).toEqual(unknown);
    const boom = vi.fn(async () => {
      throw new Error("network down https://x/?apikey=SECRET");
    });
    expect(await createOpenMeteo({ fetchFn: boom as unknown as typeof fetch, apiKey: "SECRET" }).fetch("X", "celsius")).toEqual(unknown);
  });

  it("tolerates missing fields in the forecast", async () => {
    const f = fakeFetch({ geo, forecast: { current_weather: {} } });
    expect(await createOpenMeteo({ fetchFn: f as unknown as typeof fetch }).fetch("X", "celsius")).toEqual({ temp: "--", code: -1 });
  });
});

describe("provider selection", () => {
  it("defaults to open-meteo and falls back for an unknown id", () => {
    expect(providerId({})).toBe("open-meteo");
    expect(providerId({ PXLS_WEATHER_PROVIDER: " Open-Meteo " })).toBe("open-meteo");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(weatherProvider({ PXLS_WEATHER_PROVIDER: "nope" }).id).toBe("open-meteo");
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
