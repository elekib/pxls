# syntax=docker/dockerfile:1

# ---- Dependency planner ----
# cargo-chef splits dependency compilation from our own code, so the slow part
# lives in a normal Docker layer. Unlike cache mounts, layers are exported by
# the GitHub Actions cache, so CI only recompiles dependencies when
# Cargo.toml or Cargo.lock change.
FROM lukemathwalker/cargo-chef:latest-rust-1.88-slim-bookworm AS chef
WORKDIR /app

FROM chef AS planner
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo chef prepare --recipe-path recipe.json

# ---- Build stage ----
FROM chef AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    libbluetooth-dev \
    libssl-dev \
    libdbus-1-dev \
    && rm -rf /var/lib/apt/lists/*

# Build dependencies only. This layer is reused until the dependency set changes.
COPY --from=planner /app/recipe.json recipe.json
RUN cargo chef cook --release --locked --recipe-path recipe.json

# Version info baked into the binary and reported by /api/health
ARG VERSION=dev
ARG GIT_SHA=unknown
ENV PXLS_VERSION=${VERSION} PXLS_GIT_SHA=${GIT_SHA}

COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release --locked \
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
