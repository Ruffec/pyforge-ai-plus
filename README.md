# PyForge AI — 跨平台 Python 生态环境管理工具

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen?style=flat-square&logo=github)](#) [![License](https://img.shields.io/badge/license-MIT%20%7C%20Apache--2.0-blue?style=flat-square)](#许可证) [![Version](https://img.shields.io/badge/version-0.1.0-orange?style=flat-square)](#)

> **中文** | 企业级 Python 生态环境一站式管理桌面应用，基于 Tauri 2.0 + Rust + React 构建。

---

## 简介

PyForge AI 是一款面向 Windows、macOS 与 Linux 的跨平台桌面工具，旨在帮助开发团队与独立开发者统一管理 Python 版本、虚拟环境、包依赖与镜像源，并通过 AI 能力实现智能化的项目部署与依赖冲突分析。相比传统 Electron 方案，PyForge AI 采用 Rust + Tauri 2.0 架构，在保持现代 Web 技术栈开发体验的同时，显著降低安装包体积与运行时内存占用。

本项目是 Phase 5.3 文档化阶段的产物，与《[PyForge-AI-技术选型白皮书](./PyForge-AI-技术选型白皮书.md)》配套阅读，可全面了解技术选型依据、性能基准、安全合规与平台自适应设计。

---

## 核心功能

- **Python 版本管理**：自动扫描本地 Python 安装，支持版本切换、默认版本设置与多版本并行管理。
- **虚拟环境管理**：一键创建、克隆、导出、迁移 `venv` 虚拟环境，并可视化查看依赖树。
- **包与镜像源管理**：内置常见 PyPI 镜像源，支持测速、切换与批量安装；可查看已安装包与可更新包。
- **AI 智能部署**：基于自然语言描述生成部署方案，自动推荐 Python 版本、依赖与执行步骤；支持 OpenAI / 兼容 API 的对话流式输出。
- **平台自适应**：运行时自动识别操作系统、Shell 与包管理器，针对 Windows / macOS / Linux 提供差异化行为与路径处理。

---

## 技术栈

| 层级 | 技术 | 说明 |
| --- | --- | --- |
| 后端核心 | [Tauri 2.0](https://tauri.app/) + [Rust](https://www.rust-lang.org/) | 桌面应用框架与系统级业务逻辑 |
| 前端 UI | [React 18](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) | 组件化界面与类型安全 |
| 样式系统 | [Tailwind CSS 4](https://tailwindcss.com/) | 原子化 CSS 与设计系统变量 |
| 构建工具 | [Vite 6](https://vitejs.dev/) | 前端开发与生产构建 |
| 图标 | [Lucide React](https://lucide.dev/) | 统一图标库 |
| 路由 | [React Router v6](https://reactrouter.com/) | 单页应用路由 |
| 进程/文件插件 | Tauri 官方插件（shell / fs / dialog / process / http / updater） | 系统能力封装与权限隔离 |

---

## 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) ≥ 18（推荐 LTS）
- [Rust](https://www.rust-lang.org/tools/install) ≥ 1.77
- **Windows 额外需要**：
  - [Microsoft Visual C++ Redistributable](https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist) 或 Visual Studio 构建工具
  - [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)（Windows 10/11 通常已预装）
- **macOS 额外需要**：Xcode Command Line Tools
- **Linux 额外需要**：`webkit2gtk-4.1` 等开发库（参考 [Tauri Linux 依赖文档](https://tauri.app/start/prerequisites/#linux)）

### 安装依赖

```bash
# 安装 Node 依赖
npm install

# Rust 依赖会在首次运行 tauri dev 时自动拉取
```

### 启动开发模式

```bash
# 同时启动 Vite 前端 dev server 与 Tauri 桌面窗口
npm run tauri:dev
```

开发服务器默认使用 `http://localhost:1420`，详细配置见 `vite.config.ts` 与 `src-tauri/tauri.conf.json`。

---

## 构建

### 前端生产构建

```bash
npm run build
```

输出目录为 `dist/`，由 Tauri 在打包时引用。

### 桌面应用打包

```bash
# 生成当前平台的安装包（默认 NSIS on Windows）
npm run tauri:build

# 或直接使用 cargo
cargo tauri build --manifest-path src-tauri/Cargo.toml
```

打包产物位于 `src-tauri/target/release/bundle/`。

### 平台特定说明

- **Windows**：默认生成 `.exe` 与 `.nsis.exe` 安装程序；需要代码签名请参考下方「签名与分发」。
- **macOS**：可配置生成 `.dmg` 与 `.app`；Apple Silicon / Intel 通用二进制需在 `tauri.conf.json` 中设置 `targets` 与架构。
- **Linux**：可生成 `.AppImage`、`.deb`、`.rpm`；需安装对应打包工具链。

---

## 开发指南

### 项目结构

```text
pyforge-ai/
├── src/                          # 前端源码
│   ├── App.tsx                   # 根组件与路由
│   ├── main.tsx                  # React 入口
│   ├── components/               # 可复用组件
│   │   ├── layout/               # 布局组件（AppShell、SidebarNav、TopBar）
│   │   └── ui/                   # 基础 UI 组件（Button、Card、Dialog、Tabs 等）
│   ├── hooks/                    # React Hooks（如 useTheme）
│   ├── lib/                      # 工具库与 Tauri API 封装
│   │   └── tauri-api.ts          # 前后端 IPC 调用接口
│   ├── pages/                    # 页面级组件
│   │   ├── Dashboard.tsx
│   │   ├── PythonVersions.tsx
│   │   ├── Environments.tsx
│   │   ├── Packages.tsx
│   │   ├── AiDeploy.tsx
│   │   └── Settings.tsx
│   └── types/                    # TypeScript 类型定义
├── src-tauri/                    # Rust + Tauri 后端
│   ├── src/
│   │   ├── main.rs               # Tauri Builder、命令注册与插件初始化
│   │   ├── ai/                   # AI 服务与提示词
│   │   ├── package/              # 包管理与镜像源
│   │   ├── platform/             # 平台适配器（Windows / macOS / Linux）
│   │   ├── python/               # Python 扫描与版本管理
│   │   ├── security.rs           # 路径校验、URL 校验与参数消毒
│   │   └── venv/                 # 虚拟环境操作
│   ├── capabilities/default.json # 前端权限声明
│   ├── tauri.conf.json           # Tauri 应用配置
│   └── Cargo.toml
├── docs/                         # 项目文档
├── package.json
├── vite.config.ts
└── PyForge-AI-技术选型白皮书.md   # 技术选型详细报告
```

### 如何添加 Tauri 命令

1. 在 `src-tauri/src/` 的对应模块实现业务函数。
2. 在 `src-tauri/src/main.rs` 中使用 `#[tauri::command]` 注册公开命令。
3. 将命令加入 `invoke_handler!` 宏列表。
4. 在 `src/lib/tauri-api.ts` 中封装前端调用函数，并补充类型映射。
5. 若命令涉及新的系统能力，需在 `src-tauri/capabilities/default.json` 中声明对应权限。

### 如何添加 UI 组件

1. 基础组件优先放入 `src/components/ui/`，使用 Tailwind CSS 变量保持与设计系统一致。
2. 页面级组件放入 `src/pages/`，通过 `App.tsx` 中的 `<Route>` 注册。
3. 状态管理当前以 React 局部状态为主；后续可引入 Zustand / Jotai 处理跨页面共享状态。
4. 所有新增 API 调用建议经过 `src/lib/tauri-api.ts` 中的 `isTauri()` 分支，保证浏览器中也能使用 mock 数据运行。

---

## 测试

### 前端测试

```bash
npm run test
```

> 注：当前项目尚未配置测试框架，建议后续集成 Vitest + React Testing Library。可在 `package.json` 的 `scripts` 中补充 `"test": "vitest"`。

### Rust 后端测试

```bash
# 运行所有 Rust 单元测试与集成测试
cargo test --manifest-path src-tauri/Cargo.toml

# 运行特定模块测试
cargo test --manifest-path src-tauri/Cargo.toml python::
```

### 代码质量

```bash
# TypeScript / ESLint / Prettier
npm run lint
npm run lint:fix
npm run format
npm run typecheck

# Rust 格式化与检查
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

---

## 签名与分发

### Windows

- **标准代码签名**：使用 `signtool` 配合标准代码签名证书对 `.exe` / `.msi` 签名。
- **EV 代码签名**：推荐企业场景使用 EV 证书，可有效消除 SmartScreen 拦截。
- **Azure Key Vault / HSM**：Tauri 签名配置支持通过环境变量或 `tauri.conf.json` 引用云端密钥。

### macOS

- 使用 Apple Developer ID Application 证书进行 `codesign`。
- 打包后执行 `notarytool` 公证，确保 Gatekeeper 放行。
- 如需通用二进制，分别在 `x86_64-apple-darwin` 与 `aarch64-apple-darwin` 上构建并合并。

### Linux

- 使用 GPG 对 `.AppImage`、`.deb`、`.rpm` 包签名，便于仓库校验。
- 可通过 Launchpad / Open Build Service 分发已签名包。

### CI/CD

建议将签名密钥与证书存储在 GitHub Actions / GitLab CI 等密钥管理系统中，通过 `TAURI_SIGNING_PRIVATE_KEY`、`AZURE_KEY_VAULT_*` 等环境变量注入。自动更新功能由 `tauri-plugin-updater` 提供，需在更新服务器托管签名后的更新包与元数据。

### 相关文档

- **完整签名配置指南**：请参阅 [docs/SIGNING.md](./docs/SIGNING.md)。
- **企业大规模部署指南**：请参阅 [docs/ENTERPRISE.md](./docs/ENTERPRISE.md)。

---

## 安全

- **Content-Security-Policy (CSP)**：`tauri.conf.json` 中已配置 CSP，限制脚本、样式与网络连接来源，仅允许 `self`、PyPI 域名与 OpenAI API 域名。
- **Capabilities 权限模型**：前端仅能通过声明式权限访问后端命令。`src-tauri/capabilities/default.json` 明确列出允许的 shell 命令、文件路径、HTTP 域名与对话框操作。
- **路径校验**：`src-tauri/src/security.rs` 提供路径校验与参数消毒，防止目录穿越与非法命令注入。
- **最小权限原则**：默认不开启 `dangerousDisableAssetCspModification`，避免前端绕过 CSP；插件按需启用。
- **内存安全**：Rust 所有权系统消除大部分传统 C/C++ 内存漏洞类别。

---

## 贡献指南

1. **Fork & Branch**：从 `main` 切出功能分支，命名建议 `feature/<short-desc>` 或 `fix/<issue-id>`。
2. **代码规范**：前端遵循 ESLint + Prettier 配置；Rust 遵循 `cargo fmt` 与 `cargo clippy`。
3. **提交信息**：使用 [Conventional Commits](https://www.conventionalcommits.org/) 风格，例如 `feat: 添加 Python 版本扫描缓存`。
4. **测试**：新增功能应补充单元测试，核心命令建议补充集成测试。
5. **文档**：若修改公开 API 或构建流程，请同步更新 `README.md` 与 `docs/` 下相关文档。
6. **PR 审查**：确保 CI 通过、无敏感信息泄露、权限配置最小化。

---

## 许可证

PyForge AI 采用双重许可，你可任选其一：

- [MIT License](./LICENSE-MIT)（待创建）
- [Apache License 2.0](./LICENSE-APACHE)（待创建）

> 在官方许可证文件创建前，本声明仅为占位。实际分发前请咨询法务完成许可证文件与版权声明。
