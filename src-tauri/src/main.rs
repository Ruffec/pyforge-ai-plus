// Prevents additional console window on Windows in release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai;
mod config;
mod error;
mod events;
mod logging;
mod package;
mod platform;
mod project;
mod python;
mod security;
mod venv;

use ai::{AiConfig, AiService, ChatMessage, DeploymentRequest};
use config::{get_config, update_config, AppConfig};
use error::{AppError, AppResult};
use events::{
    cleanup_tasks, get_task, init_app_handle, list_tasks, register_task, update_task,
    TaskProgressEvent, CHANNEL_AI_STREAM,
};
use package::{InstalledPackage, PackageInfo, PipMirror};
use platform::{get_adapter, PlatformAdapter, PlatformInfo};
use project::{ProjectInfo, ProjectScanResult};
use python::{get_python_details, scan_python_versions, set_default_python, PythonInfo};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{Emitter, State};
use venv::{Dependency, VirtualEnvironment};

// ============================================================================
// 基础命令
// ============================================================================

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to PyForge AI.", name)
}

/// 获取应用版本信息。
#[tauri::command]
fn get_app_info() -> serde_json::Value {
    serde_json::json!({
        "name": env!("CARGO_PKG_NAME"),
        "version": env!("CARGO_PKG_VERSION"),
        "description": env!("CARGO_PKG_DESCRIPTION"),
        "authors": env!("CARGO_PKG_AUTHORS"),
    })
}

/// Return a snapshot of the current platform.
#[tauri::command]
fn get_platform_info(adapter: State<Arc<dyn PlatformAdapter>>) -> PlatformInfo {
    adapter.detect()
}

// ============================================================================
// 配置管理命令
// ============================================================================

/// 获取完整应用配置。
#[tauri::command]
fn get_app_config() -> AppResult<AppConfig> {
    get_config()
}

/// 更新应用配置（部分字段）。
#[tauri::command]
fn update_app_config(patch: serde_json::Value) -> AppResult<AppConfig> {
    update_config(|config| {
        if let Ok(patched) = serde_json::from_value::<AppConfig>(patch.clone()) {
            *config = patched;
        } else if let Some(obj) = patch.as_object() {
            // 浅合并顶层字段
            for (key, value) in obj {
                match key.as_str() {
                    "general" => {
                        if let Ok(v) = serde_json::from_value(value.clone()) {
                            config.general = v;
                        }
                    }
                    "python" => {
                        if let Ok(v) = serde_json::from_value(value.clone()) {
                            config.python = v;
                        }
                    }
                    "venv" => {
                        if let Ok(v) = serde_json::from_value(value.clone()) {
                            config.venv = v;
                        }
                    }
                    "package" => {
                        if let Ok(v) = serde_json::from_value(value.clone()) {
                            config.package = v;
                        }
                    }
                    "ai" => {
                        if let Ok(v) = serde_json::from_value(value.clone()) {
                            config.ai = v;
                        }
                    }
                    "logging" => {
                        if let Ok(v) = serde_json::from_value(value.clone()) {
                            config.logging = v;
                        }
                    }
                    "ui" => {
                        if let Ok(v) = serde_json::from_value(value.clone()) {
                            config.ui = v;
                        }
                    }
                    _ => {}
                }
            }
        }
    })
}

/// 重置配置为默认值。
#[tauri::command]
fn reset_app_config() -> AppResult<AppConfig> {
    config::reset_config()
}

// ============================================================================
// 日志管理命令
// ============================================================================

/// 读取最近的日志。
#[tauri::command]
fn read_recent_logs(max_lines: Option<usize>) -> AppResult<Vec<String>> {
    logging::read_recent_logs(max_lines.unwrap_or(200))
}

/// 清理日志文件。
#[tauri::command]
fn clear_logs() -> AppResult<()> {
    logging::clear_logs()
}

/// 获取日志文件路径。
#[tauri::command]
fn get_log_file_path() -> AppResult<String> {
    Ok(logging::current_log_file()?.to_string_lossy().to_string())
}

// ============================================================================
// 任务管理命令
// ============================================================================

/// 获取所有任务列表。
#[tauri::command]
fn list_tasks_command() -> AppResult<Vec<events::TaskInfo>> {
    list_tasks()
}

/// 获取指定任务信息。
#[tauri::command]
fn get_task_command(task_id: String) -> AppResult<Option<events::TaskInfo>> {
    get_task(&task_id)
}

