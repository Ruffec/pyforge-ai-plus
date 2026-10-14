//! HTTP 桥接服务模块
//!
//! 桌面端启动时在本机回环地址开启轻量 HTTP 服务，作为「网页端」的真实数据源：
//! - `POST /api/rpc`   ：将网页端请求转发到与 Tauri IPC 完全相同的命令实现（真实数据源唯一）；
//! - `GET  /api/events`：SSE 事件流，转发后端事件总线（跨端数据变更实时同步）；
//! - `GET  /api/health`：连通性探测；
//! - 其余路径          ：尽力提供 `dist/` 静态资源（开发/自托管网页端）。
//!
//! 安全边界：仅绑定 127.0.0.1，不对局域网暴露；端口可用环境变量
//! `PYFORGE_BRIDGE_PORT` 覆盖（默认 21880）。

#![allow(dead_code)]

use crate::error::{AppError, AppResult, ErrorCode};
use crate::platform::{PlatformAdapter, PlatformInfo};
use axum::extract::rejection::JsonRejection;
use axum::extract::{Request, State};
use axum::http::{header, HeaderValue, Method, StatusCode};
use axum::middleware::{self, Next};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use futures::stream::Stream;
use serde_json::{json, Value};
use std::convert::Infallible;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::Manager;

/// 默认桥接端口。
pub const DEFAULT_BRIDGE_PORT: u16 = 21880;

type SharedApp = Arc<tauri::AppHandle>;

// ============================================================================
// 服务启动
// ============================================================================

/// 启动 HTTP 桥接服务（在 Tauri setup 中调用，后台运行不阻塞窗口）。
pub fn start_bridge(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let port = std::env::var("PYFORGE_BRIDGE_PORT")
            .ok()
            .and_then(|p| p.parse::<u16>().ok())
            .unwrap_or(DEFAULT_BRIDGE_PORT);

        let state: SharedApp = Arc::new(app);
        let router = Router::new()
            .route("/api/health", get(health))
            .route("/api/rpc", post(rpc_entry))
            .route("/api/events", get(events_sse))
            .fallback(static_fallback)
            .layer(middleware::from_fn(cors_middleware))
            .with_state(state.clone());

        let addr = SocketAddr::from(([127, 0, 0, 1], port));
        match tokio::net::TcpListener::bind(addr).await {
            Ok(listener) => {
                crate::app_info!(
                    target: "pyforge_ai",
                    "HTTP 桥接服务已启动: http://{}",
                    addr
                );
                let _ = crate::events::emit_notification(
                    "网页端桥接服务已就绪",
                    &format!("浏览器访问 http://{} 即可连接同一数据源", addr),
                    "info",
                );
                if let Err(e) = axum::serve(listener, router).await {
                    eprintln!("[WARN] HTTP 桥接服务异常退出: {}", e);
                }
            }
            Err(e) => {
                eprintln!(
                    "[WARN] HTTP 桥接服务启动失败（端口 {} 可能被占用）: {}",
                    port, e
                );
            }
        }
    });
}

// ============================================================================
// 处理器
// ============================================================================

async fn health() -> Json<Value> {
    Json(json!({
        "status": "ok",
        "app": "pyforge-ai",
        "version": env!("CARGO_PKG_VERSION"),
    }))
}

#[derive(serde::Deserialize)]
struct RpcRequest {
    command: String,
    #[serde(default)]
    args: Value,
}

async fn rpc_entry(
    State(app): State<SharedApp>,
    body: Result<Json<RpcRequest>, JsonRejection>,
) -> Response {
    let Json(req) = match body {
        Ok(v) => v,
        Err(rej) => {
            return error_response(
                &AppError::new(ErrorCode::Unknown, format!("请求体解析失败: {}", rej.body_text())),
            );
        }
    };

    match handle_rpc(&req.command, req.args, (*app).clone()).await {
        Ok(data) => {
            tracing::debug!(target: "pyforge_ai::bridge", "RPC → {}: ok", req.command);
            (StatusCode::OK, Json(json!({ "ok": true, "data": data }))).into_response()
        }
        Err(err) => {
            tracing::error!(
                target: "pyforge_ai::bridge",
                "RPC → {}: 失败 [{}] {}",
                req.command,
                err.code.status_code(),
                err.message
            );
            error_response(&err)
        }
    }
}

