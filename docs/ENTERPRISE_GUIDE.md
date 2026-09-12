# PyForge AI 企业级开发指南

> 本文档描述 PyForge AI 企业级架构设计、模块划分、API 接口及开发规范。

## 目录

1. [架构概览](#架构概览)
2. [后端模块详解](#后端模块详解)
3. [前端架构](#前端架构)
4. [API 接口清单](#api-接口清单)
5. [企业级特性](#企业级特性)
6. [开发规范](#开发规范)

---

## 架构概览

### 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 桌面框架 | Tauri | 2.0 |
| 后端语言 | Rust | 2021 Edition |
| 前端框架 | React | 18.3 |
| 前端语言 | TypeScript | 5.7 |
| 样式系统 | Tailwind CSS | 4.0 |
| 构建工具 | Vite | 6.0 |
| 状态管理 | Zustand | 4.x |
| 异步运行时 | Tokio | 1.x |
| HTTP 客户端 | reqwest | 0.12 |
| AI SDK | async-openai | 0.28 |

### 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                     前端 (React + TS)                     │
├─────────────┬──────────────┬─────────────────────────────┤
│  页面组件    │  状态管理     │  UI 组件库                  │
│  (7个页面)  │  (Zustand)   │  (15+ 组件)                │
├─────────────┴──────────────┴─────────────────────────────┤
│                   Tauri IPC 通信层                         │
├───────────────────────────────────────────────────────────┤
│                     后端 (Rust + Tauri)                    │
├──────────┬──────────┬──────────┬──────────┬──────────────┤
│ 基础设施 │ Python   │ 虚拟环境 │ 包管理   │ 项目管理     │
│ 错误/配置│ 版本管理 │ 管理     │ 镜像源   │ 依赖解析     │
│ 日志/事件│ 健康检查 │ 快照修复 │ 安装卸载 │ 环境关联     │
├──────────┴──────────┴──────────┴──────────┴──────────────┤
│              平台适配层 (Windows/macOS/Linux)              │
└───────────────────────────────────────────────────────────┘
```

---

## 后端模块详解

### 1. 错误处理模块 (`error.rs`)

**统一错误类型 `AppError`**

```rust
pub struct AppError {
    pub code: ErrorCode,      // 错误码（25+ 种）
    pub message: String,      // 用户可读消息
    pub details: Option<String>, // 技术详情（仅日志）
}
```

**错误码体系**

| 类别 | 错误码 |
|------|--------|
| 通用 | `Unknown`, `IoError`, `Cancelled`, `PermissionDenied` |
| 安全 | `PathValidation`, `ShellInjection`, `InvalidUrlScheme` |
| 命令 | `CommandFailed`, `CommandTimeout` |
| Python | `PythonNotFound`, `PythonVersionParse` |
| 虚拟环境 | `VenvNotFound`, `VenvAlreadyExists`, `VenvCorrupted` |
| 包管理 | `PackageNotFound`, `PackageInstallFailed`, `DependencyConflict` |
| AI | `AiConfigInvalid`, `AiApiError`, `AiNoResponse` |
| 配置 | `ConfigError`, `ProjectParseError` |

**特性**
- 自动转换各模块错误为统一 `AppError`
- 序列化为 JSON 时包含 `code`、`message`、`status_code`
- 支持 HTTP 风格状态码映射

### 2. 配置管理模块 (`config.rs`)

**配置结构**

```rust
pub struct AppConfig {
    pub version: String,
    pub general: GeneralConfig,    // 通用设置
    pub python: PythonConfig,      // Python 设置
    pub venv: VenvConfig,          // 虚拟环境设置
    pub package: PackageConfig,    // 包管理设置
    pub ai: AiConfig,              // AI 设置
    pub logging: LoggingConfig,    // 日志设置
    pub ui: UiConfig,              // UI 设置
}
```

**特性**
- 配置文件存储于系统配置目录（`~/.config/pyforge-ai/config.json`）
- 支持部分更新（浅合并）
- 配置验证（温度范围、超时时间等）
- 全局单例，线程安全（`RwLock`）
- 支持重置为默认值

### 3. 日志系统模块 (`logging.rs`)

**特性**
- 基于 `tracing` 生态的结构化日志
- 控制台输出 + JSON 格式文件输出
- 按大小轮转（默认 10MB，保留 5 个文件）
- 支持运行时动态切换日志级别
- 便捷宏：`app_info!`, `app_warn!`, `app_error!`, `app_debug!`
- 支持自定义 target（如 `pyforge_ai::package`）

**日志文件位置**
- Windows: `%APPDATA%\pyforge-ai\logs\pyforge-ai.log`
- macOS: `~/Library/Application Support/pyforge-ai/logs/`
- Linux: `~/.local/share/pyforge-ai/logs/`

### 4. 事件总线模块 (`events.rs`)

**事件通道**

| 通道 | 用途 |
|------|------|
| `pyforge://task/progress` | 任务进度通知 |
| `pyforge://notification` | 系统通知推送 |
| `pyforge://log` | 实时日志推送 |
| `pyforge://python/scanned` | Python 扫描完成 |
| `pyforge://venv/changed` | 虚拟环境变更 |
| `pyforge://package/progress` | 包安装进度 |
| `pyforge://ai/stream` | AI 流式输出 |

**任务管理器**
- 任务注册、状态更新、进度跟踪
- 支持任务列表查询、清理已完成任务
- 任务状态：`pending` / `running` / `completed` / `failed` / `cancelled`

### 5. Python 版本管理模块 (`python/mod.rs`)

**核心功能**
- 多路径扫描（系统 PATH、pyenv、自定义路径）
- 版本解析与排序（语义化版本比较）
- 扫描缓存（TTL 可配置，默认 300 秒）
- 默认版本设置（平台适配）

**企业级增强**
- `health_check()` - Python 安装健康检查（6 项检查）
  - 可执行文件验证
  - 版本号解析
  - pip 可用性
  - 标准库导入
  - 站点包目录可写性
- `validate_python_executable()` - 可执行文件验证
- `get_python_env_info()` - 环境变量信息（PYTHONPATH、VIRTUAL_ENV 等）
- `get_sys_path()` - 模块搜索路径
- `check_compatibility()` - 包版本兼容性检查（支持 `>=`, `<=`, `==`, `!=`, `>`, `<`）

### 6. 虚拟环境管理模块 (`venv/mod.rs`)

**核心功能**
- 创建、删除、克隆虚拟环境
- 依赖列表、依赖树（pipdeptree）
- 导出 requirements.txt
- 磁盘使用统计

**企业级增强**
- `validate_venv()` - 环境完整性验证（5 项检查）
  - Python 可执行文件
  - pip 可用性
  - pyvenv.cfg 配置
  - 站点包目录
- `repair_venv()` - 自动修复（ensurepip、升级 pip、setuptools/wheel）
- `create_snapshot()` - 创建依赖快照（持久化存储）
- `list_snapshots()` - 列出所有快照
- `restore_from_snapshot()` - 从快照恢复依赖
- `delete_snapshot()` - 删除快照
- `export_portable()` - 导出可迁移格式（含恢复说明）
- `get_venv_disk_usage()` - 磁盘使用详情（按子目录分解）

### 7. 包与镜像源管理模块 (`package/mod.rs`)

**核心功能**
- 5 个内置镜像源（清华、阿里、豆瓣、腾讯、PyPI 官方）
- 镜像源测速、切换、批量测速
- 包搜索（PyPI JSON API）
- 已安装包列表（含过时检测）

**企业级增强**
- `install_package()` - 安装单个包（支持版本指定）
- `uninstall_package()` - 卸载包
- `install_from_requirements()` - 从 requirements.txt 批量安装
- `upgrade_all_packages()` - 升级所有过时包
- `is_package_installed()` - 检查包是否已安装
- 包名安全过滤（防注入）
- 自动从配置读取默认镜像源

### 8. 项目管理模块 (`project.rs`) - 全新模块

**核心功能**
- 项目扫描（递归目录，自动跳过 node_modules/.git 等）
- 项目类型识别（11 种类型）
  - standard / poetry / pdm / pipenv / conda / setuptools
  - flask / django / fastapi / data_science / unknown
- 依赖文件解析（requirements.txt、pyproject.toml、Pipfile）
- 项目特征检测（测试、Docker、CI/CD、README）

**数据结构**
```rust
pub struct ProjectInfo {
    pub name: String,
    pub path: String,
    pub project_type: ProjectType,
    pub python_version: Option<String>,
    pub dependencies: Vec<ProjectDependency>,
    pub dev_dependencies: Vec<ProjectDependency>,
    pub dependency_files: Vec<String>,
    pub associated_venv: Option<String>,
    pub has_tests: bool,
    pub has_docker: bool,
    pub has_ci: bool,
    // ...
}
```

**操作功能**
- `create_project_venv()` - 为项目创建关联虚拟环境
- `install_project_dependencies()` - 安装项目依赖
- `export_project_requirements()` - 导出项目依赖

### 9. AI 智能部署模块 (`ai/mod.rs`)

**核心功能**
- 部署方案生成（JSON 格式输出）
- 对话补全（非流式）
- 依赖冲突分析
- 流式聊天（`stream_chat()`）

**配置**
- 支持 OpenAI / Azure / 自定义 API / 本地 LLM
- 可配置 base_url、temperature、max_tokens
- API Key 安全校验

---

## 前端架构

### 状态管理 (Zustand)

**5 个独立 Store**

| Store | 用途 |
|-------|------|
| `useNotificationStore` | 通知系统（自动消失、ESC 清除） |
| `useTaskStore` | 任务进度（Map 存储、活跃任务跟踪） |
| `useConfigStore` | 应用配置（加载状态、错误处理） |
| `useSelectionStore` | 选中状态（Python版本/虚拟环境/项目） |
| `useThemeStore` | 主题管理（light/dark/system、强调色） |

### UI 组件库

**新增企业级组件**

| 组件 | 功能 |
|------|------|
| `Notification` | 全局通知容器（4 种类型、自动消失） |
| `TaskProgress` | 任务进度展示（浮动容器 + 内联进度条） |
| `ErrorBoundary` | React 错误边界（友好错误页 + 重试/刷新） |

### 页面 (7 个)

1. **Dashboard** - 控制台概览
2. **PythonVersions** - Python 版本管理
3. **Environments** - 虚拟环境管理
4. **Packages** - 包与镜像源管理
5. **Projects** - 项目管理（新增）
6. **AiDeploy** - AI 智能部署
7. **Settings** - 设置页面

---

## API 接口清单

### 基础命令 (3)
- `greet(name)` - 欢迎语
- `get_app_info()` - 应用信息
- `get_platform_info()` - 平台信息

### 配置管理 (3)
- `get_app_config()` - 获取配置
- `update_app_config(patch)` - 更新配置
- `reset_app_config()` - 重置配置

### 日志管理 (3)
- `read_recent_logs(max_lines?)` - 读取最近日志
- `clear_logs()` - 清理日志
- `get_log_file_path()` - 日志文件路径

### 任务管理 (3)
- `list_tasks_command()` - 任务列表
- `get_task_command(task_id)` - 任务详情
- `cleanup_tasks_command(keep_recent?)` - 清理任务

### Python 版本管理 (8)
- `scan_python_versions_command(force_refresh?)` - 扫描版本
- `set_default_python_command(path)` - 设置默认版本
- `get_python_details_command(path)` - 获取详情
- `clear_python_scan_cache()` - 清除缓存
- `python_health_check(path)` - 健康检查
- `validate_python_executable(path)` - 验证可执行文件
- `get_python_env_info()` - 环境变量信息
- `get_python_sys_path(path)` - sys.path
- `check_package_compatibility(...)` - 兼容性检查

### 虚拟环境管理 (14)
- `list_venvs()` - 环境列表
- `create_venv_command(name, python_path, target_dir?)` - 创建环境
- `remove_venv_command(path)` - 删除环境
- `get_dependencies_command(path)` - 依赖列表
- `clone_venv_command(source, target)` - 克隆环境
- `export_venv_command(path)` - 导出依赖
- `get_dependency_tree_command(path)` - 依赖树
- `validate_venv_command(path)` - 验证完整性
- `repair_venv_command(path)` - 修复环境
- `create_venv_snapshot_command(path, description?)` - 创建快照
- `list_venv_snapshots_command()` - 快照列表
- `restore_venv_from_snapshot_command(snapshot_id, target_venv)` - 恢复快照
- `delete_venv_snapshot_command(snapshot_id)` - 删除快照
- `export_venv_portable_command(path)` - 导出可迁移格式
- `get_venv_disk_usage_command(path)` - 磁盘使用详情

### 包与镜像源管理 (10)
- `get_mirrors()` - 镜像列表
- `get_current_mirror()` - 当前镜像
- `set_mirror_command(url)` - 设置镜像
- `test_mirror_speed_command(url)` - 测速
- `test_all_mirrors_speed()` - 批量测速
- `search_package_command(query)` - 搜索包
- `list_installed_packages_command(python_path)` - 已安装包
- `install_package_command(venv_path, package_name, version?)` - 安装包
- `uninstall_package_command(venv_path, package_name)` - 卸载包
- `install_from_requirements_command(venv_path, requirements)` - 批量安装

### 项目管理 (6)
- `scan_projects_command(root_path, max_depth?)` - 扫描项目
- `detect_project_command(path)` - 检测项目
- `parse_requirements_command(path, is_dev?)` - 解析 requirements
- `create_project_venv_command(project_path, python_path, venv_name?)` - 创建项目环境
- `install_project_dependencies_command(project_path, venv_path)` - 安装项目依赖
- `export_project_requirements_command(project_path)` - 导出项目依赖

### AI 部署 (3)
- `generate_deployment_plan(request, config)` - 生成部署方案
- `chat_message(messages, config)` - 对话
- `analyze_dependencies_command(requirements_content, config)` - 依赖冲突分析

### 安全 (2)
- `validate_path_command(path)` - 路径校验
- `sanitize_command_args_command(args)` - 参数消毒

**总计：70+ 个 Tauri 命令**

---

## 企业级特性

### 1. 安全防护
- **路径校验**：防止目录穿越攻击
- **命令参数消毒**：过滤 Shell 注入字符（`;`, `&`, `|`, `$`, `` ` ``）
- **URL 方案校验**：仅允许 http/https
- **CSP 策略**：限制脚本、样式、网络来源
- **Capabilities 权限模型**：声明式权限隔离
- **包名过滤**：安装包时自动过滤危险字符

### 2. 可观测性
- **结构化日志**：JSON 格式，含 target、level、时间戳
- **日志轮转**：按大小自动轮转，保留历史文件
- **任务追踪**：所有长任务有唯一 ID，可查询进度和状态
- **事件通知**：后端状态变更实时推送到前端

### 3. 配置管理
- **持久化存储**：配置自动保存到系统目录
- **版本化**：配置包含版本号，支持迁移
- **验证机制**：加载和更新时自动验证合法性
- **默认值**：完整的默认配置，开箱即用

### 4. 错误处理
- **统一错误类型**：所有模块错误转换为 `AppError`
- **错误码体系**：25+ 种错误码，便于前端分类处理
- **用户友好消息**：错误消息面向用户，技术详情仅日志
- **HTTP 状态码映射**：便于前端统一处理

### 5. 跨平台适配
- **平台抽象层**：`PlatformAdapter` trait 隔离平台差异
- **三平台实现**：Windows / macOS / Linux 独立适配器
- **路径处理**：自动处理各平台路径分隔符和规范
- **Shell 适配**：自动识别用户 Shell，生成对应激活脚本

---

## 开发规范

### Rust 开发规范

1. **错误处理**：所有函数返回 `Result<T, AppError>` 或模块自定义错误
2. **日志记录**：使用 `app_info!` 等宏，包含 target
3. **事件通知**：长任务必须发送进度事件
4. **安全校验**：所有用户输入必须经过 `security` 模块校验
5. **测试覆盖**：核心功能必须有单元测试
6. **文档注释**：公开函数必须有文档注释

### TypeScript 开发规范

1. **类型安全**：所有 API 调用有明确的类型定义
2. **状态管理**：使用 Zustand，避免 prop drilling
3. **组件设计**：可复用组件放入 `components/ui/`
4. **错误处理**：API 调用必须处理错误，使用通知系统反馈
5. **Mock 数据**：非 Tauri 环境使用 mock 数据，保证浏览器可运行

### 提交规范

使用 Conventional Commits：
- `feat:` 新功能
- `fix:` 修复
- `docs:` 文档
- `style:` 格式
- `refactor:` 重构
- `test:` 测试
- `chore:` 构建/工具

---

## 快速开始

### 开发环境

```bash
# 安装依赖
npm install

# 启动开发模式（前端 + Tauri）
npm run tauri:dev
```

### 构建

```bash
# 前端构建
npm run build

# 桌面应用打包
npm run tauri:build
```

### 测试

```bash
# 前端测试
npm run test

# Rust 测试
cargo test --manifest-path src-tauri/Cargo.toml

# 代码检查
npm run lint
cargo clippy --manifest-path src-tauri/Cargo.toml
```

---

## 相关文档

- [架构文档](./ARCHITECTURE.md)
- [开发指南](./DEVELOPMENT.md)
- [企业部署指南](./ENTERPRISE.md)
- [签名与分发指南](./SIGNING.md)
- [技术选型白皮书](../PyForge-AI-技术选型白皮书.md)
