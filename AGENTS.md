# Contributing Notes

Guide for contributors and coding agents working on pxls.

## Rules

- Never commit `data/` or `.env`. They hold credentials, event logs and personal media.
- Keep "Pixoo" descriptive only (Divoom trademark). The project name is pxls.
- Preserve secret handling: `config.rs` redacts secrets in `Debug`, and `routes/config.rs` strips them from API responses.
- Device behavior needs a real Pixoo over Bluetooth. Say so in a PR if you could not test it.

## Build and run

- Full stack from source: `make dev` (same as `docker compose -f compose.yaml -f compose.build.yaml up --build -d`). Builds run inside Docker.
- Frontend (Vite/React) is served on port 3030 and proxies `/api` to the backend.
- Backend API: http://localhost:3400 (requires a user access token: `Authorization: Bearer <JWT>` from `POST /api/auth/login`; first-run setup code is in the log). Logs: `docker logs -f pxls-backend`.

## Architecture

- `backend/src/rendering/loop_renderer.rs`: main display loop.
  - Custom mode (`light_mode == "custom"`): rotates through `custom_pages`, rendering images and pushing them. Divoom-native page types are applied via `apply_divoom_mode`, and only reapplied on page change or about every 10s as keep-alive.
  - Native Divoom mode (env/light/special/music/user/score): applies the mode via `apply_divoom_mode_from_config` and periodically reapplies it as refresh and keep-alive.
- Do not send a `set_color` heartbeat in native mode. It overwrites the native display and causes a clock, blank, clock flicker.
- `backend/src/modes/divoom.rs`: `apply_divoom_mode_from_config` (device level) and `apply_divoom_mode` (per page).
- `backend/src/rendering/device_config.rs`: `apply_device_config` runs on connect and save, applying brightness, time format and the selected native mode immediately.

## Sign-off

Contributions use the DCO. Sign commits with `git commit -s`.
