# Security Policy

## Reporting a vulnerability

Please do not open a public issue for security problems.

Report them privately through GitHub: **Security** tab, then **Report a vulnerability** (private security advisory). Include what you found, how to reproduce it, and the version (`/api/health` reports it).

You can expect an acknowledgement within a few days. This is a volunteer project, so fixes are made on a best-effort basis.

## Supported versions

Only the latest release and the `dev` image receive fixes.

## Deployment guidance

- pxls requires an API token (`PXLS_AUTH_TOKEN`) and will not start without one. Use a long random value (`openssl rand -hex 32`).
- Each webhook has its own secret. Treat webhook URLs that contain `?secret=` like passwords, since they can appear in sender and proxy logs.
- The Pixoo hardware is controlled over Bluetooth by the host, so the API can drive a physical device. Do not expose ports 3030 or 3400 to the internet without TLS in front.
- Webhook image downloads refuse private and loopback addresses by default. Enabling `PXLS_ALLOW_PRIVATE_URLS` lets a webhook sender make the server fetch images from your LAN.
