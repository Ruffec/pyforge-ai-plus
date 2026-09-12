#!/usr/bin/env bash
set -e

echo "🛠️  PyForge AI dev container setup"

# Install Node.js dependencies
echo "Installing npm dependencies..."
npm install

# Install Rust pre-commit hook formatting helper (cargo fmt is usually enough)
echo "Checking Rust toolchain..."
rustc --version
cargo --version

# Ensure Tauri CLI is available
echo "Checking Tauri CLI..."
if ! command -v cargo-tauri &> /dev/null; then
    echo "Installing Tauri CLI..."
    cargo install tauri-cli --locked
fi

cargo tauri --version

echo "✅ Dev container ready. Run 'npm run tauri:dev' to start the app."