fn error_response(err: &AppError) -> Response {
    let status = StatusCode::from_u16(err.code.status_code()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    let payload = json!({
        "ok": false,
        "error": {
            "code": err.code,
            "message": err.message,
            "status_code": err.code.status_code(),
        }
    });
    (status, Json(payload)).into_response()
}

/// SSE 事件流：订阅事件总线，向网页端推送所有后端事件（跨端实时同步）。
async fn events_sse() -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    use futures::stream;
    let rx = crate::events::subscribe_bus();
    let stream = stream::unfold(rx, |mut rx| async move {
        loop {
            match rx.recv().await {
                Ok(msg) => return Some((Ok(Event::default().data(msg)), rx)),
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => return None,
            }
        }
    });
    Sse::new(stream).keep_alive(KeepAlive::default())
}

/// CORS 中间件：桥接服务仅监听回环地址，网页端可能来自任意本地源
/// （vite dev 1420 / 桥接自托管 / 其他本地端口），这里放开跨域头。
async fn cors_middleware(req: Request, next: Next) -> Response {
    // 浏览器跨域预检：axum 路由不会自动应答 OPTIONS（会得到 405 导致
    // 预检失败、后续 fetch 全部 net::ERR_FAILED），因此在此短路返回。
    if req.method() == Method::OPTIONS {
        let mut resp = Response::new(axum::body::Body::empty());
        *resp.status_mut() = StatusCode::NO_CONTENT;
        let headers = resp.headers_mut();
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_ORIGIN,
            HeaderValue::from_static("*"),
        );
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_METHODS,
            HeaderValue::from_static("GET, POST, OPTIONS"),
        );
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_HEADERS,
            HeaderValue::from_static("Content-Type"),
        );
        headers.insert(
            header::ACCESS_CONTROL_MAX_AGE,
            HeaderValue::from_static("86400"),
        );
        return resp;
    }

    let mut resp = next.run(req).await;
    let headers = resp.headers_mut();
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, POST, OPTIONS"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("Content-Type"),
    );
    resp
}

// ============================================================================
// 静态资源（尽力而为：存在 dist 目录时提供网页端自托管）
// ============================================================================

fn dist_dir() -> Option<PathBuf> {
    for candidate in ["dist", "../dist", "../../dist"] {
        let p = PathBuf::from(candidate);
        if p.join("index.html").exists() {
            return Some(p);
        }
    }
    None
}

fn mime_by_ext(ext: &str) -> &'static str {
    match ext {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

async fn static_fallback(uri: axum::http::Uri) -> Response {
    let Some(dist) = dist_dir() else {
        return (
            StatusCode::NOT_FOUND,
            "静态资源未构建：网页端请使用 `npm run dev` 访问，或先执行 `npm run build`",
        )
            .into_response();
    };

    let raw_path = percent_decode(uri.path());
    let raw_path = raw_path.trim_start_matches('/');
    if raw_path.split(['/', '\\']).any(|seg| seg == "..") {
        return (StatusCode::BAD_REQUEST, "非法路径").into_response();
    }

    let rel = if raw_path.is_empty() { "index.html" } else { raw_path };
    let file_path = dist.join(rel);
    let file_path = if file_path.is_file() {
        file_path
    } else {
        // SPA 路由回退
        dist.join("index.html")
    };

    match tokio::fs::read(&file_path).await {
        Ok(bytes) => {
            let mime = file_path
                .extension()
                .and_then(|e| e.to_str())
                .map(mime_by_ext)
                .unwrap_or("application/octet-stream");
            (
                StatusCode::OK,
                [(header::CONTENT_TYPE, mime)],
                bytes,
            )
                .into_response()
        }
        Err(_) => (StatusCode::NOT_FOUND, "资源不存在").into_response(),
    }
}

fn percent_decode(s: &str) -> String {
    let mut out = Vec::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

// ============================================================================
// RPC 分发器：与 Tauri IPC 命令共用同一套实现（真实数据源唯一）
// ============================================================================

fn arg<'a>(args: &'a Value, snake: &str) -> Option<&'a Value> {
    if let Some(v) = args.get(snake) {
        return Some(v);
    }
    // 兼容前端 camelCase 参数名（与 Tauri IPC 行为一致）
    let mut camel = String::with_capacity(snake.len());
    let mut upper = false;
    for ch in snake.chars() {
        if ch == '_' {
            upper = true;
        } else if upper {
            camel.extend(ch.to_uppercase());
            upper = false;
        } else {
            camel.push(ch);
        }
    }
    args.get(camel.as_str())
}

fn arg_str(args: &Value, name: &str) -> AppResult<String> {
    arg(args, name)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| AppError::new(ErrorCode::Unknown, format!("缺少参数: {name}")))
}

