# Changelog

All notable changes are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

Planned as 0.2.0. pxls is rebuilt as a single Node.js app (Next.js) in one container, `pxls`. Accounts are handled by Better Auth; create the admin again with the setup code on first start.

### Changed
- One app and one container replace the Rust backend and the nginx web container. The UI, API and webhook receiver are all on port 3030 (`PXLS_PORT`). Logs: `docker logs pxls`.
- The Bluetooth link uses BlueZ's `rfcomm` and a raw `/dev/rfcommN` link instead of a native library; no D-Bus mount is needed. Optional `PIXOO_CHANNEL` and `PIXOO_RFCOMM_DEV`.
- Pages render on the server, and every tab has its own URL, so a refresh no longer jumps back to Device.
- Accounts and sessions use Better Auth. The browser signs in with an `httpOnly`, `SameSite=Strict` session cookie. Scripts sign in at `/api/auth/sign-in/username` and use the session token as a bearer token; the JWT and refresh-token flow and `/api/users/*` are gone (admins use `/api/auth/admin/*`). Sign-in is rate limited per address (10 per 15 minutes) instead of locking accounts. `PXLS_JWT_SECRET` is now `PXLS_AUTH_SECRET`; new `PXLS_BASE_URL`.
- Brightness is its own card on the Device page: it applies while you drag, saves itself, and also drives Light mode (which used to have a second, conflicting slider).
- Score mode on the Device page uses the Tools scoreboard controls; both accept typed scores.
- "Show Divoom Logo" is labelled "Show Cloud Channel" (the setting is still not sent to the device; see docs/protocol.md).
- Diagnostics also has quick tests (brightness, colours, clock, score, buzzer, music modes), which hold the display like a raw send.
- `PXLS_ALLOWED_ORIGINS` now only adds origins to the sign-in CSRF check; the API no longer answers cross-origin (CORS) requests.

### Fixed
- Connect cannot hang: the device connect gives up after 20 seconds with a clear error.
- Clock pages use the timezone saved on the Device page (it was ignored in favour of the container's clock).
- Animated GIF pages play at their real speed (they ran ten times too fast) and are scaled per frame.
- Flash Screen and flashing image notifications blink (they showed a steady colour).
- The display returns as soon as a notification ends, instead of up to 10 seconds later.
- Custom script pages stop after 5 seconds instead of blocking the display.
- Webhook image templates draw text with the bitmap font instead of placeholder dots.
- A system name containing quotes no longer breaks the Beszel lookup.
- Lockout ignores a client's own `X-Forwarded-For` header.

### Added
- `PXLS_LOG_PACKETS=1` logs every packet sent to the device.

## [0.1.0]

### Added
- Required API authentication: user accounts for the UI and API (see below), and a per-webhook secret for incoming webhooks.
- `PXLS_ALLOWED_ORIGINS` CORS allowlist and `PXLS_ALLOW_PRIVATE_URLS` switch for webhook image downloads.
- Version and git revision reported by `/api/health` and shown in the UI.
- Versioned SQL migrations for the database: add a numbered file under `backend/src/database/migrations/`.
- User accounts with roles (`admin`, `viewer`) and argon2id password hashes. Sessions are stored in the database and can be listed and revoked (sign out, sign out everywhere, admin revoke); changing a password revokes all of a user's sessions.
- First-run setup in the web UI, gated by a one-time setup code printed in the backend log. No default credentials.
- Login throttling with temporary lockout per username and per IP, identical error messages for unknown users and wrong passwords, and `pxls::security` log events that never contain credentials or tokens.
- Web UI: username/password login, session-expiry handling, an Account page (change password, manage sessions) and an admin Users page (create, disable, delete, reset passwords, change roles).
- Database migration `0003_better_auth` (user, session, account, rate limit tables). Optional `PXLS_AUTH_SECRET`, `PXLS_BASE_URL` and `PXLS_COOKIE_SECURE`.
- Admin-only Diagnostics page (`PXLS_ENABLE_DEBUG=1`) that sends raw commands to the connected device and sweeps values, for testing hardware. Backed by `POST /api/debug/send` (admin only, off by default; the display loop is paused while probing).

### Changed
- The project is now called pxls.
- The UI calls the API on its own origin; nginx proxies `/api` to the backend, so no API address is baked into the frontend image.
- The backend image is built in stages and runs on `debian:bookworm-slim`.
- `command_tester` and `library_tool_test` moved to `backend/examples/`.
- Every `/api` route except `/api/health` and `/api/webhook/:name` now requires a user access token, and viewers are limited to read-only routes. The webhook receiver still uses its per-webhook secret.
- Replaced the third-party `pixoo` crate (GPL-3.0) with pxls's own clean-room Bluetooth driver in `backend/src/device/`, built behind a small transport trait and covered by golden-byte tests. No command has been verified on a real Pixoo yet; see the device test checklist in `docs/protocol.md`.
- Packets now use little-endian length and checksum and brightness command `0x74` (0-100), as in public Timebox protocol write-ups. `docs/protocol.md` was corrected accordingly.
- The Bluetooth link is now closed on drop and by an explicit `disconnect()`. Before, the `drop(pixoo)` calls after countdown, sound detector and scoreboard did nothing.
- The 12/24 hour setting is not sent to the device until its command is confirmed. The buzzer no longer also switches to the scoreboard channel. The timer tool supports start and stop only.
- `command_tester` and `library_tool_test` use the new driver.
- Scoreboard scores accept 0-999 (were 0-99) in the config, `/api/tools/scoreboard` and the web UI.

- Tools page: countdown, sound detector and scoreboard now run on the already-open Bluetooth link, the same way Device config drives the display, instead of closing the link and reconnecting. The scoreboard sends mode `0x45 06` (the `0x50` tool command made the display show a logo and is no longer used by the app). Ending or stopping a tool re-applies the device config on the same link at once. Set `PXLS_TOOL_CLOSE_LINK=1` to go back to closing the link after a tool (with a fixed 2 s reconnect retry). None of this is confirmed on a real device yet.
- `GET /api/connection-status` now returns `tool_type` (`countdown`, `sound_detector`, `scoreboard`, or null) and `tool_remaining_secs` (null when there is no timer); `tool_active_until` was removed.
- Saving Device config while a tool runs no longer interrupts it; the config applies when the tool ends.
- Buzzer (Tools page and the webhook play-sound action) is sent on the open link instead of a second Bluetooth connection, which likely failed. Needs device test.
- Buzzer: the Active Time and Off Time inputs were removed from the Tools page, because the driver only sends the total time.

### Fixed
- Diagnostics page: a **Restore display** button (`POST /api/debug/release`) ends the probe pause and puts the display back to the configured mode, so a probe no longer leaves it stuck on red.
- Tools page: the status no longer flips to Disconnected after a scoreboard click, the sound detector is no longer shown as "Countdown Active", and the scoreboard no longer shows a 24 hour countdown.
- Tools page: Bluetooth work for the tool routes runs off the async worker threads and no longer holds the device lock while sleeping, so status polls do not stall.
- Tools page: the Device Status card is gone. Connection stays in the side nav status, and the running tool's card shows its time and a Stop button.
- Tools page: the countdown presets editor is part of the Countdown card with its own Save, the buzzer has its own Save, and rapid scoreboard +/- clicks send only the latest value.

### Security
- Uploads are validated by content, size and dimensions, stored under sanitized names and served only from the uploads directory.
- Webhook image downloads block private, loopback and link-local addresses by default and re-check every redirect.
- CORS no longer allows every origin.
