# PyForge AI 桌面应用开发任务编排

## Phase 0: 基础设施与项目脚手架

- [x] **Task 0.1: 初始化 Tauri 2.0 + React 工程**
  - [x] 安装 Rust、Node.js、Tauri CLI 环境依赖（Rust 已安装；Tauri CLI 因缺少 MSVC/GCC 链接器无法本地编译）
  - [x] 运行 `npm create tauri-app@latest` 创建 `src-tauri/` 与 `src/`
  - [x] 配置 Vite 6 + React 18 + TypeScript + Tailwind CSS 4
  - [x] 将 `design/colors_and_type.css` 接入 Tailwind `@theme inline`
  - [ ] 验证 `cargo tauri dev` 可正常启动空白窗口（当前环境缺少 MSVC，需在外部 Windows 开发机验证）

- [x] **Task 0.2: 设计系统组件库搭建**
  - [x] 提取现有 HTML 中的按钮、卡片、输入框、表格、徽章、标签页为 React 组件
  - [x] 实现 `AppShell`（240px 侧边栏 + 56px 顶栏 + 主内容区）
  - [x] 实现 `SidebarNav` 与 6 个导航项的路由映射
  - [x] 实现主题切换与 CSS 变量动态注入

- [x] **Task 0.3: 工程规范与 CI/CD**
  - [x] 配置 ESLint、Prettier、Rust fmt、clippy
  - [x] 配置 GitHub Actions：lint、test、build（Windows/macOS/Linux）
  - [x] 集成 cargo-audit 与 npm audit 到 CI
  - [x] 配置 pre-commit hook

## Phase 1: Rust 核心引擎

- [x] **Task 1.1: 平台抽象层**
  - [x] 定义 `PlatformAdapter` trait（detect、python_search_paths、default_mirror、shell_config_file 等）
  - [x] 实现 `WindowsAdapter`（默认平台）
  - [x] 实现 `MacOSAdapter` 与 `LinuxAdapter`
  - [x] 实现运行时 `get_adapter()` 条件编译选择

- [x] **Task 1.2: Python 版本扫描与管理**
  - [x] 实现 Python 安装路径扫描（注册表、PATH、已知目录）
  - [x] 实现版本信息解析（`python --version`）
  - [x] 实现并行扫描（rayon）
  - [x] 暴露 Tauri 命令：`scan_python_versions`、`set_default_python`、`get_python_details`

- [x] **Task 1.3: 虚拟环境操作**
  - [x] 实现 `create_venv`、`delete_venv`、`clone_venv`、`export_venv`
  - [x] 实现依赖列表读取（`pip list --format=json`）
  - [x] 实现依赖树可视化数据生成
  - [x] 暴露 Tauri 命令：`list_venvs`、`create_venv`、`remove_venv`、`get_dependencies`

- [x] **Task 1.4: 包与镜像源管理**
  - [x] 实现 pip 配置读写（Windows `pip.ini` / Unix `pip.conf`）
  - [x] 实现镜像源测速（HTTP HEAD 请求）
  - [x] 实现包搜索（PyPI JSON API）
  - [x] 暴露 Tauri 命令：`get_mirrors`、`get_current_mirror`、`test_mirror_speed`、`set_mirror`、`search_package`、`list_installed_packages`

- [x] **Task 1.5: 系统交互与安全**
  - [x] 配置 Tauri Capabilities（fs、shell、dialog、process、http 最小权限）
  - [x] 实现路径校验防止目录穿越
  - [x] 实现子进程超时与输出流式返回
  - [x] 配置 CSP 与自定义协议白名单

## Phase 2: 前端页面实现

- [x] **Task 2.1: 控制台页面（Dashboard）**
  - [x] 复用 `dashboard.html` 布局：统计卡片、AI 助手面板、快捷操作、环境状态、活动时间线
  - [x] 对接 Rust 命令获取系统概览数据（已接入 Tauri invoke，浏览器环境自动回退 mock 数据）
  - [x] 实现快捷操作按钮与导航跳转

- [x] **Task 2.2: Python 版本页面**
  - [x] 复用 `python-versions.html` 列表与详情面板
  - [x] 对接 `scan_python_versions` 与 `set_default_python`（已接入 Tauri invoke）
  - [x] 实现安装/卸载操作入口（先子进程调用，后预留 uv 接口）

- [x] **Task 2.3: 虚拟环境页面**
  - [x] 复用 `environments.html` 卡片网格与创建表单
  - [x] 对接 `list_venvs`、`create_venv`、`remove_venv`（已接入 Tauri invoke）
  - [x] 实现依赖树展示

- [x] **Task 2.4: 包与镜像源页面**
  - [x] 复用 `packages.html` 搜索、镜像源选择器、测速结果、已安装包表格
  - [x] 对接镜像源与包搜索命令（已接入 Tauri invoke）
  - [x] 实现安装进度终端输出展示