/// 清理已完成任务。
#[tauri::command]
fn cleanup_tasks_command(keep_recent: Option<usize>) -> AppResult<usize> {
    cleanup_tasks(keep_recent.unwrap_or(50))
}

// ============================================================================
// Python 版本管理命令
// ============================================================================

/// 扫描本地所有可识别的 Python 安装。
#[tauri::command]
fn scan_python_versions_command(force_refresh: Option<bool>) -> Vec<PythonInfo> {
    if force_refresh.unwrap_or(false) {
        python::clear_scan_cache();
    }
    let versions = scan_python_versions();
    // 发送扫描完成事件
    let _ = events::emit(events::CHANNEL_PYTHON_SCANNED, &versions);
    versions
}

/// 将指定路径的 Python 设为默认版本。
#[tauri::command]
fn set_default_python_command(path: String) -> AppResult<()> {
    let path = PathBuf::from(path);
    set_default_python(&path)?;
    events::emit_notification(
        "Python 默认版本已更新",
        &format!("已设置默认 Python: {}", path.display()),
        "success",
    )?;
    Ok(())
}

/// 获取指定路径 Python 的详细信息。
#[tauri::command]
fn get_python_details_command(path: String) -> AppResult<PythonInfo> {
    let path = PathBuf::from(path);
    get_python_details(&path).map_err(Into::into)
}

/// 清除 Python 扫描缓存。
#[tauri::command]
fn clear_python_scan_cache() -> AppResult<()> {
    python::clear_scan_cache();
    Ok(())
}

// ============================================================================
// 虚拟环境管理命令
// ============================================================================

#[tauri::command]
fn list_venvs() -> AppResult<Vec<VirtualEnvironment>> {
    let config = get_config().unwrap_or_default();
    let root = PathBuf::from(&config.venv.default_root);
    Ok(venv::list_venvs(&root))
}

#[tauri::command]
async fn create_venv_command(
    name: String,
    python_path: String,
    target_dir: Option<String>,
) -> AppResult<VirtualEnvironment> {
    let task_id = format!("venv-create-{}", uuid_v4());
    register_task(&task_id, "venv_create")?;

    let config = get_config().unwrap_or_default();
    let target = target_dir
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(&config.venv.default_root));

    let python = PathBuf::from(python_path);

    update_task(TaskProgressEvent::started(
        &task_id,
        "venv_create",
        format!("开始创建虚拟环境: {}", name),
    ))?;

    let result = venv::create_venv(&name, &python, &target);

    match result {
        Ok(env) => {
            update_task(TaskProgressEvent::completed(
                &task_id,
                "venv_create",
                format!("虚拟环境 {} 创建成功", name),
            ))?;
            let _ = events::emit(events::CHANNEL_VENV_CHANGED, &serde_json::json!({"action": "created", "env": env}));
            Ok(env)
        }
        Err(e) => {
            let err_msg = e.to_string();
            update_task(TaskProgressEvent::failed(&task_id, "venv_create", &err_msg))?;
            Err(e.into())
        }
    }
}

#[tauri::command]
fn remove_venv_command(path: String) -> AppResult<()> {
    let target = PathBuf::from(&path);
    venv::remove_venv(&target)?;
    let _ = events::emit(events::CHANNEL_VENV_CHANGED, &serde_json::json!({"action": "removed", "path": path}));
    Ok(())
}

#[tauri::command]
fn get_dependencies_command(path: String) -> AppResult<Vec<Dependency>> {
    let target = PathBuf::from(path);
    venv::get_dependencies(&target).map_err(Into::into)
}

/// 克隆虚拟环境。
#[tauri::command]
fn clone_venv_command(source: String, target: String) -> AppResult<VirtualEnvironment> {
    let src = PathBuf::from(source);
    let dst = PathBuf::from(target);
    venv::clone_venv(&src, &dst).map_err(Into::into)
}

/// 导出虚拟环境依赖（requirements.txt 格式）。
#[tauri::command]
fn export_venv_command(path: String) -> AppResult<String> {
    let target = PathBuf::from(path);
    venv::export_venv(&target).map_err(Into::into)
}

/// 获取虚拟环境依赖树。
#[tauri::command]
fn get_dependency_tree_command(path: String) -> AppResult<venv::DependencyNode> {
    let target = PathBuf::from(path);
    venv::get_dependency_tree(&target).map_err(Into::into)
}

// ============================================================================
// 包与镜像源管理命令
// ============================================================================

