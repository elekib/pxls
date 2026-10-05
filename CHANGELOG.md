# Changelog

All notable changes are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Required API authentication: a shared token (`PXLS_AUTH_TOKEN`) for the UI and API, and a per-webhook secret for incoming webhooks.
- Token login screen in the web UI.
- `PXLS_ALLOWED_ORIGINS` CORS allowlist and `PXLS_ALLOW_PRIVATE_URLS` switch for webhook image downloads.
- Version and git revision reported by `/api/health` and shown in the UI.

### Changed
- The project is now called pxls.
- The UI calls the API on its own origin; nginx proxies `/api` to the backend, so no API address is baked into the frontend image.
- The backend image is built in stages and runs on `debian:bookworm-slim`.
- `command_tester` and `library_tool_test` moved to `backend/examples/`.

### Security
- Uploads are validated by content, size and dimensions, stored under sanitized names and served only from the uploads directory.
- Webhook image downloads block private, loopback and link-local addresses by default and re-check every redirect.
- CORS no longer allows every origin.
