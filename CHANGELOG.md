# Changelog

All notable changes are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

First release (0.1.0). pxls is a single Node.js app (Next.js) in one container, `pxls`.

### Added
- One app and one container: the UI, the API and the webhook receiver are all on port 3030 (`PXLS_PORT`). Logs: `docker logs pxls`. Every page has its own URL and is rendered on the server.
- A Bluetooth link to the display through BlueZ's `rfcomm` and a raw `/dev/rfcommN` TTY, with pxls's own clean-room packet driver covered by golden-byte tests. Optional `PIXOO_CHANNEL` and `PIXOO_RFCOMM_DEV`. The device connect gives up after 20 seconds with a clear error, so Connect cannot hang; per-command verification status is in `docs/protocol.md`.
- Page rotation with page types for clock and weather, system and GPU stats, Beszel, text, pixel art, images and animated GIFs, and custom scripts (stopped after 5 seconds). Divoom native page types (Clock, Light, Special, Music, User GIFs, Scoreboard) can be added in the page editor, and a page can set its own display time (`duration_secs`).
- Native Divoom modes on the Device page, a live brightness card, and a timezone for clock pages. User GIFs is re-sent only on change and every 5 minutes, so the slideshow is not restarted.
- Tools: countdown, sound detector and scoreboard.
- Webhooks with a per-webhook secret, rules, conditions, actions, notifications and an event log with replay. Flash and image notifications blink, and the display returns as soon as one ends.
- Accounts and sessions on Better Auth, with `admin` and `viewer` roles, a one-time setup code printed in the log for the first admin, an Account page and an admin Users page. Scripts sign in at `/api/auth/sign-in/username` and use the session token as a bearer token. Optional `PXLS_AUTH_SECRET`, `PXLS_BASE_URL`, `PXLS_COOKIE_SECURE` and `PXLS_ALLOWED_ORIGINS`.
- An admin-only Diagnostics page (`PXLS_ENABLE_DEBUG=1`) with raw commands, value sweeps and quick tests, and `PXLS_LOG_PACKETS=1` to log every packet sent to the device.
- The version and git revision in the UI and, for signed-in users, in `/api/health`.
- Versioned SQL migrations for the SQLite database (`web/src/lib/db/migrations/index.ts`).

### Security
- Every API route except `/api/health`, `/api/auth/*` and the webhook receiver requires a signed-in user, and viewers are limited to read-only routes. A default-deny `proxy.ts` and a test that fails when an API route has no guard enforce this.
- Sign-in is rate limited per client address (10 attempts per 15 minutes). Error messages never say whether an account exists.
- Security headers (CSP, `nosniff`, frame denial), a CSRF header for cookie requests, and an origin check that trusts the Host the browser used. The API does not answer cross-origin (CORS) requests.
- `/api/health` reports only liveness to anonymous callers.
- Uploads are validated by content, size and dimensions, stored under sanitized names and served only from the uploads directory.
- Webhook image downloads block private, loopback and link-local addresses by default (`PXLS_ALLOW_PRIVATE_URLS`) and re-check every redirect.
