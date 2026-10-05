# pxls

Open-source dashboard for custom messaging and integrations on legacy Divoom Pixoo Bluetooth devices (16x16).

> pxls is an unofficial community project. It is not affiliated with, endorsed by, or sponsored by Divoom. "Pixoo" and "Divoom" are trademarks of their respective owners and are used here only to describe compatible hardware.

## What it does

pxls runs next to your Pixoo, talks to it over Bluetooth, and gives you a web UI to decide what it shows.

- **Page rotation.** Build a list of pages and cycle through them on a timer. Page types:
  - Clock and weather
  - System stats, GPU stats and temperatures (from dashdot or Beszel)
  - Custom text
  - Pixel art, drawn pixel by pixel
  - Uploaded images and animations
  - Custom scripts
- **Native Divoom modes.** Let the device render its own environment clock, light, special, music, user or score modes.
- **Webhooks.** Receive events from other services (for example Radarr or Sonarr). Rules match on the payload and trigger a notification, an image, a screen flash and more. Every received event is logged and can be replayed.
- **Tools.** Buzzer, countdown, sound detector and scoreboard.
- **Device control.** Connect and disconnect, brightness, 12h/24h time format.

## Requirements

- A legacy Pixoo with Bluetooth (16x16) within range of the host
- A Linux host with Bluetooth and BlueZ. The backend needs host networking and access to D-Bus and `/dev`
- Docker with Compose

Bluetooth access from inside a container is the fiddly part. The backend runs `privileged` with the host's `/dev` and D-Bus socket mounted. Narrowing this is on the roadmap.

## Quick start (development)

```bash
cp .env.example .env   # set TZ at minimum
docker compose up --build
```

- Web UI: http://localhost:3030
- Backend API: http://localhost:3400

Then open the **Device** page, enter your Pixoo's Bluetooth MAC address (format `AA:BB:CC:DD:EE:FF`) and connect.

Settings are stored in `./data/config.json`, created on first run. Webhook definitions, rules, the event log and uploads live in `./data` too. The `data/` directory and `.env` are git-ignored, so they never get committed.

## Webhooks

Point a sender at `POST /api/webhook/<name>`, for example a Radarr or Sonarr "Webhook" connection:

```
http://<host>:3400/api/webhook/radarr
```

Define the webhook and its rules on the **Webhooks** page. Use the **Events** page to inspect incoming payloads, test rules and replay events.

## Project layout

| Path | Contents |
|---|---|
| `backend/` | Rust (axum, tokio) API, rendering loop and Bluetooth driver |
| `frontend/` | Vite, React and Tailwind web UI, served by nginx |
| `docs/` | Protocol reference |
| `scripts/` | Optional helper scripts |
| `compose.yaml` | Local build and run |

## Status and security

Early development. Authentication, published container images and a full setup guide are in progress. **Until authentication lands the API is open to anyone on your network.** Run pxls only on a trusted network and do not expose ports 3030 or 3400 to the internet.

## Documentation

- [Bluetooth protocol](docs/protocol.md)
- [Contributing](AGENTS.md)

## Contributing

Issues and pull requests are welcome. Sign off your commits (`git commit -s`) to certify the Developer Certificate of Origin. See [AGENTS.md](AGENTS.md) for architecture notes.

## License

No license has been chosen yet, so all rights are reserved for now. A license will be added before the first public release. See [NOTICE](NOTICE).
