FROM rust:1.88-slim-bookworm

# Install system dependencies for Bluetooth
RUN apt-get update && apt-get install -y \
    pkg-config \
    libbluetooth-dev \
    bluez \
    libssl-dev \
    ca-certificates \
    libdbus-1-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy Cargo files first for better layer caching
COPY Cargo.toml Cargo.lock ./

# Copy source code
COPY src ./src

# Build the application
RUN cargo build --release

# Run the backend API server
CMD ["./target/release/pxls_backend"]