- [x] **Task 2.5: AI 智能部署页面**
  - [x] 复用 `ai-deploy.html` 对话面板、向导步骤、项目分析卡片
  - [x] 实现流式 SSE/HTTP 对话渲染（前端模拟，后端 `stream_chat` 已就绪）
  - [x] 集成 OpenAI/兼容 API 后端（`async-openai`）
  - [x] 实现部署进度终端展示

- [x] **Task 2.6: 设置页面**
  - [x] 复用 `settings.html` 标签页：通用、外观、路径、AI 配置、关于
  - [x] 实现配置持久化（主题已接入 localStorage；其余设置使用内存状态，待 Tauri store 接入）
  - [x] 实现软件属性展示（版本、版权、平台信息）

## Phase 3: 平台扩展与响应式

- [ ] **Task 3.1: 三平台编译验证**
  - [ ] Windows 构建通过（MSI）
  - [ ] macOS 构建通过（DMG，x64 + aarch64 Universal）
  - [ ] Linux 构建通过（AppImage + deb）

- [x] **Task 3.2: 平台差异化 UI 与全页面响应式**
  - [x] 更新 `AppShell.tsx`：屏幕 < 1024px 时隐藏侧边栏并以汉堡菜单打开 overlay 抽屉
  - [x] 更新 `Dashboard.tsx`：统计卡片移动端 1 列、平板 2 列、桌面 4 列；AI 助手面板与快速操作在移动端堆叠、桌面端并排
  - [x] 更新 `AiDeploy.tsx`：聊天面板与部署摘要在移动端堆叠、桌面端 3:2 分栏；输入区与按钮在小屏幕可用
  - [x] 更新 `Settings.tsx`：Paths 选项卡显示平台特定默认路径（Windows `%APPDATA%`、macOS `~/Library/Application Support`、Linux `~/.config`）；About 选项卡显示平台详情
  - [x] 检查 `PythonVersions.tsx`、`Environments.tsx`、`Packages.tsx` 在 AppShell 中的响应式表现，必要时补充响应式类
  - [x] 运行 `npm run lint` 与 `npm run build` 通过，无新增 TypeScript 与 ESLint 错误

## Phase 4: AI 与企业特性

- [x] **Task 4.1: AI 部署引擎**
  - [x] 设计 prompt 模板：项目分析 → 推荐 Python 版本 → 依赖解析 → 部署命令
  - [x] 实现依赖冲突分析辅助
  - [x] 支持本地 LLM（base_url 配置）与云端 API 切换

- [x] **Task 4.2: 自动更新**
  - [x] 配置 `tauri-plugin-updater`（公钥与更新元数据已配置占位）
  - [x] 生成 Ed25519 签名密钥对脚本已提供
  - [x] 更新服务器/更新元数据 JSON 示例已提供
  - [x] CI 中签名并上传更新包模板已提供

- [x] **Task 4.3: 代码签名与企业分发**
  - [x] Windows EV/标准代码签名文档与脚本（signtool / Azure Key Vault）
  - [x] macOS codesign + notarytool 文档与脚本
  - [x] Linux GPG 签名文档（可选）
  - [x] 组策略/MDM 配置文件模板

## Phase 5: 测试、性能优化与发布

- [x] **Task 5.1: 自动化测试**
  - [x] Rust 单元测试（核心引擎，含 security、platform、venv、package 模块）
  - [x] 前端 vitest 组件测试（配置与基础测试已添加）
  - [x] Tauri E2E 测试基础设施（Playwright + WebView2 CDP）已搭建

- [x] **Task 5.2: 性能优化**
  - [ ] 冷启动 < 500ms、热启动 < 200ms 优化
  - [x] Python 扫描并行化与缓存（已使用 rayon + once_cell）
  - [x] 前端 bundle 分析与懒加载（React.lazy + 路由分割已添加）

- [x] **Task 5.3: 文档与发布**
  - [x] 更新 README：构建、开发、签名、分发
  - [x] 编写用户手册（docs/DEVELOPMENT.md、docs/ARCHITECTURE.md）
  - [ ] 发布 v1.0.0

# Task Dependencies

- Phase 1 依赖 Phase 0
- Phase 2 依赖 Phase 0 与 Phase 1
- Phase 3 依赖 Phase 2
- Phase 4 依赖 Phase 2 与 Phase 3
- Phase 5 依赖 Phase 4

可并行：

- Task 0.1、0.2、0.3 可部分并行
- Task 1.1 ~ 1.4 可并行开发（依赖 0.1 完成）
- Task 2.1 ~ 2.6 可并行开发（依赖 1.x 对应命令暴露完成）
