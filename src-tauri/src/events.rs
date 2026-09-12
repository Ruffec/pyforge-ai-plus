//! 事件总线模块
//!
//! 提供应用内事件发布/订阅机制，用于长任务进度通知、状态更新、
//! 日志推送等场景。基于 Tauri 的事件系统，前端可通过 `listen` 接收。
//! 所有公共 API 均预留，供未来模块扩展使用。

#![allow(dead_code)]

use crate::error::{AppError, AppResult, ErrorCode};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use once_cell::sync::OnceCell;

/// 全局 AppHandle 引用，用于在非 Tauri 上下文中发送事件。
static APP_HANDLE: OnceCell<AppHandle> = OnceCell::new();

/// 初始化全局 AppHandle。
pub fn init_app_handle(app: &AppHandle) -> AppResult<()> {
    APP_HANDLE
        .set(app.clone())
        .map_err(|_| AppError::new(ErrorCode::ConfigError, "AppHandle 已初始化，无法重复设置"))
}

/// 获取全局 AppHandle。
fn get_handle() -> AppResult<AppHandle> {
    APP_HANDLE
        .get()
        .cloned()
        .ok_or_else(|| AppError::new(ErrorCode::ConfigError, "AppHandle 未初始化"))
}

// ============================================================================
// 事件类型定义
// ============================================================================

/// 任务状态。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    /// 任务已创建，等待执行
    Pending,
    /// 任务正在执行
    Running,
    /// 任务执行成功
    Completed,
    /// 任务执行失败
    Failed,
    /// 任务被取消
    Cancelled,
}

/// 任务进度事件。
#[derive(Debug, Clone, Serialize)]
pub struct TaskProgressEvent {
    /// 任务唯一 ID
    pub task_id: String,
    /// 任务类型（如 "venv_create"、"package_install"）
    pub task_type: String,
    /// 当前状态
    pub status: TaskStatus,
    /// 进度百分比（0-100）
    pub progress: u8,
    /// 当前阶段描述
    pub message: String,
    /// 可选的详细数据
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
    /// 错误信息（仅失败时）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// 时间戳（毫秒）
    pub timestamp: u64,
}

impl TaskProgressEvent {
    /// 创建进度更新事件。
    pub fn progress(
        task_id: impl Into<String>,
        task_type: impl Into<String>,
        progress: u8,
        message: impl Into<String>,
    ) -> Self {
        Self {
            task_id: task_id.into(),
            task_type: task_type.into(),
            status: TaskStatus::Running,
            progress: progress.min(100),
            message: message.into(),
            data: None,
            error: None,
            timestamp: current_timestamp(),
        }
    }

    /// 创建任务开始事件。
    pub fn started(task_id: impl Into<String>, task_type: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            task_id: task_id.into(),
            task_type: task_type.into(),
            status: TaskStatus::Running,
            progress: 0,
            message: message.into(),
            data: None,
            error: None,
            timestamp: current_timestamp(),
        }
    }

    /// 创建任务完成事件。
    pub fn completed(task_id: impl Into<String>, task_type: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            task_id: task_id.into(),
            task_type: task_type.into(),
            status: TaskStatus::Completed,
            progress: 100,
            message: message.into(),
            data: None,
            error: None,
            timestamp: current_timestamp(),
        }
    }

    /// 创建任务失败事件。
    pub fn failed(
        task_id: impl Into<String>,
        task_type: impl Into<String>,
        error: impl Into<String>,
    ) -> Self {
        Self {
            task_id: task_id.into(),
            task_type: task_type.into(),
            status: TaskStatus::Failed,
            progress: 0,
            message: "任务执行失败".to_string(),
            data: None,
            error: Some(error.into()),
            timestamp: current_timestamp(),
        }
    }

    /// 附带额外数据。
    pub fn with_data(mut self, data: serde_json::Value) -> Self {
        self.data = Some(data);
        self
    }
}

/// 日志推送事件。
#[derive(Debug, Clone, Serialize)]
pub struct LogEvent {
    pub level: String,
    pub message: String,
    pub target: String,
    pub timestamp: u64,
}

/// 系统通知事件。
#[derive(Debug, Clone, Serialize)]
pub struct NotificationEvent {
    pub id: String,
    pub title: String,
    pub message: String,
    pub notification_type: String,
    pub timestamp: u64,
}

