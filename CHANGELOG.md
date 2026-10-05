# Changelog

All notable changes are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Required API authentication: a shared token (`PXLS_AUTH_TOKEN`) for the UI and API, and a per-webhook secret for incoming webhooks.
- Token login screen in the web UI.
- `PXLS_ALLOWED_ORIGINS` CORS allowlist and `PXLS_ALLOW_PRIVATE_URLS` switch for webhook image downloads.
- Version and git revision reported by `/api/health` and shown in the UI.
- Versioned SQL migrations for the database: add a numbered file under `backend/src/database/migrations/`.
- User accounts with roles (`admin`, `viewer`), argon2id password hashes, JWT access tokens (15 minutes) and rotating refresh tokens in an `httpOnly` `SameSite=Strict` cookie. Sessions are stored in the database and can be listed and revoked (sign out, sign out everywhere, admin revoke); changing a password revokes all of a user's sessions, and refresh-token reuse revokes the session.
- First-run setup in the web UI, gated by a one-time setup code printed in the backend log. No default credentials.
- Login throttling with temporary lockout per username and per IP, identical error messages for unknown users and wrong passwords, and `pxls::security` log events that never contain credentials or tokens.
- Web UI: username/password login, silent token refresh, session-expiry handling, an Account page (change password, manage sessions) and an admin Users page (create, disable, delete, reset passwords, change roles).
- Database migration `0002_users_sessions` (users, sessions, login attempts). Optional `PXLS_JWT_SECRET` and `PXLS_COOKIE_SECURE`.

### Changed
- The project is now called pxls.
- The UI calls the API on its own origin; nginx proxies `/api` to the backend, so no API address is baked into the frontend image.
- The backend image is built in stages and runs on `debian:bookworm-slim`.
- `command_tester` and `library_tool_test` moved to `backend/examples/`.
- Config, webhooks and the webhook event log are stored in a SQLite database, `data/pxls.db`, instead of `config.json`, `webhooks.json` and `webhook_events.json`. Existing JSON files are imported automatically on first start and left in place as a backup. API behavior is unchanged. `pxls.db` contains secrets: back it up and keep `data/` private.
- Every `/api` route except `/api/health` and `/api/webhook/:name` now requires a user access token, and viewers are limited to read-only routes. The webhook receiver still uses its per-webhook secret.
- Replaced the third-party `pixoo` crate (GPL-3.0) with pxls's own clean-room Bluetooth driver in `backend/src/device/`, built behind a small transport trait and covered by golden-byte tests. No command has been verified on a real Pixoo yet; see the device test checklist in `docs/protocol.md`.
- Packets now use little-endian length and checksum and brightness command `0x74` (0-100), as in public Timebox protocol write-ups. `docs/protocol.md` was corrected accordingly.
- The Bluetooth link is now closed on drop and by an explicit `disconnect()`. Before, the `drop(pixoo)` calls after countdown, sound detector and scoreboard did nothing.
- The 12/24 hour setting is not sent to the device until its command is confirmed. The buzzer no longer also switches to the scoreboard channel. The timer tool supports start and stop only.
- `command_tester` and `library_tool_test` use the new driver.

### Security
- Uploads are validated by content, size and dimensions, stored under sanitized names and served only from the uploads directory.
- Webhook image downloads block private, loopback and link-local addresses by default and re-check every redirect.
- CORS no longer allows every origin.

### Removed
- The shared `PXLS_AUTH_TOKEN` and the token login screen. If it is still set, the backend logs a warning and ignores it. To upgrade, restart, read the setup code from the log, and create the admin account in the UI; see the README's Authentication section.
