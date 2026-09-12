#!/usr/bin/env bash
set -euo pipefail

# 生成 Tauri 自动更新所需的 Ed25519 密钥对。
# 输出：
#   - src-tauri/updater/pyforge-ai.pub   公钥（写入 tauri.conf.json 的 pubkey 字段）
#   - src-tauri/updater/pyforge-ai.key   私钥（**不要提交到 Git**）

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
UPDATER_DIR="${ROOT_DIR}/src-tauri/updater"
KEY_PREFIX="${UPDATER_DIR}/pyforge-ai"

echo "Generating Tauri updater signing key pair..."
echo "Output directory: ${UPDATER_DIR}"
echo ""

mkdir -p "${UPDATER_DIR}"

if ! command -v cargo >/dev/null 2>&1; then
  echo "Error: cargo is not installed. Please install Rust first." >&2
  exit 1
fi

cd "${ROOT_DIR}/src-tauri"
cargo tauri signer generate --path "${KEY_PREFIX}"

echo ""
echo "✅ Public key:  ${KEY_PREFIX}.pub  (paste into tauri.conf.json plugins.updater.pubkey)"
echo "✅ Private key: ${KEY_PREFIX}.key  (DO NOT COMMIT)"
echo ""
echo "Next steps:"
echo "  1. Copy the contents of ${KEY_PREFIX}.pub into src-tauri/tauri.conf.json."
echo "  2. Set the GitHub secret TAURI_SIGNING_PRIVATE_KEY to the contents of ${KEY_PREFIX}.key."
echo "  3. Set the GitHub secret TAURI_SIGNING_PRIVATE_KEY_PASSWORD if you used one."
