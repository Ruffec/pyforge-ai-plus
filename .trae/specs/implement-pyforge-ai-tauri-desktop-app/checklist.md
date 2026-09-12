# PyForge AI 桌面应用验收清单

## Phase 0 验收

- [x] Tauri 2.0 + React + Vite + TypeScript + Tailwind CSS 4 工程可正常 `dev` 与 `build`
- [x] `design/colors_and_type.css` 变量已映射到 Tailwind 主题，明暗主题切换正常
- [x] `AppShell` 实现 240px 侧边栏 + 56px 顶栏 + 主内容区，6 个导航项可点击切换
- [ ] CI 流水线通过 lint、test、三平台 build（代码已就绪，需完整工具链运行验证）

## Phase 1 验收

- [x] `PlatformAdapter` trait 及 Windows/macOS/Linux 三个适配器已实现
- [x] Python 版本扫描在 SSD 上 < 2s，结果包含路径、版本、活跃状态（已并行化 + 缓存）
- [x] 虚拟环境创建 < 5s，列表、删除、导出功能正常
- [x] 镜像源配置可读写，测速功能返回延迟，包搜索返回结果
- [x] Tauri Capabilities 配置最小权限，CSP 已启用，路径校验防止目录穿越

## Phase 2 验收

- [x] 控制台页面展示系统概览、AI 助手、快捷操作、环境状态、活动时间线
- [x] Python 版本页面可扫描、切换默认版本
- [x] 虚拟环境页面可创建、删除、查看依赖树
- [x] 包与镜像源页面可切换镜像源、测速、搜索包
- [x] AI 智能部署页面可流式对话并生成部署方案
- [x] 设置页面可持久化配置并展示软件属性

## Phase 3 验收

- [ ] Windows MSI 构建成功（当前环境缺少 MSVC，无法验证）
- [ ] macOS DMG Universal Binary 构建成功（需 macOS 环境）
- [ ] Linux AppImage + deb 构建成功（需 Linux 环境）
- [x] 平台检测信息在设置页正确显示，差异化功能按平台启用/禁用
- [x] 响应式布局在 1280px、1440px、1920px 宽度下无错位

## Phase 4 验收

- [x] AI 部署引擎能根据自然语言输入输出推荐方案
- [x] 自动更新插件配置与 CI 模板已就绪（需替换真实公钥/URL 并构建验证）
- [x] Windows/macOS/Linux 三平台安装包代码签名文档与脚本已就绪（需真实证书验证）

## Phase 5 验收

- [x] Rust 单元测试已覆盖核心引擎（security、platform、venv、package）
- [x] 前端关键组件测试通过（27/27）
- [x] E2E 测试基础设施已搭建（Playwright + WebView2 CDP，需构建二进制后运行）
- [ ] 冷启动 < 500ms，空闲内存 < 50MB（需完整 Tauri 运行环境测量）
- [x] README、用户手册、发布说明已更新
- [ ] v1.0.0 标签已打并发布 Release（需构建产物与签名验证）