#[tauri::command]
fn get_mirrors() -> Vec<PipMirror> {
    package::get_default_mirrors()
}

#[tauri::command]
fn get_current_mirror() -> Option<PipMirror> {
    package::get_current_mirror()
}

#[tauri::command]
async fn set_mirror_command(url: String) -> AppResult<()> {
    package::set_mirror(&url).map_err(|e| AppError::from_any(e.as_ref()))?;
    events::emit_notification("镜像源已切换", &format!("当前镜像源: {}", url), "success")?;
    Ok(())
}

#[tauri::command]
async fn test_mirror_speed_command(url: String) -> AppResult<u64> {
    let mirror = PipMirror {
        id: "custom".to_string(),
        name: "Custom".to_string(),
        url,
        latency_ms: 0,
    };
    package::test_mirror_speed(&mirror)
        .await
        .map_err(Into::into)
}

/// 批量测试所有镜像源速度。
#[tauri::command]
async fn test_all_mirrors_speed() -> AppResult<Vec<PipMirror>> {
    use futures::stream::{self, StreamExt};
    let mirrors = package::get_default_mirrors();
    let results: Vec<PipMirror> = stream::iter(mirrors)
        .map(|mut mirror| async move {
            match package::test_mirror_speed(&mirror).await {
                Ok(latency) => {
                    mirror.latency_ms = latency;
                }
                Err(_) => {
                    mirror.latency_ms = u64::MAX;
                }
            }
            mirror
        })
        .buffer_unordered(5)
        .collect()
        .await;
    Ok(results)
}

#[tauri::command]
async fn search_package_command(query: String) -> AppResult<Vec<PackageInfo>> {
    package::search_package(&query).await.map_err(Into::into)
}

#[tauri::command]
async fn list_installed_packages_command(python_path: String) -> AppResult<Vec<InstalledPackage>> {
    package::list_installed_packages(std::path::Path::new(&python_path))
        .await
        .map_err(|e| AppError::from_any(e.as_ref()))
}

/// 在指定虚拟环境中安装包。
#[tauri::command]
async fn install_package_command(
    venv_path: String,
    package_name: String,
    version: Option<String>,
) -> AppResult<String> {
    let task_id = format!("pkg-install-{}", uuid_v4());
    register_task(&task_id, "package_install")?;

    update_task(TaskProgressEvent::started(
        &task_id,
        "package_install",
        format!("开始安装包: {}", package_name),
    ))?;

    let result = package::install_package(
        std::path::Path::new(&venv_path),
        &package_name,
        version.as_deref(),
    )
    .await;

    match result {
        Ok(output) => {
            update_task(TaskProgressEvent::completed(
                &task_id,
                "package_install",
                format!("包 {} 安装成功", package_name),
            ))?;
            Ok(output)
        }
        Err(e) => {
            let err_msg = e.to_string();
            update_task(TaskProgressEvent::failed(&task_id, "package_install", &err_msg))?;
            Err(AppError::from_any(e.as_ref()))
        }
    }
}

/// 在指定虚拟环境中卸载包。
#[tauri::command]
async fn uninstall_package_command(
    venv_path: String,
    package_name: String,
) -> AppResult<String> {
    let task_id = format!("pkg-uninstall-{}", uuid_v4());
    register_task(&task_id, "package_uninstall")?;

    update_task(TaskProgressEvent::started(
        &task_id,
        "package_uninstall",
        format!("开始卸载包: {}", package_name),
    ))?;

    let result = package::uninstall_package(std::path::Path::new(&venv_path), &package_name).await;

    match result {
        Ok(output) => {
            update_task(TaskProgressEvent::completed(
                &task_id,
                "package_uninstall",
                format!("包 {} 卸载成功", package_name),
            ))?;
            Ok(output)
        }
        Err(e) => {
            let err_msg = e.to_string();
            update_task(TaskProgressEvent::failed(&task_id, "package_uninstall", &err_msg))?;
            Err(AppError::from_any(e.as_ref()))
        }
    }
}

/// 批量安装包（从 requirements.txt 内容）。
#[tauri::command]
async fn install_from_requirements_command(
    venv_path: String,
    requirements: String,
) -> AppResult<String> {
    let task_id = format!("pkg-batch-install-{}", uuid_v4());
    register_task(&task_id, "package_batch_install")?;

    update_task(TaskProgressEvent::started(
        &task_id,
        "package_batch_install",
        "开始批量安装依赖",
    ))?;

    let result = package::install_from_requirements(
        std::path::Path::new(&venv_path),
        &requirements,
    )
    .await;

    match result {
        Ok(output) => {
            update_task(TaskProgressEvent::completed(
                &task_id,
                "package_batch_install",
                "批量安装完成",
            ))?;
            Ok(output)
        }
        Err(e) => {
            let err_msg = e.to_string();
            update_task(TaskProgressEvent::failed(&task_id, "package_batch_install", &err_msg))?;
            Err(AppError::from_any(e.as_ref()))
        }
    }
}

