#Requires -Version 5.1
<#
.SYNOPSIS
    生成 Tauri 自动更新所需的 Ed25519 密钥对。

.OUTPUTS
    - src-tauri\updater\pyforge-ai.pub   公钥（写入 tauri.conf.json 的 pubkey 字段）
    - src-tauri\updater\pyforge-ai.key   私钥（**不要提交到 Git**）
#>

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Resolve-Path (Join-Path $ScriptDir "..")
$UpdaterDir = Join-Path $RootDir "src-tauri\updater"
$KeyPrefix = Join-Path $UpdaterDir "pyforge-ai"

Write-Host "Generating Tauri updater signing key pair..."
Write-Host "Output directory: $UpdaterDir"
Write-Host ""

if (-not (Test-Path $UpdaterDir)) {
    New-Item -ItemType Directory -Path $UpdaterDir -Force | Out-Null
}

$Cargo = Get-Command cargo -ErrorAction SilentlyContinue
if (-not $Cargo) {
    Write-Error "Error: cargo is not installed. Please install Rust first."
    exit 1
}

Set-Location (Join-Path $RootDir "src-tauri")
& cargo tauri signer generate --path "$KeyPrefix"

if ($LASTEXITCODE -ne 0) {
    Write-Error "cargo tauri signer generate failed with exit code $LASTEXITCODE"
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "✅ Public key:  ${KeyPrefix}.pub  (paste into tauri.conf.json plugins.updater.pubkey)"
Write-Host "✅ Private key: ${KeyPrefix}.key  (DO NOT COMMIT)"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Copy the contents of ${KeyPrefix}.pub into src-tauri\tauri.conf.json."
Write-Host "  2. Set the GitHub secret TAURI_SIGNING_PRIVATE_KEY to the contents of ${KeyPrefix}.key."
Write-Host "  3. Set the GitHub secret TAURI_SIGNING_PRIVATE_KEY_PASSWORD if you used one."
