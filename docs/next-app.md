# Next.js app (0.2.0)

pxls is one Next.js app in `web/`: the UI, the API and the display engine run in a single Node process and ship as one image, `ghcr.io/elekib/pxls`. All features of the Rust 0.1.x app are ported; `main` keeps 0.1.x until 0.2.0 is released. See [versioning.md](versioning.md).

## How it fits together

| Path | What |
|---|---|
| `web/src/instrumentation.ts` | Starts the engine once when the server starts. |
| `web/src/lib/engine/` | The engine: owns the Bluetooth link, reconnects every 2 s, queues device work. |
| `web/src/lib/device/` | `Pixoo` device API; `rfcomm.ts` talks to the display through a raw `/dev/rfcommN` TTY. |
| `web/src/lib/protocol/` | Packet encoders, byte-identical to the Rust driver (golden tests). |
| `web/src/app/` | Pages (rendered on the server, reading the engine directly) and API routes. |

The Bluetooth approach was proven on a real Pixoo on 2026-10-07 (RFCOMM channel 1, all test steps passed).

## Test on the server

Pushing to `exp/next-app` publishes `ghcr.io/elekib/pxls:exp-next-app` (amd64 while the repository is private). Only one process can hold the Bluetooth link, so stop the Rust backend first.

The Next app opens the **same `pxls.db`** as the Rust app (same schema, migrations and JWT key), so your existing users and passwords work. Back the database up before the first run:

```bash
cd /opt/stacks/pixoo                 # the running 0.1.x stack
docker compose stop backend
cp -a data data.bak-$(date +%F)
docker pull ghcr.io/elekib/pxls:exp-next-app
docker run -d --name pxls-next --privileged --net=host -v /dev:/dev -v "$PWD/data:/app/data" \
  --env-file .env -e PORT=3500 ghcr.io/elekib/pxls:exp-next-app
docker logs -f pxls-next             # expect "[engine] connected"
```

Open `http://<server>:3500` and sign in with your existing account. Browser sessions from the Rust UI do not carry over (new cookie), so everyone signs in once. Device test controls appear for admins when `PXLS_ENABLE_DEBUG=1`.

Put the 0.1.x stack back with `docker rm -f pxls-next && docker compose start backend`. Both apps read the same data, so nothing is lost either way.

## Parity plan

Goal: everything the Rust 0.1.x app does, rebuilt Next-native (server components and server actions for the UI), on the **same `data/pxls.db`** so switching images keeps all data and can roll back. Each phase ends with a pushed `exp-next-app` image to test on the server.

| Phase | Scope | Rust reference (on `main`) |
|---|---|---|
| 0 ✅ | Device link, engine, health, device test page, single image, CI | `device/`, `routes/health.rs` |
| 1 ✅ | Database (same file, WAL, migrations 0001/0002), first-run setup code, login, sessions, lockout, Account page, Users page (admin), role checks, `/api/auth/*` and `/api/users/*` for scripts | `database/`, `accounts.rs`, `auth.rs`, `routes/account.rs`, `routes/users.rs` |
| 2 ✅ | Config and Device page: connect/disconnect, brightness, time format, native modes, `apply_device_config` on connect and save, secret redaction | `config.rs`, `routes/config.rs`, `routes/device.rs`, `rendering/device_config.rs`, `modes/divoom.rs` |
| 3 ✅ | Render loop and Pages page: custom page rotation, native-mode keep-alive (no `set_color` heartbeat), font and renderer, page types (clock/weather, system/GPU stats, temps, Beszel, text, pixels, script, image upload), uploads with `image_guard` | `rendering/`, `renderer.rs`, `font.rs`, `pages/`, `routes/upload.rs`, `routes/beszel.rs`, `image_guard.rs` |
| 4 ✅ | Tools page: countdown, sound detector, scoreboard, buzzer, stop, tool state | `routes/tools.rs`, `tool_state.rs`, `pixoo_wrapper.rs` |
| 5 ✅ | Webhooks: receiver with per-webhook secret, rules, conditions, actions, payload tester, notifications, image processing with `net_guard`, events log and replay | `webhook_enhanced.rs`, `routes/webhook*.rs`, `routes/enhanced_webhooks.rs`, `actions/`, `notification/`, `webhook_image_processor.rs`, `net_guard.rs` |
| 6 ✅ | Diagnostics page (admin, flag gated, plus quick tests), mobile nav, docs and upgrade guide, slim bundle. Next: device checks, then release 0.2.0 | `routes/debug.rs`, `frontend/src/components/` |

Rules for every phase: same API paths and JSON shapes where scripts use them, secrets never logged or returned, golden-byte tests stay green, tests in `web/__tests__/`.
