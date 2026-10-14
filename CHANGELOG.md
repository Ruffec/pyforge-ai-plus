# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范，
版本号遵循 [语义化版本（Semantic Versioning）](https://semver.org/lang/zh-CN/)。

## [0.2.0] - 2026-10-14

### Added

- **双端 HTTP 桥接**（`bridge.rs`）：桌面端内置 axum 服务（`127.0.0.1:21880`），提供 `/api/rpc`（同款命令转发）、`/api/events`（SSE 事件总线）、`/api/health`（健康探针）；前端 `invokeCommand` 双通道自适应，浏览器与桌面窗口共享全部业务能力，页面代码零感知。
- **系统盘写入监控与审计**（`write_guard.rs`）：写入拦截层 + 30s 周期审计双通道，违规事件全字段记录（文件路径/写入时间/文件类型/所属模块/发生次数），同路径去重累加，JSONL 崩溃保护持久化，标准 Excel 审计报告导出（独立文件夹与日志目录同层级，目录迁移时随迁）。
- **Python 一键安装**（`python/installer.rs`）：全版本下载部署、自定义安装路径（支持中文与特殊字符）、740 提权自动回退、安装后回读校验、双端列表实时刷新。
- **Python 彻底卸载**（`python/msi_residue.rs`）：MSI 七类残留全量清扫（逐产品真卸载、HKLM/HKCU ARP 注册表、UpgradeCodes/Components 关联项、Package Cache、Burn 瘦桩），安装路径显式透传（`TargetDir`），空路径与格式异常时终止并提示。
- **企业级结构化日志系统**：JSON 方案废弃，改为标准文本格式（时间 / 级别 / 模块 / 线程 ID / 全链路 trace ID / 正文），支持动态模块名提升；单条消息 4096 字符限长防线（UTF-8 安全截断 + 截断标记）；默认 10MB 按大小轮转、序号后缀递增、超出保留数删最旧；日志目录变更自动迁移（同盘 rename、跨盘复制+删除、活跃文件句柄换绑、违规目录随迁）。
- **前端新能力**：系统盘违规记录查看与 Excel 导出入口（设置页）、版本列表分页组件（每页条数可配置）、桥接状态横幅、PyPI 镜像源注册表、AI 自定义模型配置（服务商联动 / JSON 导入导出 / 本地 LLM 条件面板）。
- **平台路径规则**（`paths.rs`）：所有运行期数据（配置/日志/缓存/虚拟环境）非系统盘优先，杜绝写入 C 盘；子进程环境注入（`TMP` / `PIP_CACHE_DIR` 指向非系统盘）。
- **MIT LICENSE** 文件正式入库。

### Changed

- 配置存储迁移至非系统盘存储根（`<非系统盘>/PyForge/pyforge-ai/config.json`），配置更新改为逐节浅合并，修复部分补丁反序列化时未传字段被默认值悄悄重置的问题。
- 前端移除全部 mock 数据（`mock-data.ts` 删除），所有页面接入真实数据源（本机 Python 实时扫描 / PyPI 镜像实时拉取 / AI 服务商实时调用）。
- `pip list --outdated` 改为纯本地清单查询 + 30s 超时保护，包列表页加载时间从 62s 降至约 12s。
- UI 优化：主题切换联动原生窗口标题栏、全局细柱自动隐藏滚动条、环境卡片操作按钮防折行、页脚版权年份动态化、启动骨架屏（`index.html` 静态首帧）。
- ESLint 新增 `no-console` 规则（放行 `warn/error` 兜底场景），阻断调试性控制台输出进入主干。
- README.md 全面标准化：项目背景与定位、核心功能特性、架构与数据持久化说明、10 分钟快速上手、分环境安装配置、核心功能示例代码、目录结构分层说明、贡献流程、许可证声明。

### Fixed

- 控制台页扫描事件无回声守卫导致的自激扫描风暴（约 3ms/轮 CPU 空转与界面闪屏）。
- 日志轮转三处缺陷：rename 后写入句柄跟随归档文件、Windows 目录枚举元数据陈旧导致轮转永不触发、轮转后活跃日志文件未重建。
- `VERSION_REGEX` 强制 "python " 前缀导致纯版本号解析失败（卸载时静默跳过注册表清理）。
- `winreg` RegValue API 误用、卸载命令斜杠参数解析缺陷、注册表 GUID 截断（残留清理静默失效）。
- Python 安装路径 `\\?\` 前缀乱码显示（后端 `normalize_display_path` + 前端兜底）。
- Tauri v2 IPC 错误对象化导致前端显示 `[object Object]`（`tauriInvoke` 统一解包）。
- 日志目录迁移后写入滞留旧盘（跨盘场景活跃文件句柄换绑）。

### Security

- 强制约束所有运行期文件（日志/缓存/临时文件/用户数据）不写入系统盘，违规即审计记录并可导出报告。
- Capabilities 最小权限、CSP 白名单、路径校验与命令参数消毒持续强化（`security.rs`）。

## [0.1.0] - 2026-10-10

### Added

- Tauri 2.0 + React 18 + TypeScript + Tailwind CSS 4 桌面应用骨架。
- 跨平台适配器：Windows、macOS、Linux 的平台检测与差异化行为。
- Python 版本扫描：并行扫描系统 Python，缓存结果，显示版本、路径、活跃状态。
- 虚拟环境管理：创建、列出、删除、导出依赖树。
- 包与镜像源：镜像源配置、延迟测速、包搜索与安装。
- AI 智能部署：基于 OpenAI/兼容 API 的流式对话，生成项目分析与部署方案。
- 设置页面：通用、外观、路径、AI 配置、关于，支持主题切换与平台信息展示。
- 响应式布局：侧边栏抽屉、页面网格自适应、移动端可用。
- 安全基线：Tauri Capability 最小权限、CSP、路径校验、命令参数清洗、URL Scheme 白名单。
- 自动更新：tauri-plugin-updater 配置、GitHub Actions 四平台构建与发布流水线、更新签名密钥脚本。
- 测试：Vitest 前端单元测试、Playwright E2E 基础设施、Rust 核心模块单元测试。

[0.2.0]: https://github.com/Ruffec/pyforge-ai-plus/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Ruffec/pyforge-ai-plus/releases/tag/v0.1.0
