# syntax=docker/dockerfile:1

# ---- Build stage ----
FROM rust:1.88-slim-bookworm AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    libbluetooth-dev \
    libssl-dev \
    libdbus-1-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Version info baked into the binary and reported by /api/health
ARG VERSION=dev
ARG GIT_SHA=unknown
ENV PXLS_VERSION=${VERSION} PXLS_GIT_SHA=${GIT_SHA}

COPY Cargo.toml Cargo.lock ./
COPY src ./src

# Cache mounts keep downloaded crates and incremental build output between builds
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/app/target \
    cargo build --release --locked \
    && cp target/release/pxls_backend /usr/local/bin/pxls_backend

# ---- Runtime stage ----
FROM debian:bookworm-slim

ARG VERSION=dev
ARG GIT_SHA=unknown

LABEL org.opencontainers.image.title="pxls-backend" \
      org.opencontainers.image.description="Backend for pxls, a dashboard for legacy Divoom Pixoo Bluetooth displays" \
      org.opencontainers.image.source="https://github.com/elekib/pxls" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${GIT_SHA}"

RUN apt-get update && apt-get install -y --no-install-recommends \
    libbluetooth3 \
    libdbus-1-3 \
    libssl3 \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /usr/local/bin/pxls_backend /usr/local/bin/pxls_backend

# Runs as root for now: Bluetooth sockets and the root-owned data volume need
# verifying on a real device before dropping privileges.
EXPOSE 3400

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://127.0.0.1:3400/api/health || exit 1

CMD ["pxls_backend"]
