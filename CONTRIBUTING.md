# Contributing to pxls

Thanks for helping. Bug reports, fixes, docs and new integrations are all welcome.

## Ground rules

- Be kind. See the [Code of Conduct](CODE_OF_CONDUCT.md).
- Never commit `data/`, `.env`, credentials or personal media.
- "Pixoo" and "Divoom" are trademarks of their owners and are used here only to describe compatible hardware. The project is called pxls.
- Anything that talks to a real device needs a real device to verify. Say in your PR what you tested and on which hardware, or that you could not test it.

## Developer Certificate of Origin

Contributions are accepted under the [DCO](https://developercertificate.org/). Sign every commit with `-s`:

```bash
git commit -s -m "Describe your change"
```

This adds a `Signed-off-by: Your Name <you@example.com>` line. CI rejects pull requests with unsigned commits. To fix a branch: `git rebase --signoff main`.

## Development setup

You need Docker for the full stack, and optionally Rust 1.88+ and Node 20+ for local checks.

```bash
cp .env.example .env     # set PXLS_AUTH_TOKEN, TZ
docker compose -f compose.yaml -f compose.build.yaml up --build
```

The UI is at http://localhost:3030. Sign in with your `PXLS_AUTH_TOKEN`.

### Backend (Rust)

```bash
cd backend
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

The Bluetooth driver only builds on Linux, so run these on Linux or inside the `rust:1.88-slim-bookworm` image with `libbluetooth-dev libdbus-1-dev libssl-dev pkg-config` installed. CI runs them for you.

### Frontend (React)

```bash
cd frontend
npm ci
npm run dev        # Vite dev server on :3000, proxies /api to http://127.0.0.1:3400
npm run build      # type-check and production build
```

## Pull requests

1. Fork the repository and branch from `main`.
2. Keep changes focused. Add or update tests when you change behavior.
3. Make sure formatting, lints, tests and the frontend build pass.
4. Open a pull request describing the change and how you tested it. `main` is protected: CI must pass and the maintainer reviews.

## Database migrations

Persistent data lives in SQLite (`data/pxls.db`). To change the schema, add a new file `backend/src/database/migrations/NNNN_description.sql` with the next unused number. It is embedded at build time and applied once at startup inside a transaction; there is no list to edit. Never edit a migration that has been released. If two branches pick the same number the build fails with a message telling you to renumber one.

## Architecture notes

See [AGENTS.md](AGENTS.md) for how the rendering loop, native Divoom modes and device config interact, and [docs/protocol.md](docs/protocol.md) for the Bluetooth protocol.
