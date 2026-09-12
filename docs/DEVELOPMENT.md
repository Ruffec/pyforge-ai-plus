# PyForge AI 开发指南

本文件补充 [README.md](../README.md) 中的开发说明，提供更详细的本地环境搭建、AI API 密钥配置、调试技巧与常见问题排查。

---

## 目录

1. [前置依赖](#前置依赖)
2. [仓库初始化](#仓库初始化)
3. [AI API 密钥环境变量](#ai-api-密钥环境变量)
4. [开发工作流](#开发工作流)
5. [本地调试技巧](#本地调试技巧)
6. [代码规范与 Git Hooks](#代码规范与-git-hooks)
7. [跨平台开发注意事项](#跨平台开发注意事项)
8. [常见问题](#常见问题)

---

## 前置依赖

### 必需

| 工具 | 最低版本 | 用途 |
| --- | --- | --- |
| Node.js | 18.x | 前端构建、npm scripts |
| Rust | 1.77 | Tauri 后端与系统逻辑 |
| npm / pnpm | 随 Node 安装 | 依赖管理 |

### 平台特定

#### Windows

- **MSVC 构建工具**：安装 [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/?q=build+tools) 或完整 Visual Studio，勾选「使用 C++ 的桌面开发」工作负载。
- **WebView2 Runtime**：Windows 10/11 通常已自带；如缺失，可下载 [Evergreen Standalone Installer](https://developer.microsoft.com/microsoft-edge/webview2/)。
- **可选**：安装 `cargo-tauri` CLI 全局可用：

  ```bash
  cargo install tauri-cli --version "^2.0.0"
  ```

#### macOS

- 安装 Xcode Command Line Tools：

  ```bash
  xcode-select --install
  ```

- 如需构建通用二进制，准备 Apple Silicon 与 Intel 两台机器，或使用 CI 交叉编译。

#### Linux

- Debian / Ubuntu：

  ```bash
  sudo apt update
  sudo apt install libwebkit2gtk-4.1-dev libssl-dev libgtk-3-dev libsoup-3.0-dev
  ```

- Fedora / RHEL：

  ```bash
  sudo dnf install webkit2gtk4.1-devel openssl-devel gtk3-devel libsoup3-devel
  ```

- Arch：

  ```bash
  sudo pacman -S webkit2gtk-4.1 openssl gtk3 libsoup3
  ```

---

## 仓库初始化

```bash
# 1. 克隆仓库
git clone <repo-url> pyforge-ai
cd pyforge-ai

# 2. 安装前端依赖
npm install

# 3. 初始化 Git Hooks（husky + lint-staged）
npm run prepare

# 4. 验证 Rust 工具链
cargo --version
rustc --version

# 5. 启动开发模式
npm run tauri:dev
```

首次运行 `tauri:dev` 时，Cargo 会自动下载并编译所有 Rust 依赖，耗时取决于网络与机器性能，请耐心等待。

---

## AI API 密钥环境变量

PyForge AI 的 AI 功能通过后端 `src-tauri/src/ai/mod.rs` 中的 `AiService` 调用 OpenAI 或兼容 API。由于 API Key 属于敏感信息，**禁止硬编码**，请通过环境变量或运行时配置注入。

### 配置字段说明

后端 `AiConfig` 结构体接收以下字段：

```json
{
  "api_provider": "openai",
  "api_key": "sk-xxxxxxxxxxxxxxxxxxxxxxxx",
  "model": "gpt-4o-mini",
  "base_url": "https://api.openai.com/v1",
  "temperature": 0.7,
  "use_local_llm": false
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `api_provider` | 是 | 服务商标识，例如 `openai`、`azure`、`custom` |
| `api_key` | 条件 | 非本地模型时必填 |
| `model` | 是 | 模型名称，例如 `gpt-4o-mini`、`gpt-4o` |
| `base_url` | 否 | 兼容 API 的基础地址；为空时使用 OpenAI 默认地址 |
| `temperature` | 否 | 采样温度，默认 `0.7` |
| `use_local_llm` | 否 | 是否使用本地 LLM，默认 `false` |

### 推荐环境变量

在仓库根目录创建 `.env` 文件（**已加入 `.gitignore`，请勿提交**）：

```bash
# .env
# OpenAI 官方 API
PYFORGE_AI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
PYFORGE_AI_MODEL=gpt-4o-mini
PYFORGE_AI_BASE_URL=https://api.openai.com/v1

# 可选：自定义兼容 API（如 Azure、DeepSeek、硅基流动等）
# PYFORGE_AI_BASE_URL=https://api.example.com/v1
# PYFORGE_AI_MODEL=example-model

# 可选：本地 LLM 模式（需自行准备服务端点）
# PYFORGE_AI_USE_LOCAL_LLM=true
# PYFORGE_AI_BASE_URL=http://localhost:8000/v1
```

> **安全提示**：
> - 永远不要将 `.env` 文件提交到 Git。
> - 生产环境应通过操作系统密钥管理工具（如 Windows Credential Manager、macOS Keychain、Linux Secret Service）或 CI 密钥系统注入 API Key。
> - 当前实现中 `AiConfig` 由前端传入后端；后续演进建议改为后端从安全存储读取，或在前端 UI 中提供「设置 API Key」入口并加密落盘。

### 在 Tauri 命令中读取环境变量

Rust 后端可通过 `std::env::var` 读取环境变量，但注意 Tauri 应用运行时**不会自动加载 `.env` 文件**。开发时可通过以下方式注入：

```bash
# Linux / macOS
export PYFORGE_AI_API_KEY=sk-xxx
npm run tauri:dev

# Windows PowerShell
$env:PYFORGE_AI_API_KEY="sk-xxx"
npm run tauri:dev
```

或在 `src-tauri/src/main.rs` 启动阶段集成 `dotenvy` 以自动加载 `.env`：

```rust
// src-tauri/src/main.rs
#[cfg(debug_assertions)]
fn load_env() {
    if let Err(e) = dotenvy::dotenv() {
        eprintln!(".env 加载失败或不存在: {e}");
    }
}
```

---

## 开发工作流

### 常用命令

```bash
# 前端 dev server（纯浏览器，无 Tauri 窗口）
npm run dev

# Tauri 开发模式（推荐）
npm run tauri:dev

# 前端生产构建
npm run build

# Tauri 打包
npm run tauri:build

# 类型检查
npm run typecheck

# 代码检查与格式化
npm run lint
npm run lint:fix
npm run format
npm run format:check

# Rust 测试
cargo test --manifest-path src-tauri/Cargo.toml

# Rust 检查
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
```

### 分支策略建议

- `main`：稳定分支，仅接受通过 CI 的 PR。
- `develop`：日常集成分支（可选）。
- `feature/<name>`：新功能。
- `fix/<issue-id>`：Bug 修复。
- `docs/<name>`：仅文档变更。

---

## 本地调试技巧

### 在浏览器中预览前端

由于 `tauri-api.ts` 中已做 `isTauri()` 判断，当 `window.__TAURI__` 不存在时会返回 mock 数据，因此可以直接运行：

```bash
npm run dev
```

浏览器打开 `http://localhost:1420` 即可查看界面与 mock 数据。

### 调试 Rust 后端

1. 使用 `npm run tauri:dev` 启动。
2. 在 VS Code 中打开 `src-tauri` 目录，安装 [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer) 扩展。
3. 在 Rust 代码中设置断点，使用「通过 CodeLLDB 调试」或附加到进程。

### 查看 Tauri 日志

```bash
# 开发模式下后端 println! / tracing 日志会输出到启动终端
# 前端 console.log 会输出到 DevTools 控制台
```

在 Tauri 窗口中按 `Ctrl + Shift + I`（Windows/Linux）或 `Cmd + Option + I`（macOS）打开 DevTools。

### 热重载

- 前端代码修改后由 Vite HMR 即时刷新。
- Rust 代码修改后会触发 `cargo` 重新编译，Tauri 会自动重启应用。

---

## 代码规范与 Git Hooks

本项目使用 [husky](https://typicode.github.io/husky/) + [lint-staged](https://github.com/lint-staged/lint-staged) 在提交前自动执行检查。

### lint-staged 配置（摘自 package.json）

```json
{
  "lint-staged": {
    "*.{ts,tsx}": ["prettier --write", "eslint --fix"],
    "*.rs": ["cargo fmt --manifest-path src-tauri/Cargo.toml"]
  }
}
```

### 提交信息规范

采用 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/v1.0.0/)：

```text
feat: 添加 Python 版本扫描缓存
fix: 修复 Windows 下路径解析失败
docs: 更新 README 构建说明
refactor: 重命名 PlatformAdapter 方法
test: 补充 venv 创建单元测试
chore: 升级 tailwindcss 到 4.x
```

---

## 跨平台开发注意事项

### 条件编译

Rust 代码大量依赖 `#[cfg(target_os = "...")]` 进行平台隔离。修改平台相关逻辑时，请检查以下文件：

- `src-tauri/src/platform/windows.rs`
- `src-tauri/src/platform/macos.rs`
- `src-tauri/src/platform/linux.rs`

### 路径处理

- 所有用户传入路径应经过 `security::validate_path` 校验，防止目录穿越。
- Windows 路径含反斜杠，建议统一使用 `std::path::Path` / `PathBuf` 处理，不要手动拼接字符串。

### 子进程调用

子进程能力由 `tauri-plugin-shell` 提供，并受 `capabilities/default.json` 中 `shell:allow-execute` 白名单约束。新增需要调用的命令时，请同步更新该白名单。

### HTTP 请求

后端使用 `reqwest` 进行网络请求；前端如需直接请求外部 API，需在 `tauri.conf.json` 的 CSP `connect-src` 与 `capabilities/default.json` 的 `http:default` 中同时声明域名。

---

## 常见问题

### Q1: `npm run tauri:dev` 长时间卡在 Rust 编译？

A: 首次编译需要下载并编译大量依赖，视网络与机器性能可能需要 5–20 分钟。建议：

- 使用国内镜像加速 Cargo：`$HOME/.cargo/config.toml` 配置 [source.crates-io] replace-with。
- 使用 `cargo build --release` 前先跑 `cargo build` 完成 debug 编译。

### Q2: Windows 提示缺少 WebView2？

A: 下载并安装 [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)。开发机器通常需要 Evergreen Bootstrapper。

### Q3: Linux 编译报错 `webkit2gtk` 找不到？

A: 确认安装的是 `libwebkit2gtk-4.1-dev`（Tauri 2.0 要求 4.1），而非 4.0。

### Q4: AI 功能调用失败？

A: 检查：

1. 是否正确设置 `PYFORGE_AI_API_KEY` 环境变量。
2. `AiConfig` 中的 `api_provider`、`model`、`base_url` 是否匹配服务商。
3. 当前网络是否能访问对应 API 端点。
4. `tauri.conf.json` 的 CSP 是否允许该域名。

### Q5: 前端在浏览器中正常，Tauri 中白屏？

A: 通常是 CSP 限制导致资源加载失败。打开 DevTools 查看 Console 报错，调整 `tauri.conf.json` 中的 CSP 策略；生产环境请保持最严格策略。
