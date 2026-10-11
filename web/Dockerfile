# syntax=docker/dockerfile:1
# pxls: single Next.js app (UI, API and display engine in one process).

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim

ARG VERSION=dev
ARG GIT_SHA=unknown

LABEL org.opencontainers.image.title="pxls" \
      org.opencontainers.image.description="Dashboard for legacy Divoom Pixoo Bluetooth displays" \
      org.opencontainers.image.source="https://github.com/elekib/pxls" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${GIT_SHA}"

# bluez provides `rfcomm`, which binds the display to /dev/rfcommN.
RUN apt-get update && apt-get install -y --no-install-recommends bluez curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3030 \
    PXLS_DATA_DIR=/app/data \
    PXLS_VERSION=${VERSION} \
    PXLS_GIT_SHA=${GIT_SHA}

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/peer.cjs ./peer.cjs

EXPOSE 3030
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
    CMD curl -fsS "http://127.0.0.1:${PORT}/api/health" || exit 1
# peer.cjs records the real client address for lockout. node:sqlite is stable
# in practice on the pinned Node 22 image; hide its "experimental" notice.
CMD ["node", "--require", "./peer.cjs", "--disable-warning=ExperimentalWarning", "server.js"]
