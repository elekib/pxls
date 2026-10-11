// Example weather bridge: Open-Meteo -> pxls. Node 22+, no dependencies.
//   node weather-bridge.mjs
// pxls: PXLS_WEATHER_URL=http://127.0.0.1:8787/weather?q={location}&u={unit}
//
// Open-Meteo's free API is for non-commercial use and its data is CC BY 4.0
// (https://open-meteo.com/en/terms). For commercial use, set OPEN_METEO_KEY and
// the customer hosts below.

import http from "node:http";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "127.0.0.1"; // keep it off the network
const FORECAST = process.env.OPEN_METEO_FORECAST ?? "https://api.open-meteo.com";
const GEOCODING = process.env.OPEN_METEO_GEOCODING ?? "https://geocoding-api.open-meteo.com";
// Used when pxls sends an empty location (the page's Weather Location is blank).
const DEFAULT_CITY = process.env.DEFAULT_CITY ?? "";
const KEY = process.env.OPEN_METEO_KEY ? `&apikey=${encodeURIComponent(process.env.OPEN_METEO_KEY)}` : "";

const places = new Map(); // city -> { latitude, longitude }; cities do not move

async function get(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
  if (!r.ok) throw new Error(`upstream HTTP ${r.status}`);
  return r.json();
}

async function locate(city) {
  if (!places.has(city)) {
    const g = await get(`${GEOCODING}/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json${KEY}`);
    const p = g.results?.[0];
    if (!p) throw new Error("unknown place");
    places.set(city, { latitude: p.latitude, longitude: p.longitude });
  }
  return places.get(city);
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname !== "/weather") return res.writeHead(404).end();
    try {
      const city = ((url.searchParams.get("q") || DEFAULT_CITY).split(",")[0] ?? "").trim();
      if (!city) throw new Error("no city: set Weather Location in pxls or DEFAULT_CITY here");
      const unit = url.searchParams.get("u") === "celsius" ? "celsius" : "fahrenheit";
      const { latitude, longitude } = await locate(city);
      const f = await get(
        `${FORECAST}/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true&temperature_unit=${unit}${KEY}`,
      );
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ temp: f.current_weather.temperature, code: f.current_weather.weathercode }));
    } catch (e) {
      // pxls draws nothing on any non-2xx reply
      res.writeHead(502, { "content-type": "text/plain" }).end(String(e.message));
    }
  })
  .listen(PORT, HOST, () => console.log(`weather bridge on http://${HOST}:${PORT}/weather`));