// ============================================================================
// 事件通道常量
// ============================================================================

/// 任务进度事件通道。
pub const CHANNEL_TASK_PROGRESS: &str = "pyforge://task/progress";
/// 日志事件通道。
pub const CHANNEL_LOG: &str = "pyforge://log";
/// 系统通知通道。
pub const CHANNEL_NOTIFICATION: &str = "pyforge://notification";
/// Python 扫描完成通道。
pub const CHANNEL_PYTHON_SCANNED: &str = "pyforge://python/scanned";
/// 虚拟环境变更通道。
pub const CHANNEL_VENV_CHANGED: &str = "pyforge://venv/changed";
/// 包安装进度通道。
pub const CHANNEL_PACKAGE_PROGRESS: &str = "pyforge://package/progress";
/// AI 流式输出通道。
pub const CHANNEL_AI_STREAM: &str = "pyforge://ai/stream";

// ============================================================================
// 事件发布函数
// ============================================================================

/// 发布任务进度事件。
pub fn emit_task_progress(event: TaskProgressEvent) -> AppResult<()> {
    let handle = get_handle()?;
    handle
        .emit(CHANNEL_TASK_PROGRESS, &event)
        .map_err(|e| AppError::new(ErrorCode::IoError, format!("发送任务进度事件失败: {e}")))?;
    Ok(())
}

/// 发布日志事件。
pub fn emit_log(level: &str, message: &str, target: &str) -> AppResult<()> {
    let event = LogEvent {
        level: level.to_string(),
        message: message.to_string(),
        target: target.to_string(),
        timestamp: current_timestamp(),
    };
    let handle = get_handle()?;
    handle
        .emit(CHANNEL_LOG, &event)
        .map_err(|e| AppError::new(ErrorCode::IoError, format!("发送日志事件失败: {e}")))?;
    Ok(())
}

/// 发布系统通知。
pub fn emit_notification(
    title: impl Into<String>,
    message: impl Into<String>,
    notification_type: impl Into<String>,
) -> AppResult<()> {
    let event = NotificationEvent {
        id: uuid_v4(),
        title: title.into(),
        message: message.into(),
        notification_type: notification_type.into(),
        timestamp: current_timestamp(),
    };
    let handle = get_handle()?;
    handle
        .emit(CHANNEL_NOTIFICATION, &event)
        .map_err(|e| AppError::new(ErrorCode::IoError, format!("发送通知事件失败: {e}")))?;
    Ok(())
}

/// 发布通用事件。
pub fn emit<T: Serialize + Clone>(channel: &str, payload: &T) -> AppResult<()> {
    let handle = get_handle()?;
    handle
        .emit(channel, payload)
        .map_err(|e| AppError::new(ErrorCode::IoError, format!("发送事件失败: {e}")))?;
    Ok(())
}

// ============================================================================
// 任务管理器（简化版）
// ============================================================================

use std::collections::HashMap;
use std::sync::Mutex;

static TASK_REGISTRY: OnceCell<Mutex<HashMap<String, TaskInfo>>> = OnceCell::new();

/// 任务信息。
#[derive(Debug, Clone, Serialize)]
pub struct TaskInfo {
    pub id: String,
    pub task_type: String,
    pub status: TaskStatus,
    pub progress: u8,
    pub message: String,
    pub created_at: u64,
    pub updated_at: u64,
}

fn task_registry() -> &'static Mutex<HashMap<String, TaskInfo>> {
    TASK_REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 注册新任务。
pub fn register_task(task_id: &str, task_type: &str) -> AppResult<()> {
    let now = current_timestamp();
    let info = TaskInfo {
        id: task_id.to_string(),
        task_type: task_type.to_string(),
        status: TaskStatus::Pending,
        progress: 0,
        message: "任务已创建".to_string(),
        created_at: now,
        updated_at: now,
    };

    let mut registry = task_registry()
        .lock()
        .map_err(|_| AppError::new(ErrorCode::ConfigError, "任务注册表锁获取失败"))?;
    registry.insert(task_id.to_string(), info);
    Ok(())
}