/// 升级虚拟环境中所有过时的包。
#[tauri::command]
async fn upgrade_all_packages_command(venv_path: String) -> AppResult<String> {
    let result = package::upgrade_all_packages(std::path::Path::new(&venv_path)).await;
    result.map_err(|e| AppError::from_any(e.as_ref()))
}

/// 检查指定包是否已安装在虚拟环境中。
#[tauri::command]
async fn is_package_installed_command(venv_path: String, package_name: String) -> AppResult<bool> {
    let result = package::is_package_installed(std::path::Path::new(&venv_path), &package_name).await;
    result.map_err(|e| AppError::from_any(e.as_ref()))
}

// ============================================================================
// 安全命令
// ============================================================================

#[tauri::command]
fn validate_path_command(path: String) -> AppResult<()> {
    let path = PathBuf::from(path);
    security::validate_path(&path, &[]).map_err(Into::into)
}

#[tauri::command]
fn sanitize_command_args_command(args: Vec<String>) -> AppResult<Vec<String>> {
    Ok(security::sanitize_command_args(&args))
}

// ============================================================================
// AI 命令
// ============================================================================

#[tauri::command]
async fn generate_deployment_plan(
    request: DeploymentRequest,
    config: AiConfig,
) -> AppResult<ai::DeploymentPlan> {
    let service = AiService::new(config)?;
    service.generate_plan(request).await.map_err(Into::into)
}

#[tauri::command]
async fn chat_message(messages: Vec<ChatMessage>, config: AiConfig) -> AppResult<String> {
    let service = AiService::new(config)?;
    service.complete_chat(messages).await.map_err(Into::into)
}

/// 流式聊天，通过 Tauri 事件逐个推送 token。
///
/// 事件通道：`pyforge://ai/stream`
/// 事件 payload：`{ "type": "chunk" | "done" | "error", "content": string, "task_id": string }`
#[tauri::command]
async fn stream_chat_command(
    messages: Vec<ChatMessage>,
    config: AiConfig,
    app: tauri::AppHandle,
) -> AppResult<String> {
    use futures::StreamExt;

    let task_id = format!("ai-chat-{}", uuid_v4());
    let service = AiService::new(config)?;

    // 发送开始事件
    let _ = app.emit(
        CHANNEL_AI_STREAM,
        serde_json::json!({
            "type": "start",
            "task_id": task_id,
            "content": ""
        }),
    );

    let mut full_content = String::new();

    match service.stream_chat(messages).await {
        Ok(stream) => {
            let mut stream = Box::pin(stream);
            while let Some(chunk) = stream.next().await {
                match chunk {
                    Ok(content) => {
                        full_content.push_str(&content);
                        let _ = app.emit(
                            CHANNEL_AI_STREAM,
                            serde_json::json!({
                                "type": "chunk",
                                "task_id": task_id,
                                "content": content
                            }),
                        );
                    }
                    Err(e) => {
                        let err_msg = e.to_string();
                        let _ = app.emit(
                            CHANNEL_AI_STREAM,
                            serde_json::json!({
                                "type": "error",
                                "task_id": task_id,
                                "content": err_msg
                            }),
                        );
                        return Err(e.into());
                    }
                }
            }

            // 发送完成事件
            let _ = app.emit(
                CHANNEL_AI_STREAM,
                serde_json::json!({
                    "type": "done",
                    "task_id": task_id,
                    "content": full_content
                }),
            );

            Ok(full_content)
        }
        Err(e) => {
            let err_msg = e.to_string();
            let _ = app.emit(
                CHANNEL_AI_STREAM,
                serde_json::json!({
                    "type": "error",
                    "task_id": task_id,
                    "content": err_msg
                }),
            );
            Err(e.into())
        }
    }
}

/// 分析依赖冲突。
#[tauri::command]
async fn analyze_dependencies_command(
    requirements_content: String,
    config: AiConfig,
) -> AppResult<Vec<ai::DependencyConflict>> {
    let service = AiService::new(config)?;
    service
        .analyze_dependencies(&requirements_content)
        .await
        .map_err(Into::into)
}

