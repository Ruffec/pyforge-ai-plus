# PyForge AI 自动更新（Updater）配置说明

本目录存放 Tauri 自动更新相关的密钥与说明文件。

> ⚠️ **安全提醒**：私钥文件（`*.key`、`.env` 等）**永远不要提交到 Git 仓库**。已配置在 `.gitignore` 中，请保持这一约定。

---

## 1. 生成 Ed25519 密钥对

Tauri 使用与 minisign 兼容的 Ed25519 密钥对签名更新包。使用 Tauri CLI 生成：

```bash
cargo tauri signer generate
```

执行后会提示输入私钥密码（password）。完成后默认输出：

- `src-tauri/updater/pyforge-ai.pub` — 公钥，用于 `tauri.conf.json` 的 `pubkey` 字段。
- `src-tauri/updater/pyforge-ai.key` — 私钥，**不要提交**。

### 指定输出路径

```bash
cargo tauri signer generate --path src-tauri/updater/pyforge-ai
```

这会产生：

- `src-tauri/updater/pyforge-ai.pub`
- `src-tauri/updater/pyforge-ai.key`

> 如果当前环境没有安装 MSVC/GCC，无法直接运行 `cargo tauri signer generate`，请在已安装 Rust/Cargo 且具备 C 编译器的机器上执行，或使用项目提供的脚本。

### 使用项目脚本快速生成（推荐）

- **Linux / macOS**：`./scripts/generate-updater-key.sh`
- **Windows PowerShell**：`.\scripts\generate-updater-key.ps1`

脚本会调用 `cargo tauri signer generate` 并将密钥输出到 `src-tauri/updater/` 目录。

---

## 2. 配置公钥

将 `pyforge-ai.pub` 文件中的内容复制到 `src-tauri/tauri.conf.json`：

```json
{
  "plugins": {
    "updater": {
      "active": true,
      "dialog": true,
      "pubkey": "<这里粘贴公钥 base64 字符串>",
      "endpoints": [
        "https://example.com/pyforge-ai-updates.json"
      ]
    }
  }
}
```

当前配置使用的是占位符 URL，正式发布前请替换为实际的更新服务器地址。

---

## 3. 设置签名环境变量

构建/打包时，Tauri CLI 需要读取私钥才能对安装包签名。请设置以下环境变量：

```bash
export TAURI_SIGNING_PRIVATE_KEY="<私钥 base64 字符串>"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="<生成密钥时设置的密码>"
```

### 本地开发

可以在项目根目录创建 `.env` 文件：

```env
TAURI_SIGNING_PRIVATE_KEY=<私钥 base64 字符串>
TAURI_SIGNING_PRIVATE_KEY_PASSWORD=<密码>
```

> `.env` 已加入 `.gitignore`，不会被提交。

### CI / GitHub Actions

在仓库的 **Settings > Secrets and variables > Actions** 中添加：

- `TAURI_SIGNING_PRIVATE_KEY`：私钥 base64 字符串
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：私钥密码

工作流中通过 `${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}` 读取。参见 `.github/workflows/release.yml`。

---

## 4. 更新服务器 JSON 格式

Tauri updater 期望从 `endpoints` 地址返回如下 JSON：

```json
{
  "version": "1.0.1",
  "notes": "修复若干问题并优化性能",
  "pub_date": "2026-08-11T00:00:00Z",
  "signature": "<BASE64_MINISIGN_SIGNATURE>",
  "url": "https://example.com/download/PyForge_AI_1.0.1_x64-setup.exe"
}
```

字段说明：

| 字段 | 说明 |
| --- | --- |
| `version` | 新版本号，必须大于当前版本 |
| `notes` | 更新说明，支持 Markdown |
| `pub_date` | ISO 8601 格式的发布日期 |
| `signature` | 安装包的 minisign/base64 签名 |
| `url` | 安装包下载地址 |

更完整的示例见 `docs/assets/updater-example.json`。

---

## 5. 参考文档

- [Tauri Updater 官方文档](https://tauri.app/plugin/updater/)
- [Tauri Signer CLI](https://tauri.app/reference/cli/#signer)
