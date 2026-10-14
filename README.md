# PyForge AI — 跨平台 Python 生态环境管理工具

[![Release](https://img.shields.io/github/v/release/Ruffec/pyforge-ai-plus?style=flat-square&logo=github)](https://github.com/Ruffec/pyforge-ai-plus/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square)](#分环境安装与配置)

> 企业级 Python 生态环境一站式管理桌面应用，基于 **Tauri 2.0 + Rust + React** 构建。

---

## 项目背景与定位

PyForge AI 是一款面向 Windows、macOS 与 Linux 的跨平台桌面工具，帮助开发团队与独立开发者统一管理 Python 版本、虚拟环境、包依赖与镜像源，并通过 AI 能力实现智能化的项目部署与依赖冲突分析。

**为什么选择 PyForge AI：**

- **轻量高效**：相比传统 Electron 方案，采用 Rust + Tauri 2.0 架构，显著降低安装包体积与运行时内存占用。
- **全流程覆盖**：从 Python 多版本安装/卸载、虚拟环境生命周期、包依赖管理到 AI 部署方案生成，单一应用完成全部工作。
- **双端同构**：桌面端与浏览器端共享同一套业务能力——桌面窗口走 Tauri IPC，浏览器走内置 HTTP 桥接（axum），页面代码零感知。
- **企业可运维**：结构化日志、按大小轮转、日志目录迁移、系统盘写入监控与违规审计导出，开箱即用。
- **非系统盘优先**：所有运行期数据（配置、日志、缓存、虚拟环境）默认写入非系统盘存储根，杜绝污染 C 盘。

## 核心功能特性

| 模块 | 能力 |
| --- | --- |
| **Python 版本管理** | 本地多版本自动扫描（PEP 514 / PATH / pyenv）、一键下载安装（自定义路径支持中文与特殊字符）、彻底卸载（MSI 七类残留全量清扫）、默认版本切换 |
| **虚拟环境管理** | venv 一键创建、克隆、删除、导出依赖树，支持自定义根目录 |
| **包与镜像源管理** | 已安装包清单、镜像源延迟测速与自动排序、批量安装与升级 |
| **AI 智能部署** | 自然语言生成部署方案、多服务商接入（OpenAI / DeepSeek / 通义 / Kimi / 智谱 / 本地 LLM）、流式对话、配置热更新 |
| **结构化日志系统** | 企业级文本格式（时间 / 级别 / 模块 / 线程 ID / 全链路 trace ID）、单条 4KB 限长防线、10MB 按大小轮转（序号后缀递增）、日志目录变更自动迁移（跨盘安全） |
| **系统盘写入监控** | 拦截层 + 周期审计双通道，违规事件全字段记录（路径/时间/类型/模块/次数），标准 Excel 审计导出 |
| **双端桥接** | 桌面端内置 HTTP 桥接服务（`/api/rpc` + `/api/events` SSE），浏览器打开同一地址即获得完整功能 |
| **自动更新** | tauri-plugin-updater + GitHub Releases 分发，四平台安装包与更新元数据由 CI 自动构建上传 |
| **安全基线** | Capabilities 最小权限、CSP 白名单、路径校验与命令参数消毒、URL Scheme 白名单 |

## 技术栈

| 层级 | 技术 | 说明 |
| --- | --- | --- |
| 后端核心 | [Tauri 2.0](https://tauri.app/) + [Rust](https://www.rust-lang.org/) | 桌面应用框架与系统级业务逻辑 |
| 日志 | [tracing](https://tracing.rs/) + tracing-appender | 结构化日志、非阻塞写入、按大小轮转 |
| HTTP 桥接 | [axum](https://github.com/tokio-rs/axum) | RPC 转发与 SSE 事件总线 |
| Excel 导出 | [umya-spreadsheet](https://github.com/MathNya/umya-spreadsheet) | 违规审计报告纯 Rust 生成 |
| 前端 UI | [React 18](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) | 组件化界面与类型安全 |
| 样式系统 | [Tailwind CSS 4](https://tailwindcss.com/) | 原子化 CSS 与设计系统变量 |
| 构建工具 | [Vite 6](https://vitejs.dev/) | 前端开发与生产构建 |
| 测试 | [Vitest](https://vitest.dev/) + [Playwright](https://playwright.dev/) + cargo test | 前端单测 / E2E / Rust 单测 |
| 图标 | [Lucide React](https://lucide.dev/) | 统一图标库 |
| 路由 | [React Router v6](https://reactrouter.com/) | 单页应用路由 |
| 进程/文件插件 | Tauri 官方插件（shell / fs / dialog / process / http / updater） | 系统能力封装与权限隔离 |

## 架构概览与数据持久化

```text
┌─────────────────────────── 桌面窗口（WebView） ───────────────────────────┐
│  React 页面 → invokeCommand() 双通道自适应                                  │
│    ├─ Tauri IPC（桌面模式）                                                │
│    └─ fetch → HTTP 桥接 127.0.0.1:21880（浏览器模式）                       │
│         ├─ POST /api/rpc    转发同款 Tauri 命令                             │
│         ├─ GET  /api/events SSE 事件总线                                    │
│         └─ GET  /api/health 健康探针                                       │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   │ Rust 业务层（python / venv / package / ai / logging / write_guard）
                                   ▼
┌────────────────────────── 数据持久化（非系统盘优先） ──────────────────────┐
│  <存储根>/PyForge/pyforge-ai/config.json       应用配置（原子写入 + 深合并）│
│  <日志目录>/pyforge-ai.log[.N]                 结构化日志（10MB 轮转）      │
│  <违规目录>/violations.jsonl                   系统盘写入违规审计          │
│  <违规目录>/pyforge-violations.xlsx            审计报告导出                │
│  业务数据源：本机 Python 安装（实时扫描）· PyPI 镜像（实时拉取）·            │
│             AI 服务商 API（实时调用）——均为真实数据源，无 mock 数据          │
└───────────────────────────────────────────────────────────────────────────┘
```

PyForge AI 是**工具型桌面应用**，没有独立数据库服务：用户业务数据（应用配置、审计记录、日志）以 JSON / JSONL / 文本文件形式持久化到指定存储目录（默认非系统盘存储根，可在设置页自定义），环境与包数据通过实时调用本机 Python 与 PyPI 镜像获取。配置写入采用「写临时文件 + 原子替换」策略，保证断电/崩溃场景下配置文件不损坏。

## 快速上手（10 分钟）

### 环境要求

| 依赖 | 版本 | 说明 |
| --- | --- | --- |
| [Node.js](https://nodejs.org/) | ≥ 18（推荐 LTS） | 前端构建 |
| [Rust](https://www.rust-lang.org/tools/install) | ≥ 1.77 | 后端编译 |
| **Windows** | — | [VC++ Redistributable](https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist) 与 [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)（Win10/11 通常已预装） |
| **macOS** | — | Xcode Command Line Tools（`xcode-select --install`） |
| **Linux** | — | `webkit2gtk-4.1` 等开发库（参考 [Tauri prerequisites](https://tauri.app/start/prerequisites/#linux)） |

### 三步启动

```bash
# 1. 克隆仓库
git clone https://github.com/Ruffec/pyforge-ai-plus.git
cd pyforge-ai-plus

# 2. 安装 Node 依赖（Rust 依赖在首次运行时自动拉取）
npm install

# 3. 启动开发模式（Vite dev server + Tauri 桌面窗口）
npm run tauri:dev
```

开发服务器固定使用 `http://localhost:1420`（`strictPort`，端口冲突时立即报错）。

### 仅浏览器模式（无 Rust 工具链时体验前端）

```bash
npm install
npm run dev        # 打开 http://localhost:1420
# 桌面应用运行时，浏览器访问 http://127.0.0.1:21880 同样可获得完整功能（HTTP 桥接）
```

## 分环境安装与配置

### 开发环境

```bash
npm run tauri:dev          # 桌面开发模式（前端热更新 + Rust 增量编译）
npm run dev                # 仅前端（浏览器模式，配合运行中的桌面应用桥接）
npm run check:env          # 环境自检（Node/Rust/平台依赖核对）
```

Rust 增量编译加速（可选）：在 `Cargo.toml` 同级配置共享 `target` 目录或使用 `sccache`。

### 测试环境

```bash
npm run test               # Vitest 前端单元测试
npm run test:coverage      # 覆盖率报告
npm run test:e2e           # Playwright E2E（需先构建 Tauri 二进制）
cargo test --manifest-path src-tauri/Cargo.toml     # Rust 全量单元测试
cargo test --manifest-path src-tauri/Cargo.toml python::   # 指定模块
```

### 生产构建

```bash
# 前端生产构建（输出 dist/，Tauri 打包时引用）
npm run build

# 当前平台安装包（产物位于 src-tauri/target/release/bundle/）
npm run tauri:build
```

- **Windows**：`.exe` 与 NSIS 安装程序；代码签名参考 [Tauri 签名文档](https://tauri.app/distribute/sign/windows/)。
- **macOS**：`.dmg` / `.app`；Developer ID `codesign` + `notarytool` 公证。
- **Linux**：`.AppImage` / `.deb` / `.rpm`。

### 版本发布（CI 自动构建）

项目通过 GitHub Actions（tauri-action）实现四平台自动发布：

```bash
# 1. 同步更新版本号（package.json / src-tauri/tauri.conf.json / src-tauri/Cargo.toml 三处一致）
# 2. 提交变更后打 tag 并推送——tag 触发 CI 构建 Windows / macOS(Intel+ARM) / Linux
#    安装包 + 更新签名（.sig）+ latest.json 自动更新元数据，并创建 GitHub Release
git tag vX.Y.Z
git push origin vX.Y.Z
```

自动更新端点：`https://github.com/Ruffec/pyforge-ai-plus/releases/latest/download/latest.json`。签名密钥通过 GitHub Secrets（`TAURI_SIGNING_PRIVATE_KEY`）注入，本地密钥生成命令：

```bash
npm run generate:updater-keys
```

## 核心功能使用示例

### 前端调用后端命令（IPC / 桥接自适应）

```typescript
// src/lib/tauri-api.ts 封装了全部命令，前端页面无需感知调用通道
import { scanPythonVersions, invokeCommand, logToFrontend } from "@/lib/tauri-api";

// 扫描本机 Python 版本（桌面走 IPC，浏览器自动走 HTTP 桥接）
const versions = await scanPythonVersions(false);
console.log(versions.map((v) => `${v.version} @ ${v.path}`));

// 通用命令调用：更新应用配置（部分补丁，逐节浅合并）
await invokeCommand("update_app_config", {
  patch: { logging: { max_file_size_mb: 10 } },
});

// 前端业务埋点（写入统一结构化日志文件，双端共用）
await logToFrontend("info", "用户导出了违规审计报告", "pyforge_ai::frontend");
```

### 新增一个 Tauri 命令（Rust → 前端全链路）

```rust
// 1. src-tauri/src/main.rs —— 实现并注册命令
#[tauri::command]
fn get_app_info() -> AppResult<serde_json::Value> {
    Ok(serde_json::json!({ "name": env!("CARGO_PKG_NAME") }))
}
// 2. 在 invoke_handler! 宏列表中注册 get_app_info
```

```typescript
// 3. src/lib/tauri-api.ts —— 封装前端调用
export const getAppInfo = () =>
  invokeCommand<{ name: string }>("get_app_info", {});
// 4. 涉及新系统能力时，在 src-tauri/capabilities/default.json 声明权限
```

### 读取结构化日志

```rust
// 后端任意模块：直接使用 tracing 宏，自动携带时间/级别/模块/线程/trace ID
tracing::info!(target: "pyforge_ai::python", "扫描完成: {} 个版本", versions.len());
tracing::error!(target: "pyforge_ai::frontend", module = module.as_str(), "{message}");
```

输出示例（`pyforge-ai.log`，单行超 4096 字符自动截断并携带标记）：

```text
2026-10-14 15:25:50 [INFO] [pyforge_ai::python] [thread-1] [a10c638c-90139ddc-000033ec-6fec51cf] 扫描完成: 4 个版本
```

### 系统盘违规审计

```bash
# 桥接运行时可直接通过 HTTP 调用（与桌面 IPC 同款命令）
curl http://127.0.0.1:21880/api/health
curl -X POST -H "Content-Type: application/json" \
  -d '{"command":"export_violations_excel","args":{}}' \
  http://127.0.0.1:21880/api/rpc
```

## 项目目录结构

```text
pyforge-ai-plus/
├── src/                              # 前端源码（React + TypeScript）
│   ├── App.tsx                       # 根组件与路由注册
│   ├── main.tsx                      # React 入口
│   ├── index.css                     # 全局样式与设计系统变量
│   ├── components/
│   │   ├── layout/                   # AppShell / SidebarNav / TopBar / BridgeBanner
│   │   ├── python/                   # Python 版本列表、安装/卸载进度组件
│   │   ├── settings/                 # 设置页分区组件
│   │   └── ui/                       # 基础组件（Button / Card / Dialog / Tabs / Pagination 等）
│   ├── hooks/                        # useTheme / useScrollbarAutoHide 等
│   ├── lib/
│   │   ├── tauri-api.ts              # IPC/桥接双通道调用封装（前后端唯一接口层）
│   │   ├── tauri-api.test.ts         # 接口层单元测试
│   │   ├── mirror-registry.ts        # PyPI 镜像源注册表
│   │   ├── custom-models.ts          # AI 自定义模型配置
│   │   └── user-log.ts               # 前端日志埋点
│   ├── pages/                        # 页面级组件（Dashboard / PythonVersions / Environments /
│   │                                 #   Packages / Projects / AiDeploy / Settings）及测试
│   ├── store/                        # 跨页面共享状态
│   ├── test/                         # Vitest 测试配置
│   └── types/                        # TypeScript 类型定义
├── src-tauri/                        # Rust + Tauri 后端
│   ├── src/
│   │   ├── main.rs                   # 命令注册、Tauri Builder、应用初始化
│   │   ├── bridge.rs                 # HTTP 桥接（axum）：/api/rpc、/api/events、/api/health
│   │   ├── config.rs                 # 应用配置：加载/持久化/深合并/默认值迁移
│   │   ├── logging.rs                # 结构化日志：企业格式、限长、轮转、目录迁移
│   │   ├── write_guard.rs            # 系统盘写入监控、违规记录、Excel 导出
│   │   ├── paths.rs                  # 平台路径规则（非系统盘优先）
│   │   ├── events.rs                 # 事件总线与任务管理
│   │   ├── error.rs                  # 统一错误类型（AppError / ErrorCode）
│   │   ├── security.rs               # 路径校验、URL 校验、参数消毒
│   │   ├── platform/                 # 平台适配器（Windows / macOS / Linux 差异化）
│   │   ├── python/                   # Python 扫描 / 安装（installer）/ 卸载残留清理（msi_residue）
│   │   ├── venv/                     # 虚拟环境操作
│   │   ├── package/                  # 包管理与镜像源测速
│   │   └── ai/                       # AI 服务商接入与流式对话
│   ├── capabilities/default.json     # 前端权限声明（Capabilities）
│   ├── tauri.conf.json               # Tauri 应用配置（含 updater 配置）
│   └── Cargo.toml                    # Rust 依赖清单
├── e2e/                              # Playwright E2E 测试
├── scripts/                          # 环境自检、更新密钥生成等脚本
├── .github/workflows/                # CI（tag 触发四平台构建与 Release 发布）
├── eslint.config.js                  # ESLint 规则（含 no-console 日志防线）
├── vitest.config.ts                  # 前端单测配置
├── CHANGELOG.md                      # 版本变更日志（Keep a Changelog 规范）
├── LICENSE                           # MIT 许可证
└── README.md
```

## 安全

- **Content-Security-Policy (CSP)**：`tauri.conf.json` 中已配置 CSP，限制脚本、样式与网络连接来源。
- **Capabilities 权限模型**：前端仅能通过声明式权限访问后端命令，`src-tauri/capabilities/default.json` 明确列出允许的 shell 命令、文件路径、HTTP 域名与对话框操作。
- **路径校验**：`src-tauri/src/security.rs` 提供路径校验与参数消毒，防止目录穿越与非法命令注入。
- **日志防线**：单条日志 4096 字符限长（UTF-8 安全截断），前端调试性 `console` 输出被 ESLint `no-console` 规则拦截，详见《docs/2026-10-14-日志输出检查规范与清理流程.md》。
- **系统盘保护**：写入拦截层 + 周期审计双通道，任何模块向系统盘写入立即记录并可导出审计报告。
- **最小权限原则**：默认不开启 `dangerousDisableAssetCspModification`；插件按需启用。

## 贡献指南

欢迎提交 Issue 与 Pull Request。为保证质量与可追溯性，请遵循以下流程：

1. **Fork & Branch**：从 `master` 切出功能分支，命名建议 `feature/<short-desc>` 或 `fix/<issue-id>`。
2. **代码规范**：前端遵循 ESLint + Prettier（`npm run lint` / `npm run format`）；Rust 遵循 `cargo fmt` 与 `cargo clippy -- -D warnings`。
3. **提交信息**：使用 [Conventional Commits](https://www.conventionalcommits.org/) 风格，例如 `feat(logging): 新增单条日志限长防线`。
4. **测试要求**：新增功能必须补充对应单元测试（Vitest / cargo test），涉及用户流程的变更建议补充 E2E 用例；提交前确保全部门禁通过：
   ```bash
   npm run typecheck && npm run lint && npm run test
   cargo test --manifest-path src-tauri/Cargo.toml --no-default-features
   ```
5. **日志规范**：业务日志一律走 `tracing` 宏（后端）或 `logToFrontend` 埋点（前端），禁止调试性 `println!` / `console.log` 残留。
6. **文档同步**：修改公开 API、构建流程或目录结构时，同步更新 `README.md` 与 `CHANGELOG.md`。
7. **PR 审查**：确保 CI 通过、无敏感信息泄露（密钥/证书/私有路径）、Capabilities 权限最小化。

## 许可证

本项目基于 [MIT License](./LICENSE) 开源发布。

Copyright (c) 2026 PyForge AI Contributors
