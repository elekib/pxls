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
# Edit .env: set TZ
docker compose up -d
```

Open http://localhost:3030. On first run pxls asks you to create the admin account (see [Authentication](#authentication)). Then open the **Device** page, enter your Pixoo's Bluetooth MAC address (format `AA:BB:CC:DD:EE:FF`) and connect.

> Published images are not available yet. Until the first release, build from source:
> `docker compose -f compose.yaml -f compose.build.yaml up --build -d` (or `make dev`).

## Authentication

pxls has user accounts. There are no default credentials and no shared token. Everything except `/api/health` and the webhook receiver requires a signed-in user.

### First run: create the admin

With no accounts, the backend prints a one-time setup code to its log, and the web UI shows a setup form instead of a login form:

```bash
docker logs pxls-backend 2>&1 | grep -i "setup code"
```

Open http://localhost:3030, enter that code, and choose an admin username and password. This proves you control the server, so a stranger who finds a fresh instance on your network cannot claim it. The code works until an admin exists, is checked in constant time, is rate limited, and is regenerated (and the old one invalidated) on every restart while no accounts exist.

### Users and roles

| Role | Can do |
|---|---|
| `admin` | Everything, plus the **Users** page: create, disable and delete users, change roles, reset passwords, revoke sessions |
| `viewer` | Read-only: device status, pages and event logs. Cannot change anything, see webhook definitions (they contain secrets) or manage users |

There is no self-registration; an admin creates accounts. Passwords are 12 to 128 characters and are stored as argon2id hashes with a per-user salt. The last enabled admin cannot be deleted, disabled or demoted.

### Sessions

- Signing in returns a short-lived access token (JWT, 15 minutes) that the UI keeps in memory, and sets a rotating refresh token in an `httpOnly`, `SameSite=Strict` cookie scoped to `/api/auth`. The UI refreshes silently; if the session is gone it returns you to the login screen.
- Sessions live in the database, so they can be listed and revoked on the **Account** page (and by an admin). Revoking, signing out, disabling a user or changing a password takes effect immediately, not when the access token expires. Changing a password signs that user out everywhere.
- Using a refresh token twice (a sign of theft) revokes that whole session.
- Sessions expire after 7 days idle and 30 days in total.
- The JWT signing secret is generated on first start and stored in `pxls.db`. Set `PXLS_JWT_SECRET` (32+ characters) to supply your own; changing it signs everyone out.
- Five failed sign-ins for a username lock that name for 15 minutes, and 20 from one IP lock that IP. This applies to names that do not exist too, and error messages never say whether an account exists. A determined attacker can therefore temporarily lock a known username out; that is the cost of throttling guessing.
- Behind the bundled nginx, the client IP comes from `X-Real-IP`, which is only trusted from loopback or private peers.

### Scripts and automation

There is no static API token. Use a dedicated account (a `viewer` for read-only scripts) and sign in with a cookie jar:

```bash
curl -s -c jar -H 'X-Requested-With: pxls' -H 'Content-Type: application/json' \
  -d '{"username":"script","password":"..."}' http://localhost:3030/api/auth/login
# use "access_token" from the response as: -H "Authorization: Bearer <token>"
# when it expires (15 min): curl -s -b jar -c jar -X POST -H 'X-Requested-With: pxls' http://localhost:3030/api/auth/refresh
```

Mutating `/api/auth` calls need the `X-Requested-With: pxls` header (CSRF protection).

If you are behind another reverse proxy that rewrites the `Host` header, add your public origin to `PXLS_ALLOWED_ORIGINS`, otherwise sign-in is rejected by the CSRF check. Serve pxls over HTTPS and forward `X-Forwarded-Proto: https` so the refresh cookie gets the `Secure` flag (or set `PXLS_COOKIE_SECURE=true`).

### Lost the admin password

Stop the backend and remove the accounts so first-run setup returns. This deletes users and their sessions only, not your configuration:

```bash
docker compose stop backend
sqlite3 data/pxls.db "DELETE FROM users;"
docker compose start backend && docker logs pxls-backend 2>&1 | grep -i "setup code"
```

Incoming webhooks use their own secret instead of a user account (see [Webhooks](#webhooks)).

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PXLS_JWT_SECRET` | generated | Optional JWT signing secret, 32+ characters. By default one is generated on first start and stored in the database |
| `PXLS_COOKIE_SECURE` | auto | Set `true` to always mark the refresh cookie `Secure`. By default it is set when the request arrives with `X-Forwarded-Proto: https` |
| `TZ` | `UTC` | Timezone for clock pages |
| `PXLS_ALLOWED_ORIGINS` | empty | Comma-separated browser origins allowed to call the API cross-origin. Leave empty when using the bundled UI, which shares an origin with the API through its proxy |
| `PXLS_ALLOW_PRIVATE_URLS` | `false` | Let webhook image URLs point at private or LAN addresses (for example a Jellyfin server). Off by default to prevent server-side request forgery |
| `PXLS_TAG` | `latest` | Image tag for `docker compose`: `latest`, `dev` or a version such as `0.1.0` |

Device settings, pages and the rest of the app configuration are edited in the web UI. Everything except uploads is stored in one SQLite database, `./data/pxls.db` (with `pxls.db-wal` and `pxls.db-shm` next to it while running), created on first run. Uploaded images live in `./data/uploads`. The `data/` directory and `.env` are git-ignored so they never get committed.

**`pxls.db` holds secrets** (webhook secrets, Beszel credentials, the full config). Keep `./data` private, and back it up. Stop the container and copy `pxls.db` together with its `-wal` and `-shm` files, or take a consistent copy while running with `sqlite3 data/pxls.db ".backup 'pxls-backup.db'"`.

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

Early development. The API requires a signed-in user, but the Bluetooth device is controlled by the host, so keep pxls on a trusted network and put TLS in front of it before exposing ports 3030 or 3400 beyond your LAN. See [SECURITY.md](SECURITY.md).

## Documentation

- [Bluetooth protocol](docs/protocol.md)
- [Contributing](CONTRIBUTING.md) and [architecture notes](AGENTS.md)
- [Changelog](CHANGELOG.md)

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first. Commits must be signed off (`git commit -s`) to certify the Developer Certificate of Origin.

## License

No license has been chosen yet, so all rights are reserved for now. A license will be added before the first public release. See [NOTICE](NOTICE).
