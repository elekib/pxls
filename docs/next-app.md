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

## Roadmap

1. ✅ Device link, engine, health, test controls, single image and CI.
2. Database on the existing SQLite schema, accounts and sessions (port of `auth.rs`, `accounts.rs`).
3. Config and device settings, render loop and pages, native-mode keep-alive.
4. Notifications, webhooks and actions, tools.
5. Port the remaining UI pages, then release 0.2.0.
