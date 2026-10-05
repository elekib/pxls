<p align="center">
  <img src="branding/pxls-logo.svg" alt="pxls" width="320">
</p>

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

The images are built for `linux/amd64` and `linux/arm64`, so a Raspberry Pi works.

## Quick start

```bash
cp .env.example .env
# Edit .env: set PXLS_AUTH_TOKEN (see below) and TZ
docker compose up -d
```

Open http://localhost:3030 and sign in with your token. Then open the **Device** page, enter your Pixoo's Bluetooth MAC address (format `AA:BB:CC:DD:EE:FF`) and connect.

> Published images are not available yet. Until the first release, build from source:
> `docker compose -f compose.yaml -f compose.build.yaml up --build -d` (or `make dev`).

## Authentication

pxls requires an API token and refuses to start without one. Generate it and put it in `.env`:

Any long random string of at least 16 characters works. Pick one of these:

| Tool | Command |
|---|---|
| OpenSSL (Linux, macOS) | `openssl rand -hex 32` |
| Python 3 | `python3 -c "import secrets; print(secrets.token_hex(32))"` |
| Node.js | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| Linux / macOS shell, no extra tools | `head -c 32 /dev/urandom \| od -An -tx1 \| tr -d ' \n'; echo` |
| PowerShell (Windows) | `-join ((1..32) \| ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) })` |
| Password manager | Generate a random password of 32+ characters (1Password, Bitwarden, KeePassXC) and store it there as well |

Then set it in `.env`:

```
PXLS_AUTH_TOKEN=<the generated value>
```

Keep the token secret, do not commit `.env`, and use a different value for each deployment. To rotate it, change the value in `.env` and restart the backend (`docker compose up -d`). Everyone then has to sign in again with the new token.

- The web UI asks for the token on first visit and keeps it in your browser's local storage. **Sign out** forgets it.
- API clients send `Authorization: Bearer <token>`.
- `/api/health` is open so container health checks work. It only reports status and version.
- Incoming webhooks use their own secret instead of the API token (see [Webhooks](#webhooks)).

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PXLS_AUTH_TOKEN` | required | API token, at least 16 characters |
| `TZ` | `UTC` | Timezone for clock pages |
| `PXLS_ALLOWED_ORIGINS` | empty | Comma-separated browser origins allowed to call the API cross-origin. Leave empty when using the bundled UI, which shares an origin with the API through its proxy |
| `PXLS_ALLOW_PRIVATE_URLS` | `false` | Let webhook image URLs point at private or LAN addresses (for example a Jellyfin server). Off by default to prevent server-side request forgery |
| `PXLS_TAG` | `latest` | Image tag for `docker compose`: `latest`, `dev` or a version such as `0.1.0` |

Device settings, pages and the rest of the app configuration are edited in the web UI and stored in `./data/config.json`, created on first run. Webhook definitions, rules, the event log and uploads live in `./data` too. The `data/` directory and `.env` are git-ignored so they never get committed.

## Webhooks

Point a sender at `POST /api/webhook/<name>`, for example a Radarr or Sonarr "Webhook" connection:

```
http://<host>:3030/api/webhook/radarr
```

Each webhook has a secret, generated when you create it (and for existing webhooks the first time this version starts). Copy it from the webhook card on the **Webhooks** page. Senders can present it in any of these ways:

- `X-Webhook-Secret: <secret>` header
- HTTP Basic auth with the secret as the password (any username). Radarr and Sonarr support this
- `?secret=<secret>` in the URL, for senders that can do neither. The URL then acts like a password and can show up in logs

A webhook with a missing or wrong secret, or an unknown name, gets `401`.

Define rules on the **Webhooks** page. Use the **Event Logs** page to inspect incoming payloads, test rules and replay events.

## Project layout

| Path | Contents |
|---|---|
| `backend/` | Rust (axum, tokio) API, rendering loop and Bluetooth driver |
| `frontend/` | Vite, React and Tailwind web UI, served by nginx |
| `docs/` | Protocol reference |
| `scripts/` | Optional helper scripts |
| `compose.yaml` | Run the published images |
| `compose.build.yaml` | Overlay that builds the images from source |

## Status and security

Early development. The API requires a token, but the Bluetooth device is controlled by the host, so keep pxls on a trusted network and put TLS in front of it before exposing ports 3030 or 3400 beyond your LAN. See [SECURITY.md](SECURITY.md).

## Documentation

- [Bluetooth protocol](docs/protocol.md)
- [Contributing](CONTRIBUTING.md) and [architecture notes](AGENTS.md)
- [Changelog](CHANGELOG.md)

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first. Commits must be signed off (`git commit -s`) to certify the Developer Certificate of Origin.

## License

No license has been chosen yet, so all rights are reserved for now. A license will be added before the first public release. See [NOTICE](NOTICE).
