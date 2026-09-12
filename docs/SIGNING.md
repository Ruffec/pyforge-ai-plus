# PyForge AI 代码签名指南

本指南说明如何为 PyForge AI（Tauri 2.0 + Rust + React）在 Windows、macOS 与 Linux 上执行代码签名与公证，以满足企业分发、Gatekeeper / SmartScreen 信任和自动更新校验的要求。

> **安全提示**：所有证书、私钥、密码、Token 均**禁止硬编码**到代码或配置文件中。生产环境请通过 GitHub Actions Secrets、操作系统密钥管理工具或 HSM 注入。

---

## 目录

1. [Tauri 签名环境变量总览](#tauri-签名环境变量总览)
2. [Windows 代码签名](#windows-代码签名)
3. [macOS 代码签名](#macos-代码签名)
4. [Linux GPG 签名](#linux-gpg-签名)
5. [GitHub Actions Secrets 配置清单](#github-actions-secrets-配置清单)
6. [本地手动签名脚本](#本地手动签名脚本)
7. [常见问题](#常见问题)

---

## Tauri 签名环境变量总览

| 环境变量 | 适用平台 | 说明 |
| --- | --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | 全平台 | Tauri 自动更新签名私钥（minisign）的 Base64 或文件路径。 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 全平台 | 上述私钥的密码（如有）。 |
| `WINDOWS_CERTIFICATE` | Windows | `.pfx` 代码签名证书的 Base64 内容。 |
| `WINDOWS_CERTIFICATE_PASSWORD` | Windows | `.pfx` 证书导出/使用密码。 |
| `WINDOWS_CERTIFICATE_PATH` | Windows | `.pfx` 证书文件路径（若不用 Base64 内容，可改用路径）。 |
| `AZURE_KEY_VAULT_URI` | Windows | Azure Key Vault 的 Vault URI，用于云端 HSM 签名。 |
| `AZURE_KEY_VAULT_CLIENT_ID` | Windows | Azure AD 应用客户端 ID。 |
| `AZURE_KEY_VAULT_CLIENT_SECRET` | Windows | Azure AD 应用客户端密钥。 |
| `AZURE_KEY_VAULT_KEY_ID` | Windows | Key Vault 中代码签名密钥名称/版本。 |
| `APPLE_CERTIFICATE` | macOS | Apple Developer ID Application 证书（`.p12`）的 Base64 内容。 |
| `APPLE_CERTIFICATE_PASSWORD` | macOS | `.p12` 证书密码。 |
| `APPLE_ID` | macOS | 用于公证的 Apple ID（邮箱）。 |
| `APPLE_PASSWORD` | macOS | Apple ID 的**应用专用密码**（非登录密码）。 |
| `APPLE_TEAM_ID` | macOS | Apple Developer Team ID，如 `ABCD123456`。 |
| `APPLE_SIGNING_IDENTITY` | macOS | 本地 `codesign` 使用的身份描述，如 `Developer ID Application: Your Name (ABCD123456)`。 |
| `GPG_PRIVATE_KEY` | Linux | 用于 `.AppImage` / `.deb` / `.rpm` 签名的 GPG 私钥（ASCII-armored）。 |
| `GPG_PASSPHRASE` | Linux | GPG 私钥密码。 |

> 在 Tauri CLI / `tauri-action` 中，Windows 与 macOS 签名会在构建打包时自动触发，前提是上述环境变量已正确设置。

---

## Windows 代码签名

### 证书类型：标准证书 vs EV 证书

| 类型 | 获取难度 | SmartScreen 声誉 | 适用场景 |
| --- | --- | --- | --- |
| **标准代码签名证书**（OV） | 较低，个人/企业均可申请 | 需要累积声誉，初期仍可能提示 | 个人开发者、小型团队 |
| **EV 代码签名证书** | 较高，需企业资质与硬件 Token | 立即获得 Microsoft SmartScreen 信任 | 企业分发、消除拦截 |

- 2023 年 6 月 1 日后新签发的 OV 证书通常需要配合硬件 Token 或云签名服务，请遵循证书颁发机构（CA）提供的文档。
- EV 证书几乎可立即消除 SmartScreen；标准证书可能需要多次下载/提交积累声誉。

### 使用 signtool 本地签名

1. 将证书与私钥合并为 `.pfx`：

   ```powershell
   openssl pkcs12 -export -in cert.cer -inkey private.key -out certificate.pfx
   ```

2. 设置环境变量并调用仓库脚本：

   ```powershell
   $env:WINDOWS_CERTIFICATE = [Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\certs\certificate.pfx"))
   $env:WINDOWS_CERTIFICATE_PASSWORD = "your-pfx-password"
   .\scripts\sign-windows.ps1 .\src-tauri\target\release\bundle\nsis\PyForge_AI_*_x64-setup.exe
   ```

3. 验证签名：

   ```powershell
   signtool verify /pa /v .\src-tauri\target\release\bundle\nsis\PyForge_AI_*_x64-setup.exe
   ```

### Azure Key Vault 云端签名

如果证书与私钥托管在 Azure Key Vault（推荐企业 HSM 场景），请配置以下环境变量：

```powershell
$env:AZURE_KEY_VAULT_URI       = "https://<your-vault>.vault.azure.net/"
$env:AZURE_KEY_VAULT_CLIENT_ID = "<YOUR_CLIENT_ID>"
$env:AZURE_KEY_VAULT_CLIENT_SECRET = "<YOUR_CLIENT_SECRET>"
$env:AZURE_KEY_VAULT_KEY_ID    = "<YOUR_KEY_NAME>"
```

并在 `src-tauri/tauri.conf.json` 的 `bundle.windows` 中配置自定义签名命令（示例）：

```json
{
  "bundle": {
    "windows": {
      "signCommand": "az sign --file-path %1 --key-vault-url %AZURE_KEY_VAULT_URI% --key-name %AZURE_KEY_VAULT_KEY_ID%"
    }
  }
}
```

> 实际 `signCommand` 需替换为 CA 或 Azure 提供的官方签名 CLI（如 DigiCert Keylocker、Azure Code Signing 等）。

### GitHub Actions 配置

将以下 Secrets 添加到仓库：

- `WINDOWS_CERTIFICATE`：`.pfx` 文件 Base64。
- `WINDOWS_CERTIFICATE_PASSWORD`：`.pfx` 密码。

Base64 编码命令：

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\certs\certificate.pfx")) | Set-Clipboard
```

CI 中的导入与签名由 `.github/workflows/release.yml` 自动处理，详见该文件。

---

## macOS 代码签名

### 准备 Developer ID Application 证书

1. 加入 [Apple Developer Program](https://developer.apple.com/)。
2. 在 Apple Developer Portal 创建 **Developer ID Application** 证书，或使用 Xcode 的「Manage Certificates」生成。
3. 导出为 `.p12`，并记录导出密码。
4. 获取 **Team ID**：在 [Membership](https://developer.apple.com/account) 页面查看，如 `ABCD123456`。
5. 为 Apple ID 生成**应用专用密码**（[appleid.apple.com](https://appleid.apple.com) → 安全 → App 专用密码）。

### 配置环境变量

```bash
export APPLE_CERTIFICATE=$(base64 -i /path/to/certificate.p12)
export APPLE_CERTIFICATE_PASSWORD="your-p12-password"
export APPLE_ID="your-apple-id@example.com"
export APPLE_PASSWORD="abcd-efgh-ijkl-mnop"   # 应用专用密码
export APPLE_TEAM_ID="ABCD123456"
```

### 签名与公证流程

1. Tauri 构建时自动完成 `codesign`（需环境变量已设置）。
2. 构建完成后对 `.dmg` 或 `.zip` 执行公证：

   ```bash
   xcrun notarytool submit \
     src-tauri/target/release/bundle/dmg/PyForge_AI_<version>_x64.dmg \
     --apple-id "$APPLE_ID" \
     --password "$APPLE_PASSWORD" \
     --team-id "$APPLE_TEAM_ID" \
     --wait
   ```

3. 公证通过后装订票据（staple）：

   ```bash
   xcrun stapler staple src-tauri/target/release/bundle/dmg/PyForge_AI_<version>_x64.dmg
   ```

4. 验证：

   ```bash
   codesign -vv --deep-verify src-tauri/target/release/bundle/macos/PyForge_AI.app
   xcrun stapler validate src-tauri/target/release/bundle/dmg/PyForge_AI_<version>_x64.dmg
   ```

### Provisioning Profile（如需要）

PyForge AI 当前不依赖沙箱或特殊 Apple 能力，通常无需 Provisioning Profile。若后续启用 iCloud、Push 等能力，请按 Apple 文档创建并嵌入 `embedded.provisionprofile`：

```bash
cp /path/to/embedded.provisionprofile src-tauri/target/release/bundle/macos/PyForge_AI.app/Contents/embedded.provisionprofile
```

---

## Linux GPG 签名

Linux 分发通常不要求强制签名，但为仓库分发和用户信任，建议对 `.AppImage`、`.deb`、`.rpm` 进行 GPG  detached sign。

### 环境变量

```bash
export GPG_PRIVATE_KEY="$(cat /path/to/private.key)"
export GPG_PASSPHRASE="your-passphrase"
```

### 签名示例

```bash
for f in src-tauri/target/release/bundle/*.{AppImage,deb,rpm}; do
  [ -e "$f" ] || continue
  gpg --batch --yes --armor --detach-sign \
      --passphrase "$GPG_PASSPHRASE" --pinentry-mode loopback "$f"
done
```

验证：

```bash
gpg --verify PyForge_AI_<version>_amd64.AppImage.asc PyForge_AI_<version>_amd64.AppImage
```

---

## GitHub Actions Secrets 配置清单

| Secret | 是否必需 | 说明 |
| --- | --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | 推荐 | 自动更新签名私钥。 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 条件 | 私钥密码。 |
| `WINDOWS_CERTIFICATE` | Windows 签名 | `.pfx` Base64。 |
| `WINDOWS_CERTIFICATE_PASSWORD` | Windows 签名 | `.pfx` 密码。 |
| `APPLE_CERTIFICATE` | macOS 签名 | `.p12` Base64。 |
| `APPLE_CERTIFICATE_PASSWORD` | macOS 签名 | `.p12` 密码。 |
| `APPLE_ID` | macOS 公证 | Apple ID。 |
| `APPLE_PASSWORD` | macOS 公证 | 应用专用密码。 |
| `APPLE_TEAM_ID` | macOS 公证 | Team ID。 |
| `GPG_PRIVATE_KEY` | Linux 可选签名 | ASCII-armored 私钥。 |
| `GPG_PASSPHRASE` | Linux 可选签名 | 私钥密码。 |

---

## 本地手动签名脚本

- Windows：`scripts/sign-windows.ps1`
- macOS：`scripts/sign-macos.sh`

两者均**只从环境变量读取密钥/证书**，不会硬编码任何凭据。用法见脚本头部注释。

---

## 常见问题

### Q1: Windows 签名后 SmartScreen 仍然提示？

A: 标准 OV 证书需要时间积累声誉。可提交文件到 [Microsoft 恶意软件分析中心](https://www.microsoft.com/en-us/wdsi/filesubmission) 申请人工审核，或改用 EV 证书。

### Q2: macOS 公证失败，提示「Unable to validate your application」？

A: 检查 `APPLE_ID` 是否为应用专用密码；确认 `APPLE_TEAM_ID` 正确；确认 `.app` 已完成有效的 `codesign`（含 `--options runtime`）。

### Q3: Linux GPG 签名时提示私钥未找到？

A: 先执行 `gpg --list-secret-keys` 确认私钥已导入；若使用 CI，请检查 `GPG_PRIVATE_KEY` 是否为 ASCII-armored 格式（以 `-----BEGIN PGP PRIVATE KEY BLOCK-----` 开头）。

### Q4: Tauri 自动更新签名与平台代码签名有什么区别？

A: 平台代码签名（Windows/macOS/Linux）向操作系统证明应用来源可信；Tauri 自动更新签名（`TAURI_SIGNING_PRIVATE_KEY`）用于校验下载的更新包完整性，防止中间人篡改。两者互补，建议同时启用。
