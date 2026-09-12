# Dev Container for PyForge AI (Tauri 2.0 + React + Rust)
# Provides a consistent Linux environment with all toolchains for local development
# and CI parity. Windows/macOS native builds still require their respective SDKs.

FROM mcr.microsoft.com/devcontainers/typescript-node:1-22-bookworm

# Install Tauri Linux dependencies
# https://tauri.app/start/prerequisites/#linux
RUN apt-get update && apt-get install -y \
    libwebkit2gtk-4.1-dev \
    build-essential \
    curl \
    wget \
    file \
    libxdo-dev \
    libssl-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    pkg-config \
    cmake \
    git \
    && rm -rf /var/lib/apt/lists/*

# Ensure Rust is available (Dev Containers Rust feature usually installs it; this is a fallback)
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH

RUN if ! command -v rustc &> /dev/null; then \
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable; \
    fi

# Install Tauri CLI globally via cargo
RUN cargo install tauri-cli --locked

# Verify versions
RUN rustc --version && cargo --version && node --version && npm --version
