# Contributing Notes

Guide for contributors and coding agents working on pxls.

## Rules

- Never commit `data/` or `.env`. They hold credentials, event logs and personal media.
- Keep "Pixoo" descriptive only (Divoom trademark). The project name is pxls.
- Preserve secret handling when porting config: the Rust `config.rs` redacts secrets in `Debug`, and `routes/config.rs` strips them from API responses. Do the same in the Node app (never log secrets, never return them from the API).
- Device behavior needs a real Pixoo over Bluetooth. Say so in a PR if you could not test it.

## Build and run

- pxls is a single Next.js app in `web/` (UI, API and display engine in one process). The Rust `backend/` and Vite `frontend/` live on `main` (0.1.x) as the porting reference.
- Full stack from source: `make dev` (same as `docker compose -f compose.yaml -f compose.build.yaml up --build -d`). App on port 3500 (`PXLS_PORT`). Logs: `docker logs -f pxls`.
- Local checks in `web/`: `npm run typecheck`, `npm test`, `npm run build` (Node 22+).
- Tests live in `web/__tests__/`, mirroring `web/src/` (for example `src/lib/engine/engine.ts` is tested in `__tests__/lib/engine/engine.test.ts`). Import the code under test with `@/` paths. Do not put tests next to source files.

## Architecture

- `web/src/instrumentation.ts` starts the engine once when the server starts.
- `web/src/lib/engine/engine.ts`: process-wide `Engine` (`getEngine()`). Owns the Bluetooth link, reconnects every 2 s, and serializes device work through `run()`. Never write to the device outside `run()`.
- `web/src/lib/device/`: `Pixoo` device API and transports. `rfcomm.ts` binds `/dev/rfcommN` and writes in raw TTY mode (no native addons). `memory.ts` is for tests.
- `web/src/lib/protocol/`: packet encoders with golden-byte tests ported from the Rust driver. Keep them byte-identical unless a device test says otherwise (see `docs/protocol.md`).
- Do not send a `set_color` heartbeat in native mode. It overwrites the native display and causes a clock, blank, clock flicker.

## Sign-off

Contributions use the DCO. Sign commits with `git commit -s`.