/// 更新任务状态并发送事件。
pub fn update_task(event: TaskProgressEvent) -> AppResult<()> {
    {
        let mut registry = task_registry()
            .lock()
            .map_err(|_| AppError::new(ErrorCode::ConfigError, "任务注册表锁获取失败"))?;
        if let Some(info) = registry.get_mut(&event.task_id) {
            info.status = event.status.clone();
            info.progress = event.progress;
            info.message = event.message.clone();
            info.updated_at = event.timestamp;
        }
    }
    emit_task_progress(event)?;
    Ok(())
}

/// 获取任务信息。
pub fn get_task(task_id: &str) -> AppResult<Option<TaskInfo>> {
    let registry = task_registry()
        .lock()
        .map_err(|_| AppError::new(ErrorCode::ConfigError, "任务注册表锁获取失败"))?;
    Ok(registry.get(task_id).cloned())
}

/// 获取所有任务。
pub fn list_tasks() -> AppResult<Vec<TaskInfo>> {
    let registry = task_registry()
        .lock()
        .map_err(|_| AppError::new(ErrorCode::ConfigError, "任务注册表锁获取失败"))?;
    let mut tasks: Vec<TaskInfo> = registry.values().cloned().collect();
    tasks.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(tasks)
}

/// 清理已完成的任务（保留最近 N 个）。
pub fn cleanup_tasks(keep_recent: usize) -> AppResult<usize> {
    let mut registry = task_registry()
        .lock()
        .map_err(|_| AppError::new(ErrorCode::ConfigError, "任务注册表锁获取失败"))?;

    let mut completed: Vec<(String, u64)> = registry
        .iter()
        .filter(|(_, info)| matches!(info.status, TaskStatus::Completed | TaskStatus::Failed | TaskStatus::Cancelled))
        .map(|(id, info)| (id.clone(), info.updated_at))
        .collect();
    completed.sort_by(|a, b| b.1.cmp(&a.1));

    let to_remove: Vec<String> = completed.into_iter().skip(keep_recent).map(|(id, _)| id).collect();
    let count = to_remove.len();
    for id in &to_remove {
        registry.remove(id);
    }
    Ok(count)
}

// ============================================================================
// 辅助函数
// ============================================================================

fn current_timestamp() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

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
    format!("{:016x}-{:016x}", nanos as u64, random)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn task_progress_event_started_has_zero_progress() {
        let event = TaskProgressEvent::started("task-1", "venv_create", "开始创建环境");
        assert_eq!(event.task_id, "task-1");
        assert_eq!(event.task_type, "venv_create");
        assert_eq!(event.progress, 0);
        assert_eq!(event.message, "开始创建环境");
        assert!(matches!(event.status, TaskStatus::Running));
    }

    #[test]
    fn task_progress_event_completed_has_full_progress() {
        let event = TaskProgressEvent::completed("task-1", "venv_create", "环境创建完成");
        assert_eq!(event.progress, 100);
        assert!(matches!(event.status, TaskStatus::Completed));
    }

    #[test]
    fn task_progress_event_failed_contains_error() {
        let event = TaskProgressEvent::failed("task-1", "venv_create", "磁盘空间不足");
        assert!(matches!(event.status, TaskStatus::Failed));
        assert_eq!(event.error.as_deref(), Some("磁盘空间不足"));
    }

    #[test]
    fn progress_is_capped_at_100() {
        let event = TaskProgressEvent::progress("task-1", "test", 150, "test");
        assert_eq!(event.progress, 100);
    }

    #[test]
    fn task_status_serializes_to_snake_case() {
        let status = TaskStatus::Completed;
        let json = serde_json::to_string(&status).unwrap();
        assert_eq!(json, "\"completed\"");
    }

    #[test]
    fn register_and_get_task_works() {
        let result = register_task("test-task-123", "test_type");
        assert!(result.is_ok());

        let task = get_task("test-task-123").unwrap();
        assert!(task.is_some());
        let task = task.unwrap();
        assert_eq!(task.id, "test-task-123");
        assert_eq!(task.task_type, "test_type");
        assert!(matches!(task.status, TaskStatus::Pending));
    }

    #[test]
    fn list_tasks_returns_all_registered() {
        let _ = register_task("list-test-1", "type1");
        let _ = register_task("list-test-2", "type2");
        let tasks = list_tasks().unwrap();
        assert!(tasks.len() >= 2);
    }
}
