# Next.js app (0.2.0)

pxls is being rebuilt as one Next.js app in `web/`: the UI, the API and the display engine run in a single Node process and ship as one image, `ghcr.io/elekib/pxls`. The Rust 0.1.x stack on `main` is the reference until this reaches parity. See [versioning.md](versioning.md).

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

Pushing to `exp/next-app` publishes `ghcr.io/elekib/pxls:exp-next-app` (amd64 while the repository is private). The Rust backend must be stopped first, because only one process can hold the Bluetooth link.

```bash
docker compose stop backend          # in the running 0.1.x stack's folder
docker pull ghcr.io/elekib/pxls:exp-next-app
docker run -d --name pxls-next --privileged --net=host -v /dev:/dev \
  -e PIXOO_MAC="$PIXOO_MAC" -e PXLS_ENABLE_DEBUG=1 -e PORT=3500 \
  ghcr.io/elekib/pxls:exp-next-app
docker logs -f pxls-next             # expect "[engine] connected"
```

Open `http://<server>:3500`. The device card should say **connected**. Use the test controls (brightness, colors, clock, score, buzzer, music modes) and check the display. `curl http://<server>:3500/api/health` returns the version and device status.

Then put the 0.1.x stack back:

```bash
docker rm -f pxls-next
docker compose start backend
```

`PXLS_ENABLE_DEBUG=1` lets anyone on your network use the test controls, because there are no accounts yet. Stop the container when you are done.

## Parity plan

Goal: everything the Rust 0.1.x app does, rebuilt Next-native (server components and server actions for the UI), on the **same `data/pxls.db`** so switching images keeps all data and can roll back. Each phase ends with a pushed `exp-next-app` image to test on the server.

| Phase | Scope | Rust reference (on `main`) |
|---|---|---|
| 0 ✅ | Device link, engine, health, device test page, single image, CI | `device/`, `routes/health.rs` |
| 1 | Database (same file, WAL, migrations 0001/0002), first-run setup code, login, sessions, lockout, Account page, Users page (admin), role checks, `/api/auth/*` and `/api/users/*` for scripts | `database/`, `accounts.rs`, `auth.rs`, `routes/account.rs`, `routes/users.rs` |
| 2 | Config and Device page: connect/disconnect, brightness, time format, native modes, `apply_device_config` on connect and save, secret redaction | `config.rs`, `routes/config.rs`, `routes/device.rs`, `rendering/device_config.rs`, `modes/divoom.rs` |
| 3 | Render loop and Pages page: custom page rotation, native-mode keep-alive (no `set_color` heartbeat), font and renderer, page types (clock/weather, system/GPU stats, temps, Beszel, text, pixels, script, image upload), uploads with `image_guard` | `rendering/`, `renderer.rs`, `font.rs`, `pages/`, `routes/upload.rs`, `routes/beszel.rs`, `image_guard.rs` |
| 4 | Tools page: countdown, sound detector, scoreboard, buzzer, stop, tool state | `routes/tools.rs`, `tool_state.rs`, `pixoo_wrapper.rs` |
| 5 | Webhooks: receiver with per-webhook secret, rules, conditions, actions, payload tester, notifications, image processing with `net_guard`, events log and replay | `webhook_enhanced.rs`, `routes/webhook*.rs`, `routes/enhanced_webhooks.rs`, `actions/`, `notification/`, `webhook_image_processor.rs`, `net_guard.rs` |
| 6 | Diagnostics page (admin, flag gated), mobile nav, polish, docs, then release 0.2.0 | `routes/debug.rs`, `frontend/src/components/` |

Rules for every phase: same API paths and JSON shapes where scripts use them, secrets never logged or returned, golden-byte tests stay green, tests in `web/__tests__/`.
