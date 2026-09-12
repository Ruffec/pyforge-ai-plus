#!/bin/bash
# 对 macOS .app 进行 codesign，并对 .dmg 执行 notarytool 公证与 staple。
#
# 用法：
#   ./scripts/sign-macos.sh <app-or-dmg-path> [<dmg-path-for-notarization>]
#
# 依赖环境变量（均只读，不硬编码凭据）：
#   APPLE_SIGNING_IDENTITY      : codesign 身份，如 "Developer ID Application: Your Name (TEAMID)"
#   APPLE_CERTIFICATE           : .p12 证书 Base64 内容（可选，脚本会自动导入临时钥匙串）
#   APPLE_CERTIFICATE_PASSWORD  : .p12 证书密码
#   APPLE_ID                    : Apple ID（用于 notarytool）
#   APPLE_PASSWORD              : Apple ID 应用专用密码（用于 notarytool）
#   APPLE_TEAM_ID               : Apple Developer Team ID

set -euo pipefail

usage() {
    echo "Usage: $0 <app-bundle-or-dmg-path> [<dmg-path-for-notarization>]"
    exit 1
}

if [ $# -lt 1 ]; then
    usage
fi

TARGET="$1"
NOTARIZE_TARGET="${2:-}"

APPLE_SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:-}"
APPLE_CERTIFICATE="${APPLE_CERTIFICATE:-}"
APPLE_CERTIFICATE_PASSWORD="${APPLE_CERTIFICATE_PASSWORD:-}"
APPLE_ID="${APPLE_ID:-}"
APPLE_PASSWORD="${APPLE_PASSWORD:-}"
APPLE_TEAM_ID="${APPLE_TEAM_ID:-}"

KEYCHAIN_PATH=""
CERT_PATH=""

cleanup() {
    if [ -n "$KEYCHAIN_PATH" ] && [ -f "$KEYCHAIN_PATH" ]; then
        security delete-keychain "$KEYCHAIN_PATH" 2>/dev/null || true
    fi
    if [ -n "$CERT_PATH" ] && [ -f "$CERT_PATH" ]; then
        rm -f "$CERT_PATH"
    fi
}
trap cleanup EXIT

import_apple_certificate() {
    if [ -z "$APPLE_CERTIFICATE" ]; then
        return 0
    fi

    echo "正在将 Apple 证书导入临时钥匙串..."
    CERT_PATH="${TMPDIR:-/tmp}/pyforge_apple_cert.p12"
    KEYCHAIN_PATH="${TMPDIR:-/tmp}/pyforge_signing.keychain-db"
    local keychain_password
    keychain_password="$(openssl rand -base64 32)"

    echo "$APPLE_CERTIFICATE" | base64 --decode > "$CERT_PATH"

    security create-keychain -p "$keychain_password" "$KEYCHAIN_PATH" >/dev/null 2>&1 || true
    security set-keychain-settings -lut 21600 "$KEYCHAIN_PATH"
    security unlock-keychain -p "$keychain_password" "$KEYCHAIN_PATH"
    security import "$CERT_PATH" -P "$APPLE_CERTIFICATE_PASSWORD" -A -t cert -f pkcs12 -k "$KEYCHAIN_PATH"
    security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$keychain_password" "$KEYCHAIN_PATH" >/dev/null 2>&1 || true
    security list-keychain -d user -s "$KEYCHAIN_PATH" $(security list-keychains -d user | tr -d '"') >/dev/null

    echo "Apple 证书已导入: $KEYCHAIN_PATH"
}

resolve_signing_identity() {
    if [ -n "$APPLE_SIGNING_IDENTITY" ]; then
        return 0
    fi

    echo "APPLE_SIGNING_IDENTITY 未设置，尝试查找 Developer ID Application 身份..."
    APPLE_SIGNING_IDENTITY="$(security find-identity -v -p codesigning | grep 'Developer ID Application' | head -n1 | sed -E 's/.*"([^"]+)".*/\1/')"

    if [ -z "$APPLE_SIGNING_IDENTITY" ]; then
        echo "ERROR: 未找到可用的 Developer ID Application 签名身份。" >&2
        exit 1
    fi

    echo "使用签名身份: $APPLE_SIGNING_IDENTITY"
}

sign_app() {
    local app="$1"
    if [ ! -d "$app" ]; then
        echo "ERROR: .app 目录不存在: $app" >&2
        exit 1
    fi

    resolve_signing_identity

    echo "正在签名: $app"
    codesign --force --options runtime --deep --sign "$APPLE_SIGNING_IDENTITY" "$app"
    codesign -vv --deep-verify "$app"
    echo "签名验证通过: $app"
}

notarize() {
    local file="$1"
    if [ ! -f "$file" ]; then
        echo "ERROR: 待公证文件不存在: $file" >&2
        exit 1
    fi

    if [ -z "$APPLE_ID" ] || [ -z "$APPLE_PASSWORD" ] || [ -z "$APPLE_TEAM_ID" ]; then
        echo "APPLE_ID / APPLE_PASSWORD / APPLE_TEAM_ID 未设置，跳过公证。"
        return 0
    fi

    echo "正在提交公证: $file"
    xcrun notarytool submit "$file" \
        --apple-id "$APPLE_ID" \
        --password "$APPLE_PASSWORD" \
        --team-id "$APPLE_TEAM_ID" \
        --wait

    echo "正在装订票据: $file"
    xcrun stapler staple "$file"
    xcrun stapler validate "$file"
    echo "公证完成: $file"
}

import_apple_certificate

if [[ "$TARGET" == *.app ]]; then
    sign_app "$TARGET"
    if [ -n "$NOTARIZE_TARGET" ]; then
        notarize "$NOTARIZE_TARGET"
    fi
elif [[ "$TARGET" == *.dmg ]]; then
    notarize "$TARGET"
else
    echo "ERROR: 不支持的文件类型: $TARGET（仅支持 .app 或 .dmg）" >&2
    exit 1
fi

echo "Done."
