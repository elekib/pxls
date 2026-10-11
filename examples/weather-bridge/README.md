# Example weather bridge (Open-Meteo)

pxls names no weather service. It reads the weather from the URL in `PXLS_WEATHER_URL` and expects `{ "temp": 21.6, "code": 3 }` (see [Weather](../../README.md#weather)). Most weather APIs answer in a different shape, so you run a small bridge that converts one into it. This is a working example for [Open-Meteo](https://open-meteo.com/): a single file, no dependencies, Node 22 or newer.

## Run it

```bash
node weather-bridge.mjs
```

```bash
# .env for pxls (the container uses the host network, so 127.0.0.1 reaches the bridge)
PXLS_WEATHER_URL=http://127.0.0.1:8787/weather?q={location}&u={unit}
```

The city comes from pxls: the clock page's **Weather Location** (for example `New York,NY`) replaces `{location}`, and its **Temperature Unit** replaces `{unit}`. The bridge looks up the first part of the location before the comma. Set `DEFAULT_CITY` on the bridge for pages that leave the location blank.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8787` | Port to listen on |
| `HOST` | `127.0.0.1` | Interface to bind. Keep it local unless you add your own access control |
| `DEFAULT_CITY` | empty | City to use when pxls sends none |
| `OPEN_METEO_KEY` | empty | API key from an Open-Meteo paid plan |
| `OPEN_METEO_FORECAST` | `https://api.open-meteo.com` | Forecast base URL (`https://customer-api.open-meteo.com` with a key, or your own server) |
| `OPEN_METEO_GEOCODING` | `https://geocoding-api.open-meteo.com` | Geocoding base URL (`https://customer-geocoding-api.open-meteo.com` with a key) |

Any non-200 reply makes pxls draw no weather, so an unknown city or an upstream error leaves just the clock and date.

## Terms

pxls is not affiliated with, endorsed by or sponsored by Open-Meteo, and this example is provided as is, without warranty. It is a convenience, not an endorsement or a bundled service. Nothing here is legal advice. Open-Meteo's free API is for **non-commercial use only**, and its data is licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), so credit [Open-Meteo.com](https://open-meteo.com/) if you share what it shows. Read their [terms](https://open-meteo.com/en/terms) and use a paid plan for commercial use. You are responsible for the service you connect.

## Write your own

Any language works. The whole contract is: answer `GET` with HTTP 200 and `{"temp": <number>, "code": <WMO code, optional>}`. Keep the bridge on a private address, since it can hold an API key.