// ============================================================================
// Python 健康检查与增强命令
// ============================================================================

/// 对指定 Python 执行健康检查。
#[tauri::command]
fn python_health_check(path: String) -> AppResult<python::PythonHealthCheck> {
    let path = PathBuf::from(path);
    Ok(python::health_check(&path))
}

/// 验证 Python 可执行文件是否有效。
#[tauri::command]
fn validate_python_executable(path: String) -> AppResult<()> {
    let path = PathBuf::from(path);
    python::validate_python_executable(&path).map_err(Into::into)
}

/// 获取 Python 相关环境变量信息。
#[tauri::command]
fn get_python_env_info() -> AppResult<python::PythonEnvInfo> {
    Ok(python::get_python_env_info())
}

/// 获取 Python 的 sys.path。
#[tauri::command]
fn get_python_sys_path(path: String) -> AppResult<Vec<String>> {
    let path = PathBuf::from(path);
    python::get_sys_path(&path).map_err(Into::into)
}

/// 获取 Python 标准库模块列表。
#[tauri::command]
fn get_python_stdlib_modules(path: String) -> AppResult<Vec<String>> {
    let path = PathBuf::from(path);
    python::get_stdlib_modules(&path).map_err(Into::into)
}

/// 检查 Python 版本与包的兼容性。
#[tauri::command]
fn check_package_compatibility(
    python_version: String,
    package_name: String,
    required_version: String,
) -> AppResult<python::CompatibilityCheck> {
    let version = python::PythonVersion::parse(&python_version)
        .ok_or_else(|| AppError::new(error::ErrorCode::PythonVersionParse, "无法解析 Python 版本"))?;
    Ok(python::check_compatibility(&version, &package_name, &required_version))
}

// ============================================================================
// 虚拟环境增强命令
// ============================================================================

/// 验证虚拟环境完整性。
#[tauri::command]
fn validate_venv_command(path: String) -> AppResult<venv::VenvValidationResult> {
    let target = PathBuf::from(path);
    venv::validate_venv(&target).map_err(Into::into)
}

/// 修复虚拟环境。
#[tauri::command]
fn repair_venv_command(path: String) -> AppResult<venv::VenvRepairResult> {
    let target = PathBuf::from(path);
    venv::repair_venv(&target).map_err(Into::into)
}

/// 创建虚拟环境快照。
#[tauri::command]
fn create_venv_snapshot_command(
    path: String,
    description: Option<String>,
) -> AppResult<venv::VenvSnapshot> {
    let target = PathBuf::from(path);
    venv::create_snapshot(&target, description).map_err(Into::into)
}

/// 列出所有虚拟环境快照。
#[tauri::command]
fn list_venv_snapshots_command() -> AppResult<Vec<venv::VenvSnapshot>> {
    venv::list_snapshots().map_err(Into::into)
}

/// 从快照恢复虚拟环境依赖。
#[tauri::command]
fn restore_venv_from_snapshot_command(
    snapshot_id: String,
    target_venv: String,
) -> AppResult<String> {
    let target = PathBuf::from(target_venv);
    venv::restore_from_snapshot(&snapshot_id, &target).map_err(Into::into)
}

/// 删除虚拟环境快照。
#[tauri::command]
fn delete_venv_snapshot_command(snapshot_id: String) -> AppResult<()> {
    venv::delete_snapshot(&snapshot_id).map_err(Into::into)
}

/// 导出虚拟环境为可迁移格式。
#[tauri::command]
fn export_venv_portable_command(path: String) -> AppResult<String> {
    let target = PathBuf::from(path);
    venv::export_portable(&target).map_err(Into::into)
}

/// 获取虚拟环境磁盘使用详情。
#[tauri::command]
fn get_venv_disk_usage_command(path: String) -> AppResult<serde_json::Value> {
    let target = PathBuf::from(path);
    venv::get_venv_disk_usage(&target).map_err(Into::into)
}

// ============================================================================
// 项目管理命令
// ============================================================================

/// 扫描目录下的所有 Python 项目。
#[tauri::command]
fn scan_projects_command(root_path: String, max_depth: Option<usize>) -> AppResult<ProjectScanResult> {
    let path = PathBuf::from(root_path);
    project::scan_projects(&path, max_depth.unwrap_or(3)).map_err(Into::into)
}

