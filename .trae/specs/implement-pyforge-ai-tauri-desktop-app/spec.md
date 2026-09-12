# PyForge AI 桌面应用实现规格书

## Why

现有 `design/pages/` 下已产出 12 页高保真 HTML 设计稿与 `design/colors_and_type.css` 设计系统，但仅为静态原型。本规格书将其工程化为一款跨平台、高性能、可维护的智能化 Python 生态环境管理桌面应用，核心目标为：Windows/macOS/Linux 三平台一致体验、冷启动 < 500ms、内存 < 50MB、支持 AI 智能部署。

## What Changes

- 新增 Tauri 2.0 + Rust 后端核心，负责系统级操作（进程、文件、Shell、网络）。
- 新增 React 18 + TypeScript + Tailwind CSS 4 前端工程，复用现有设计系统 CSS 变量。
- 将 `pages/` 静态 HTML 迁移为可交互 React 页面：控制台、Python 版本、虚拟环境、包与镜像源、AI 智能部署、设置。
- 实现平台自适应层：Windows 为默认一等平台，macOS/Linux 为可选增强。
- 实现 Python 引擎抽象：支持子进程调用 python/pip/venv，并预留 uv 集成接口。
- 实现 AI 部署模块：基于 OpenAI/兼容 API 的流式对话与部署方案生成。
- 建立 CI/CD、自动更新、代码签名、企业分发能力。

## Impact

- 受影响设计资产：`design/colors_and_type.css`、`design/pyforge-ai.design`、全部 `design/pages/*.html`。
- 受影响代码：新增 `src-tauri/`（Rust）、`src/`（React）、根目录配置文件。
- 新增产物：Windows MSI、macOS DMG、Linux AppImage/deb 安装包。

## ADDED Requirements

### Requirement: 跨平台桌面应用框架

系统 SHALL 使用 Tauri 2.0 构建桌面应用，前端使用系统原生 WebView，避免内嵌 Chromium。

#### Scenario: 应用启动

- **WHEN** 用户点击应用图标
- **THEN** 应用在 500ms 内完成首帧渲染，空闲内存小于 50MB

### Requirement: 前端设计系统复用

系统 SHALL 复用 `design/colors_and_type.css` 中的 CSS 变量与语义化 token，前端通过 Tailwind CSS 4 `@theme inline` 映射。

#### Scenario: 主题一致性

- **WHEN** 应用切换明暗主题或跨平台运行
- **THEN** 所有页面颜色、圆角、字体、阴影与设计系统保持一致

### Requirement: 应用壳与导航

系统 SHALL 实现 240px 左侧深色侧边栏 + 56px 顶部工具栏 + 主内容区的桌面应用壳，包含 6 个导航项。

#### Scenario: 页面切换

- **WHEN** 用户点击侧边栏导航
- **THEN** 主内容区切换至对应页面，当前导航项高亮，过渡流畅

### Requirement: Python 版本管理

系统 SHALL 支持扫描本地 Python 安装、显示版本列表、安装/卸载/切换默认版本。

#### Scenario: 扫描完成

- **WHEN** 用户进入 Python 版本页面
- **THEN** 系统在 2s 内返回本地可识别的 Python 版本列表，包含路径与是否活跃

#### Scenario: 版本切换

- **WHEN** 用户选择某个 Python 版本设为默认
- **THEN** 系统修改对应平台的环境变量或 Shell 配置，并反馈结果

### Requirement: 虚拟环境管理

系统 SHALL 支持创建、克隆、导出、删除虚拟环境，并显示环境列表与依赖树。

#### Scenario: 创建环境

- **WHEN** 用户输入环境名称、选择 Python 版本并点击创建
- **THEN** 系统在 5s 内完成 `python -m venv` 或等价操作，并刷新列表

### Requirement: 包与镜像源管理

系统 SHALL 支持配置 pip 镜像源、测试镜像源速度、搜索并安装包、展示已安装包列表。

#### Scenario: 切换镜像源

- **WHEN** 用户选择新的镜像源
- **THEN** 系统更新 `pip.ini` / `pip.conf`，并提示测试速度

### Requirement: AI 智能部署

系统 SHALL 提供 AI 对话面板，基于自然语言生成部署方案，并展示部署进度。

#### Scenario: 生成部署方案

- **WHEN** 用户输入部署需求
- **THEN** AI 流式返回分析步骤、推荐 Python 版本、依赖列表与部署命令

### Requirement: 平台自适应

系统 SHALL 在运行时检测操作系统，并加载对应平台适配器处理路径、Shell、包管理器差异。

#### Scenario: Windows 默认平台

- **WHEN** 应用在 Windows 运行
- **THEN** 使用 PowerShell Profile、注册表 PATH、WebView2 等 Windows 原生机制

#### Scenario: macOS/Linux 增强

- **WHEN** 应用在 macOS/Linux 运行
- **THEN** 使用 Homebrew/apt/zsh/bash/fish 等对应机制

### Requirement: 企业级安全与分发

系统 SHALL 支持代码签名、自动更新签名验证、最小权限 Capabilities 配置、CSP 策略。

#### Scenario: 自动更新

- **WHEN** 应用启动后检测到新版本
- **THEN** 下载更新包并验证 Ed25519 签名，验证通过后才安装

### Requirement: 可维护性与测试

系统 SHALL 使用 TypeScript 与 Rust 强类型、模块化架构，并配置单元测试、集成测试、E2E 测试。

#### Scenario: CI 校验

- **WHEN** 提交代码到主分支
- **THEN** CI 自动运行 cargo test、vitest、tauri build、clippy、 cargo-audit

## MODIFIED Requirements

无现有代码需修改，本次为新增工程实现。

## REMOVED Requirements

无移除需求。静态 HTML 设计稿保留作为设计参考，不删除。
