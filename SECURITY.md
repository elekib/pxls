# Security Policy

## Reporting a vulnerability

Please do not open a public issue for security problems.

Report them privately through GitHub: **Security** tab, then **Report a vulnerability** (private security advisory). Include what you found, how to reproduce it, and the version (shown in the UI and, when signed in, by `/api/health`).

You can expect an acknowledgement within a few days. This is a volunteer project, so fixes are made on a best-effort basis.

## Supported versions

Only the latest release and the `dev` image receive fixes.

## Deployment guidance

- pxls uses user accounts, handled by [Better Auth](https://www.better-auth.com). The first admin is created in the web UI with a one-time setup code printed in the pxls log, so a fresh instance cannot be claimed by someone without access to the server. There are no default credentials. Create the admin promptly after first start and keep the log private until you do.
- Passwords are stored as argon2id hashes with a per-user salt (12 character minimum). Sessions are stored server-side and can be revoked at any time. The browser holds an `httpOnly`, `SameSite=Strict` session cookie; scripts use the same session token as a bearer token. A session expires after 7 days without use.
- Sign-in is rate limited per client address (10 attempts per 15 minutes, then `429`), and errors do not reveal whether an account exists. Accounts are not locked, so an attacker cannot block a known username from signing in.
- The session signing secret is stored in `data/pxls.db` (or comes from `PXLS_AUTH_SECRET`). Anyone who can read the database or that secret can forge sessions, so keep `data/` private.
- Security events (first-admin setup, password changes, session revocation, user changes) are logged with the prefix `[security]`. Passwords and tokens are never logged.
- Client addresses for rate limiting and logs come from the TCP connection itself; `X-Real-IP` is honoured only when the peer is a loopback or private address (a reverse proxy on your network), and a client's own `X-Forwarded-For` is ignored.
- Serve pxls over HTTPS if it is reachable beyond your LAN, and set `PXLS_BASE_URL` to the public `https` address (or `PXLS_COOKIE_SECURE=true`) so the session cookie is marked `Secure`.
- Each webhook has its own secret. Treat webhook URLs that contain `?secret=` like passwords, since they can appear in sender and proxy logs.
- The Pixoo hardware is controlled over Bluetooth by the host, so the API can drive a physical device. Do not expose port 3030 to the internet without TLS in front.
- Webhook image downloads refuse private and loopback addresses by default. Enabling `PXLS_ALLOW_PRIVATE_URLS` lets a webhook sender make the server fetch images from your LAN.