/// 检测指定目录是否为 Python 项目。
#[tauri::command]
fn detect_project_command(path: String) -> AppResult<Option<ProjectInfo>> {
    let target = PathBuf::from(path);
    project::detect_project(&target).map_err(Into::into)
}

/// 解析 requirements.txt 文件。
#[tauri::command]
fn parse_requirements_command(path: String, is_dev: Option<bool>) -> AppResult<Vec<project::ProjectDependency>> {
    let target = PathBuf::from(path);
    project::parse_requirements_txt(&target, is_dev.unwrap_or(false)).map_err(Into::into)
}

/// 为项目创建关联的虚拟环境。
#[tauri::command]
fn create_project_venv_command(
    project_path: String,
    python_path: String,
    venv_name: Option<String>,
) -> AppResult<VirtualEnvironment> {
    let project = PathBuf::from(project_path);
    let python = PathBuf::from(python_path);
    project::create_project_venv(&project, &python, venv_name.as_deref()).map_err(Into::into)
}

/// 为项目安装依赖。
#[tauri::command]
async fn install_project_dependencies_command(
    project_path: String,
    venv_path: String,
) -> AppResult<String> {
    let project = PathBuf::from(project_path);
    let venv = PathBuf::from(venv_path);
    project::install_project_dependencies(&project, &venv).await
}

/// 导出项目依赖为 requirements.txt 格式。
#[tauri::command]
fn export_project_requirements_command(project_path: String) -> AppResult<String> {
    let project = PathBuf::from(project_path);
    project::export_project_requirements(&project).map_err(Into::into)
}

// ============================================================================
// 辅助函数
// ============================================================================

fn uuid_v4() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let random = {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        let mut hasher = DefaultHasher::new();
        nanos.hash(&mut hasher);
        hasher.finish()
    };
    format!("{:016x}{:016x}", nanos as u64, random)
}

// ============================================================================
// 主函数
// ============================================================================

fn main() {
    // 初始化配置
    if let Err(e) = config::init_config() {
        eprintln!("[WARN] 配置初始化失败: {}", e);
    }

    // 初始化日志
    if let Err(e) = logging::init_logging() {
        eprintln!("[WARN] 日志初始化失败: {}", e);
    }

    let adapter: Arc<dyn PlatformAdapter> = Arc::from(get_adapter());

    tauri::Builder::default()
        .manage(adapter)
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // 初始化事件系统的 AppHandle
            let handle = app.handle().clone();
            if let Err(e) = init_app_handle(&handle) {
                eprintln!("[WARN] 事件系统初始化失败: {}", e);
            }

            app_info!(target: "pyforge_ai", "PyForge AI 启动完成，版本: {}", env!("CARGO_PKG_VERSION"));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // 基础
            greet,
            get_app_info,
            get_platform_info,
            // 配置
            get_app_config,
            update_app_config,
            reset_app_config,
            // 日志
            read_recent_logs,
            clear_logs,
            get_log_file_path,
            // 任务
            list_tasks_command,
            get_task_command,
            cleanup_tasks_command,
            // Python
            scan_python_versions_command,
            set_default_python_command,
            get_python_details_command,
            clear_python_scan_cache,
            python_health_check,
            validate_python_executable,
            get_python_env_info,
            get_python_sys_path,
            get_python_stdlib_modules,
            check_package_compatibility,
            // 虚拟环境
            list_venvs,
            create_venv_command,
            remove_venv_command,
            get_dependencies_command,
            clone_venv_command,
            export_venv_command,
            get_dependency_tree_command,
            validate_venv_command,
            repair_venv_command,
            create_venv_snapshot_command,
            list_venv_snapshots_command,
            restore_venv_from_snapshot_command,
            delete_venv_snapshot_command,
            export_venv_portable_command,
            get_venv_disk_usage_command,
            // 包与镜像
            get_mirrors,
            get_current_mirror,
            set_mirror_command,
            test_mirror_speed_command,
            test_all_mirrors_speed,
            search_package_command,
            list_installed_packages_command,
            install_package_command,
            uninstall_package_command,
            install_from_requirements_command,
            upgrade_all_packages_command,
            is_package_installed_command,
            // 项目管理
            scan_projects_command,
            detect_project_command,
            parse_requirements_command,
            create_project_venv_command,
            install_project_dependencies_command,
            export_project_requirements_command,
            // 安全
            validate_path_command,
            sanitize_command_args_command,
            // AI
            generate_deployment_plan,
            chat_message,
            stream_chat_command,
            analyze_dependencies_command,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
