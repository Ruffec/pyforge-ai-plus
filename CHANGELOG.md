# Changelog

## [1.0.0] - Unreleased

### Added

- Tauri 2.0 + React + TypeScript + Tailwind CSS 4 桌面应用骨架。
- 跨平台适配器：Windows、macOS、Linux 的平台检测与差异化行为。
- Python 版本扫描：并行扫描系统 Python，缓存结果，显示版本、路径、活跃状态。
- 虚拟环境管理：创建、列出、删除、导出依赖树。
- 包与镜像源：镜像源配置、延迟测速、包搜索与安装。
- AI 智能部署：基于 OpenAI/兼容 API 的流式对话，生成项目分析与部署方案。
- 设置页面：通用、外观、路径、AI 配置、关于，支持主题切换与平台信息展示。
- 响应式布局：侧边栏抽屉、页面网格自适应、移动端可用。
- 安全：Tauri Capability 最小权限、CSP、路径校验、命令参数清洗、URL Scheme 白名单。
- 性能：React.lazy 路由懒加载、前端 bundle 分析、Python 扫描并行化与缓存。
- 测试：Vitest 前端单元测试、Playwright E2E 测试基础设施、Rust 核心模块单元测试。
- 自动更新：tauri-plugin-updater 配置、CI 模板、签名脚本与示例元数据。
- 企业分发：代码签名文档（Windows/macOS/Linux）、MDM/GPO 配置模板。
- 文档：README、DEVELOPMENT、ARCHITECTURE、SIGNING、ENTERPRISE。

### Changed

- 前端页面由静态 HTML 迁移至 React 组件。
- Rust 后端统一通过 Tauri Commands 向前端暴露能力。

### Fixed

- 路径穿越与命令注入风险通过白名单与参数校验缓解。
- 非 Tauri 环境（浏览器开发）自动回退 mock 数据。

### Known Issues / Blockers

- Windows MSI/macOS DMG/Linux AppImage 构建需完整工具链（MSVC/GCC、Xcode、Linux deps）。
- 冷启动与内存指标需在真实 Tauri 运行环境中测量。
- 自动更新公钥与更新服务器 URL 为占位符，发布前需替换。
- E2E 测试需先构建 Tauri 二进制，当前环境缺少 C 编译器无法执行。
