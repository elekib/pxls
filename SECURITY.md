# Security Policy

## Reporting a vulnerability

Please do not open a public issue for security problems.

Report them privately through GitHub: **Security** tab, then **Report a vulnerability** (private security advisory). Include what you found, how to reproduce it, and the version (`/api/health` reports it).

You can expect an acknowledgement within a few days. This is a volunteer project, so fixes are made on a best-effort basis.

## Supported versions

Only the latest release and the `dev` image receive fixes.

## Deployment guidance

- pxls uses user accounts. The first admin is created in the web UI with a one-time setup code printed in the backend log, so a fresh instance cannot be claimed by someone without access to the server. There are no default credentials. Create the admin promptly after first start and keep the log private until you do.
- Passwords are stored as argon2id hashes with a per-user salt (12 character minimum). Sessions are stored server-side and can be revoked at any time; access tokens last 15 minutes, and the refresh token is a rotating `httpOnly`, `SameSite=Strict` cookie. Reuse of a refresh token revokes its session.
- Sign-in is throttled per username and per IP with a temporary lockout, and errors do not reveal whether an account exists. The lockout means an attacker can temporarily block a known username from signing in.
- The JWT signing secret is stored in `data/pxls.db` (or comes from `PXLS_JWT_SECRET`). Anyone who can read the database or that secret can forge access tokens, so keep `data/` private.
- Security events (logins, failures, lockouts, session revocation, user changes) are logged with the target `pxls::security`. Passwords, tokens and the names used in failed sign-ins are never logged.
- Client addresses for throttling and logs come from `X-Real-IP` only when the TCP peer is a loopback or private address. Do not expose port 3400 directly to untrusted networks; put the bundled nginx or another proxy in front.
- Serve pxls over HTTPS if it is reachable beyond your LAN, and forward `X-Forwarded-Proto: https` so the refresh cookie is marked `Secure`.
- Each webhook has its own secret. Treat webhook URLs that contain `?secret=` like passwords, since they can appear in sender and proxy logs.
- The Pixoo hardware is controlled over Bluetooth by the host, so the API can drive a physical device. Do not expose ports 3030 or 3400 to the internet without TLS in front.
- Webhook image downloads refuse private and loopback addresses by default. Enabling `PXLS_ALLOW_PRIVATE_URLS` lets a webhook sender make the server fetch images from your LAN.
