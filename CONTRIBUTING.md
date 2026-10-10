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

You need Docker for the full stack, and Node 22+ for local checks.

```bash
cp .env.example .env     # set PIXOO_MAC and TZ
docker compose -f compose.yaml -f compose.build.yaml up --build
```

The app is at http://localhost:3500.

### App (Next.js)

pxls is a single Next.js app in `web/`: the UI, the API and the display engine run in one process.

```bash
cd web
npm ci
npm run dev        # dev server on :3000
npm run typecheck
npm test
npm run build
```

The Bluetooth link needs Linux with BlueZ (`rfcomm`). Elsewhere the engine reports the device as `error` and keeps retrying; the UI and API still work.

## Testing a change on a server (experimental builds)

For one-off tests, push a branch named `exp/<name>` (this needs write access to the repository; everyone else can test with `make dev` or in their own fork). The **Publish experimental images** workflow builds the image and pushes it to GHCR as `exp-<name>` and `sha-<short>`. They never touch `dev` or `latest`.

```bash
git switch -c exp/my-test
git push -u origin exp/my-test
```

When the run finishes, its summary lists the `docker pull` commands. To try it on the server, set the tag in `.env` and pull:

```
PXLS_TAG=exp-my-test
```

```bash
docker compose pull && docker compose up -d
```

Then delete the branch (`git push origin --delete exp/my-test`) and remove the `exp-my-test` tags from the GitHub Packages page. Experimental builds skip the full CI suite, so open a pull request when the change is ready to merge.

## Pull requests

1. Fork the repository and branch from `main`.
2. Keep changes focused. Add or update tests when you change behavior.
3. Make sure formatting, lints, tests and the frontend build pass.
4. Open a pull request describing the change and how you tested it. `main` is protected: CI must pass and the maintainer reviews.

## Database migrations

Persistent data lives in SQLite (`data/pxls.db`). To change the schema, append an entry with the next unused version number to `web/src/lib/db/migrations/index.ts`. Each migration is applied once at startup inside a transaction and recorded in `schema_version`. Never edit a migration that has been released: 0.1.x and 0.2.x share this database.

## Architecture notes

See [AGENTS.md](AGENTS.md) for how the rendering loop, native Divoom modes and device config interact, and [docs/protocol.md](docs/protocol.md) for the Bluetooth protocol.