fn arg_opt_str(args: &Value, name: &str) -> Option<String> {
    arg(args, name).and_then(|v| v.as_str()).map(String::from)
}

fn arg_opt_bool(args: &Value, name: &str) -> Option<bool> {
    arg(args, name).and_then(|v| v.as_bool())
}

fn arg_opt_usize(args: &Value, name: &str) -> Option<usize> {
    arg(args, name).and_then(|v| v.as_u64()).map(|v| v as usize)
}

fn arg_value(args: &Value, name: &str) -> Value {
    arg(args, name).cloned().unwrap_or(Value::Null)
}

fn arg_str_vec(args: &Value, name: &str) -> Vec<String> {
    arg(args, name)
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

fn to_json<T: serde::Serialize>(v: T) -> AppResult<Value> {
    serde_json::to_value(v).map_err(Into::into)
}

/// 分发到与 `#[tauri::command]` 完全相同的实现函数。
async fn handle_rpc(command: &str, args: Value, app: tauri::AppHandle) -> AppResult<Value> {
    match command {
        // 基础
        "greet" => to_json(crate::greet(&arg_str(&args, "name")?)),
        "get_app_info" => to_json(crate::get_app_info()),
        "get_platform_info" => {
            let adapter = app.state::<Arc<dyn PlatformAdapter>>();
            let info: PlatformInfo = adapter.detect();
            to_json(info)
        }
        // 配置
        "get_app_config" => to_json(crate::get_app_config()?),
        "update_app_config" => {
            to_json(crate::update_app_config(arg_value(&args, "patch"))?)
        }
        "reset_app_config" => to_json(crate::reset_app_config()?),
        // 日志
        "read_recent_logs" => {
            to_json(crate::read_recent_logs(arg_opt_usize(&args, "max_lines"))?)
        }
        "clear_logs" => to_json(crate::clear_logs()?),
        "get_log_file_path" => to_json(crate::get_log_file_path()?),
        "set_log_dir" => to_json(crate::set_log_dir(arg_str(&args, "new_dir")?)?),
        "get_violations" => to_json(crate::get_violations()),
        "export_violations_excel" => to_json(crate::export_violations_excel()?),
        "get_violations_dir" => to_json(crate::get_violations_dir()?),
        "frontend_log_command" => {
            to_json(crate::frontend_log_command(
                arg_str(&args, "level")?,
                arg_str(&args, "message")?,
                arg_opt_str(&args, "target"),
            )?)
        }
        // 平台路径
        "get_platform_default_paths" => to_json(crate::get_platform_default_paths()?),
        // 任务
        "list_tasks_command" => to_json(crate::list_tasks_command()?),
        "get_task_command" => to_json(crate::get_task_command(arg_str(&args, "task_id")?)?),
        "cleanup_tasks_command" => {
            to_json(crate::cleanup_tasks_command(arg_opt_usize(&args, "keep_recent"))?)
        }
        // Python
        "scan_python_versions_command" => to_json(crate::scan_python_versions_command(
            arg_opt_bool(&args, "force_refresh"),
        )),
        "set_default_python_command" => {
            to_json(crate::set_default_python_command(arg_str(&args, "path")?)?)
        }
        "get_python_details_command" => {
            to_json(crate::get_python_details_command(arg_str(&args, "path")?)?)
        }
        "clear_python_scan_cache" => to_json(crate::clear_python_scan_cache()?),
        "python_health_check" => to_json(crate::python_health_check(arg_str(&args, "path")?)?),
        "validate_python_executable" => {
            to_json(crate::validate_python_executable(arg_str(&args, "path")?)?)
        }
        "get_python_env_info" => to_json(crate::get_python_env_info()?),
        "get_python_sys_path" => to_json(crate::get_python_sys_path(arg_str(&args, "path")?)?),
        "get_python_stdlib_modules" => {
            to_json(crate::get_python_stdlib_modules(arg_str(&args, "path")?)?)
        }
        "check_package_compatibility" => to_json(crate::check_package_compatibility(
            arg_str(&args, "python_version")?,
            arg_str(&args, "package_name")?,
            arg_str(&args, "required_version")?,
        )?),
        "fetch_python_org_releases_command" => {
            to_json(crate::fetch_python_org_releases_command().await?)
        }
        "install_python_command" => to_json(
            crate::install_python_command(
                arg_str(&args, "version")?,
                arg_opt_str(&args, "arch"),
                arg_opt_str(&args, "install_dir"),
                arg_opt_bool(&args, "all_users"),
                arg_opt_bool(&args, "prepend_path"),
            )
            .await?,
        ),
        "uninstall_python_version_command" => to_json(
            crate::uninstall_python_version_command(
                arg_str(&args, "path")?,
                arg_opt_bool(&args, "remove_env"),
                arg_opt_bool(&args, "remove_registry"),
                arg_opt_bool(&args, "force"),
            )
            .await?,
        ),
        "validate_install_dir_command" => {
            to_json(crate::validate_install_dir_command(arg_str(&args, "path")?)?)
        }
        // 虚拟环境
        "list_venvs" => to_json(crate::list_venvs()?),
        "create_venv_command" => {
            to_json(
                crate::create_venv_command(
                    arg_str(&args, "name")?,
                    arg_str(&args, "python_path")?,
                    arg_opt_str(&args, "target_dir"),
                )
                .await?,
            )
        }
        "remove_venv_command" => to_json(crate::remove_venv_command(arg_str(&args, "path")?)?),
        "get_dependencies_command" => {
            to_json(crate::get_dependencies_command(arg_str(&args, "path")?)?)
        }
        "clone_venv_command" => to_json(crate::clone_venv_command(
            arg_str(&args, "source")?,
            arg_str(&args, "target")?,
        )?),
        "export_venv_command" => to_json(crate::export_venv_command(arg_str(&args, "path")?)?),
        "get_dependency_tree_command" => {
            to_json(crate::get_dependency_tree_command(arg_str(&args, "path")?)?)
        }
        "validate_venv_command" => to_json(crate::validate_venv_command(arg_str(&args, "path")?)?),
        "repair_venv_command" => to_json(crate::repair_venv_command(arg_str(&args, "path")?)?),
        "create_venv_snapshot_command" => to_json(crate::create_venv_snapshot_command(
            arg_str(&args, "path")?,
            arg_opt_str(&args, "description"),
        )?),
        "list_venv_snapshots_command" => to_json(crate::list_venv_snapshots_command()?),
        "restore_venv_from_snapshot_command" => to_json(crate::restore_venv_from_snapshot_command(
            arg_str(&args, "snapshot_id")?,
            arg_str(&args, "target_venv")?,
        )?),
        "delete_venv_snapshot_command" => {
            to_json(crate::delete_venv_snapshot_command(arg_str(&args, "snapshot_id")?)?)
        }
        "export_venv_portable_command" => {
            to_json(crate::export_venv_portable_command(arg_str(&args, "path")?)?)
        }
        "get_venv_disk_usage_command" => {
            to_json(crate::get_venv_disk_usage_command(arg_str(&args, "path")?)?)
        }
        // 包与镜像
        "get_mirrors" => to_json(crate::get_mirrors()),
        "get_current_mirror" => to_json(crate::get_current_mirror()),
        "set_mirror_command" => to_json(crate::set_mirror_command(arg_str(&args, "url")?).await?),
        "test_mirror_speed_command" => {
            to_json(crate::test_mirror_speed_command(arg_str(&args, "url")?).await?)
        }
        "test_all_mirrors_speed" => to_json(crate::test_all_mirrors_speed().await?),
        "search_package_command" => {
            to_json(crate::search_package_command(arg_str(&args, "query")?).await?)
        }
        "list_installed_packages_command" => {
            to_json(crate::list_installed_packages_command(arg_str(&args, "python_path")?).await?)
        }
        "install_package_command" => {
            to_json(
                crate::install_package_command(
                    arg_str(&args, "venv_path")?,
                    arg_str(&args, "package_name")?,
                    arg_opt_str(&args, "version"),
                )
                .await?,
            )
        }
        "uninstall_package_command" => {
            to_json(
                crate::uninstall_package_command(
                    arg_str(&args, "venv_path")?,
                    arg_str(&args, "package_name")?,
                )
                .await?,
            )
        }
        "upgrade_pip_command" => {
            to_json(crate::upgrade_pip_command(arg_str(&args, "python_path")?).await?)
        }
        "install_from_requirements_command" => {
            to_json(
                crate::install_from_requirements_command(
                    arg_str(&args, "venv_path")?,
                    arg_str(&args, "requirements")?,
                )
                .await?,
            )
        }
        "upgrade_all_packages_command" => {
            to_json(crate::upgrade_all_packages_command(arg_str(&args, "venv_path")?).await?)
        }
        "is_package_installed_command" => {
            to_json(
                crate::is_package_installed_command(
                    arg_str(&args, "venv_path")?,
                    arg_str(&args, "package_name")?,
                )
                .await?,
            )
        }
        // 项目管理
        "scan_projects_command" => to_json(crate::scan_projects_command(
            arg_str(&args, "root_path")?,
            arg_opt_usize(&args, "max_depth"),
        )?),
        "detect_project_command" => to_json(crate::detect_project_command(arg_str(&args, "path")?)?),
        "parse_requirements_command" => to_json(crate::parse_requirements_command(
            arg_str(&args, "path")?,
            arg_opt_bool(&args, "is_dev"),
        )?),
        "create_project_venv_command" => to_json(crate::create_project_venv_command(
            arg_str(&args, "project_path")?,
            arg_str(&args, "python_path")?,
            arg_opt_str(&args, "venv_name"),
        )?),
        "install_project_dependencies_command" => {
            to_json(
                crate::install_project_dependencies_command(
                    arg_str(&args, "project_path")?,
                    arg_str(&args, "venv_path")?,
                )
                .await?,
            )
        }
        "export_project_requirements_command" => {
            to_json(crate::export_project_requirements_command(arg_str(&args, "project_path")?)?)
        }
        // 安全
        "validate_path_command" => to_json(crate::validate_path_command(arg_str(&args, "path")?)?),
        "sanitize_command_args_command" => {
            to_json(crate::sanitize_command_args_command(arg_str_vec(&args, "args"))?)
        }
        // AI
        "generate_deployment_plan" => {
            let request = arg_value(&args, "request");
            let config = arg_value(&args, "config");
            let request: crate::ai::DeploymentRequest =
                serde_json::from_value(request).map_err(AppError::from)?;
            let config: crate::ai::AiConfig =
                serde_json::from_value(config).map_err(AppError::from)?;
            to_json(crate::generate_deployment_plan(request, config).await?)
        }
        "chat_message" => {
            let messages = arg_value(&args, "messages");
            let config = arg_value(&args, "config");
            let messages: Vec<crate::ai::ChatMessage> =
                serde_json::from_value(messages).map_err(AppError::from)?;
            let config: crate::ai::AiConfig =
                serde_json::from_value(config).map_err(AppError::from)?;
            to_json(crate::chat_message(messages, config).await?)
        }
        "stream_chat_command" => {
            let messages = arg_value(&args, "messages");
            let config = arg_value(&args, "config");
            let messages: Vec<crate::ai::ChatMessage> =
                serde_json::from_value(messages).map_err(AppError::from)?;
            let config: crate::ai::AiConfig =
                serde_json::from_value(config).map_err(AppError::from)?;
            to_json(crate::stream_chat_command(messages, config, app).await?)
        }
        "analyze_dependencies_command" => {
            let config = arg_value(&args, "config");
            let config: crate::ai::AiConfig =
                serde_json::from_value(config).map_err(AppError::from)?;
            to_json(
                crate::analyze_dependencies_command(arg_str(&args, "requirements_content")?, config)
                    .await?,
            )
        }
        _ => Err(AppError::new(
            ErrorCode::Unknown,
            format!("未知命令: {command}"),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arg_supports_snake_and_camel() {
        let args = json!({ "pythonPath": "/usr/bin/python", "other_key": 1 });
        assert_eq!(arg(&args, "python_path").unwrap(), "/usr/bin/python");
        assert_eq!(arg(&args, "other_key").unwrap(), 1);
        assert!(arg(&args, "missing").is_none());
    }

    #[test]
    fn arg_str_reports_missing_param() {
        let err = arg_str(&json!({}), "venv_path").unwrap_err();
        assert!(err.message.contains("venv_path"));
    }

    #[test]
    fn arg_helpers_parse_optionals() {
        let args = json!({ "forceRefresh": true, "maxDepth": 3, "keep_recent": 7 });
        assert_eq!(arg_opt_bool(&args, "force_refresh"), Some(true));
        assert_eq!(arg_opt_usize(&args, "max_depth"), Some(3));
        assert_eq!(arg_opt_usize(&args, "keep_recent"), Some(7));
        assert_eq!(arg_opt_bool(&args, "none"), None);
    }

    #[test]
    fn arg_str_vec_parses_list() {
        let args = json!({ "args": ["a", "b"] });
        assert_eq!(arg_str_vec(&args, "args"), vec!["a".to_string(), "b".to_string()]);
    }

    #[test]
    fn percent_decode_basic() {
        assert_eq!(percent_decode("/a%20b"), "/a b");
        assert_eq!(percent_decode("/plain"), "/plain");
    }
}
