# Architecture

pxls is one Next.js app in `web/`: the UI, the API and the display engine run in a single Node process and ship as one image, `ghcr.io/elekib/pxls`.

## How it fits together

| Path | What |
|---|---|
| `web/src/instrumentation.ts` | Starts the engine once when the server starts. |
| `web/src/lib/engine/` | The engine: owns the Bluetooth link, reconnects every 2 s, queues device work. |
| `web/src/lib/device/` | `Pixoo` device API; `rfcomm.ts` talks to the display through a raw `/dev/rfcommN` TTY. |
| `web/src/lib/protocol/` | Packet encoders, covered by golden-byte tests. |
| `web/src/lib/render/` | The render loop: page rotation, native-mode keep-alive, bitmap font and page types. |
| `web/src/lib/auth/` | Accounts and sessions on Better Auth, and the guards for API routes and server components. |
| `web/src/lib/webhooks/` | Receiver, rules engine, actions, notifications and the SSRF guard for image downloads. |
| `web/src/app/` | Pages (rendered on the server, reading the engine directly) and API routes. |

The Bluetooth approach was proven on a real Pixoo on 2026-10-07 (RFCOMM channel 1, all test steps passed). Device test controls appear for admins when `PXLS_ENABLE_DEBUG=1`.

Persistent data lives in one SQLite database, `data/pxls.db`. Schema changes are numbered migrations in `web/src/lib/db/migrations/index.ts`. Each migration runs once at startup.

For working on the code, see [AGENTS.md](../AGENTS.md) and [CONTRIBUTING.md](../CONTRIBUTING.md). For releases, see [versioning.md](versioning.md).
