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

### Changed
- The project is now called pxls.
- The UI calls the API on its own origin; nginx proxies `/api` to the backend, so no API address is baked into the frontend image.
- The backend image is built in stages and runs on `debian:bookworm-slim`.
- `command_tester` and `library_tool_test` moved to `backend/examples/`.
- Every `/api` route except `/api/health` and `/api/webhook/:name` now requires a user access token, and viewers are limited to read-only routes. The webhook receiver still uses its per-webhook secret.

### Security
- Uploads are validated by content, size and dimensions, stored under sanitized names and served only from the uploads directory.
- Webhook image downloads block private, loopback and link-local addresses by default and re-check every redirect.
- CORS no longer allows every origin.
