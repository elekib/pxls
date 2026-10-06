# Changelog

All notable changes are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Required API authentication: user accounts for the UI and API (see below), and a per-webhook secret for incoming webhooks.
- `PXLS_ALLOWED_ORIGINS` CORS allowlist and `PXLS_ALLOW_PRIVATE_URLS` switch for webhook image downloads.
- Version and git revision reported by `/api/health` and shown in the UI.
- Versioned SQL migrations for the database: add a numbered file under `backend/src/database/migrations/`.
- User accounts with roles (`admin`, `viewer`), argon2id password hashes, JWT access tokens (15 minutes) and rotating refresh tokens in an `httpOnly` `SameSite=Strict` cookie. Sessions are stored in the database and can be listed and revoked (sign out, sign out everywhere, admin revoke); changing a password revokes all of a user's sessions, and refresh-token reuse revokes the session.
- First-run setup in the web UI, gated by a one-time setup code printed in the backend log. No default credentials.
- Login throttling with temporary lockout per username and per IP, identical error messages for unknown users and wrong passwords, and `pxls::security` log events that never contain credentials or tokens.
- Web UI: username/password login, silent token refresh, session-expiry handling, an Account page (change password, manage sessions) and an admin Users page (create, disable, delete, reset passwords, change roles).
- Database migration `0002_users_sessions` (users, sessions, login attempts). Optional `PXLS_JWT_SECRET` and `PXLS_COOKIE_SECURE`.
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
- Buzzer: the Active Time and Off Time inputs were removed from the Tools page, because the driver only sends the total time.

### Fixed
- Tools page: the status no longer flips to Disconnected after a scoreboard click, the sound detector is no longer shown as "Countdown Active", and the scoreboard no longer shows a 24 hour countdown.
- Tools page: Bluetooth work for the tool routes runs off the async worker threads and no longer holds the device lock while sleeping, so status polls do not stall.
- Tools page: the countdown presets editor is part of the Countdown card with its own Save, the buzzer has its own Save, and rapid scoreboard +/- clicks send only the latest value.

### Security
- Uploads are validated by content, size and dimensions, stored under sanitized names and served only from the uploads directory.
- Webhook image downloads block private, loopback and link-local addresses by default and re-check every redirect.
- CORS no longer allows every origin.
