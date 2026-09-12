//! 结构化日志系统模块
//!
//! 提供应用级日志初始化、日志级别动态切换、日志文件轮转管理。
//! 基于 `tracing` 生态，支持结构化字段、异步写入、按大小轮转。
//! 所有公共 API 均预留，供未来模块扩展使用。

#![allow(dead_code)]

use crate::config::{get_config, LoggingConfig};
use crate::error::{AppError, AppResult, ErrorCode};
use std::path::PathBuf;
use std::sync::OnceLock;
use tracing::{debug, info};
use tracing_subscriber::{
    fmt,
    prelude::*,
    EnvFilter,
    Layer,
};

/// 全局日志初始化状态。
static LOG_INITIALIZED: OnceLock<()> = OnceLock::new();

/// 日志级别枚举，与配置文件中的字符串对应。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogLevel {
    Off,
    Error,
    Warn,
    Info,
    Debug,
    Trace,
}

impl LogLevel {
    /// 从字符串解析日志级别。
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "off" => LogLevel::Off,
            "error" => LogLevel::Error,
            "warn" | "warning" => LogLevel::Warn,
            "info" => LogLevel::Info,
            "debug" => LogLevel::Debug,
            "trace" => LogLevel::Trace,
            _ => LogLevel::Info,
        }
    }

    /// 转换为 tracing 的过滤指令。
    fn to_filter_directive(&self) -> &'static str {
        match self {
            LogLevel::Off => "off",
            LogLevel::Error => "error",
            LogLevel::Warn => "warn",
            LogLevel::Info => "info",
            LogLevel::Debug => "debug",
            LogLevel::Trace => "trace",
        }
    }
}

/// 获取日志文件目录。
pub fn log_dir() -> AppResult<PathBuf> {
    let log_dir = dirs::data_dir()
        .ok_or_else(|| AppError::new(ErrorCode::ConfigError, "无法确定数据目录"))?
        .join("pyforge-ai")
        .join("logs");
    Ok(log_dir)
}

/// 获取当前日志文件路径。
pub fn current_log_file() -> AppResult<PathBuf> {
    Ok(log_dir()?.join("pyforge-ai.log"))
}

/// 初始化日志系统。
///
/// 从配置中读取日志级别、文件大小、保留数量等设置，
/// 配置控制台输出层和文件输出层。
pub fn init_logging() -> AppResult<()> {
    if LOG_INITIALIZED.get().is_some() {
        return Ok(());
    }

    let config = get_config().unwrap_or_default();
    let logging = &config.logging;

    let log_dir = log_dir()?;
    std::fs::create_dir_all(&log_dir)
        .map_err(|e| AppError::new(ErrorCode::IoError, format!("创建日志目录失败: {e}")))?;

    let level = LogLevel::from_str(&logging.level);
    let filter = EnvFilter::try_new(level.to_filter_directive())
        .unwrap_or_else(|_| EnvFilter::new("info"));

    // 控制台输出层
    let console_layer = if logging.console_output {
        Some(
            fmt::layer()
                .with_target(true)
                .with_level(true)
                .with_thread_ids(false)
                .with_file(false)
                .with_line_number(false)
                .with_filter(filter.clone()),
        )
    } else {
        None
    };

    // 文件输出层（非阻塞，按大小轮转由外部管理）
    let log_file = current_log_file()?;
    let file_appender = tracing_appender::rolling::never(&log_dir, "pyforge-ai.log");
    let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);

    let file_layer = fmt::layer()
        .with_writer(non_blocking)
        .with_target(true)
        .with_level(true)
        .with_thread_ids(true)
        .with_file(true)
        .with_line_number(true)
        .json()
        .with_filter(filter);

    // 组合所有层
    let subscriber = tracing_subscriber::registry()
        .with(console_layer)
        .with(file_layer);

    tracing::subscriber::set_global_default(subscriber)
        .map_err(|e| AppError::new(ErrorCode::ConfigError, format!("设置全局日志订阅者失败: {e}")))?;

    LOG_INITIALIZED
        .set(())
        .map_err(|_| AppError::new(ErrorCode::ConfigError, "日志系统已初始化，无法重复初始化"))?;

    info!(
        target: "pyforge_ai::logging",
        "日志系统初始化完成，级别: {}, 日志文件: {}",
        logging.level,
        log_file.display()
    );

    // 执行日志轮转检查
    rotate_logs(logging)?;

    Ok(())
}

/// 手动轮转日志文件。
///
/// 当当前日志文件超过配置的大小时，将其重命名为 `.1`、`.2` 等，
/// 并删除超过保留数量的旧日志。
pub fn rotate_logs(config: &LoggingConfig) -> AppResult<()> {
    let log_dir = log_dir()?;
    let current_file = current_log_file()?;

    if !current_file.exists() {
        return Ok(());
    }

    let metadata = std::fs::metadata(&current_file)
        .map_err(|e| AppError::new(ErrorCode::IoError, format!("读取日志文件元数据失败: {e}")))?;

    let max_size_bytes = config.max_file_size_mb * 1024 * 1024;
    if metadata.len() < max_size_bytes {
        return Ok(());
    }

    debug!(
        target: "pyforge_ai::logging",
        "日志文件大小 {} 字节超过阈值 {} 字节，执行轮转",
        metadata.len(),
        max_size_bytes
    );

    // 从最旧的开始删除/重命名
    for i in (1..=config.max_files).rev() {
        let old_file = log_dir.join(format!("pyforge-ai.log.{}", i));
        if i == config.max_files {
            // 删除最旧的
            if old_file.exists() {
                std::fs::remove_file(&old_file)
                    .map_err(|e| AppError::new(ErrorCode::IoError, format!("删除旧日志失败: {e}")))?;
            }
        } else {
            // 重命名 .i -> .i+1
            let new_file = log_dir.join(format!("pyforge-ai.log.{}", i + 1));
            if old_file.exists() {
                std::fs::rename(&old_file, &new_file)
                    .map_err(|e| AppError::new(ErrorCode::IoError, format!("重命名日志失败: {e}")))?;
            }
        }
    }

    // 当前日志重命名为 .1
    let first_archive = log_dir.join("pyforge-ai.log.1");
    std::fs::rename(&current_file, &first_archive)
        .map_err(|e| AppError::new(ErrorCode::IoError, format!("归档当前日志失败: {e}")))?;

    info!(
        target: "pyforge_ai::logging",
        "日志轮转完成，已归档为 pyforge-ai.log.1"
    );

    Ok(())
}

/// 动态设置日志级别（运行时生效）。
pub fn set_log_level(level: LogLevel) -> AppResult<()> {
    use tracing::subscriber::set_global_default;

    let config = get_config().unwrap_or_default();
    let log_dir = log_dir()?;
    let filter = EnvFilter::try_new(level.to_filter_directive())
        .unwrap_or_else(|_| EnvFilter::new("info"));

    let console_layer = if config.logging.console_output {
        Some(fmt::layer().with_filter(filter.clone()))
    } else {
        None
    };

    let file_appender = tracing_appender::rolling::never(&log_dir, "pyforge-ai.log");
    let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);
    let file_layer = fmt::layer()
        .with_writer(non_blocking)
        .json()
        .with_filter(filter);

    let subscriber = tracing_subscriber::registry()
        .with(console_layer)
        .with(file_layer);

    set_global_default(subscriber)
        .map_err(|e| AppError::new(ErrorCode::ConfigError, format!("切换日志级别失败: {e}")))?;

    info!(
        target: "pyforge_ai::logging",
        "日志级别已切换为 {:?}", level
    );

    Ok(())
}

/// 读取最近的日志内容（用于前端日志查看器）。
pub fn read_recent_logs(max_lines: usize) -> AppResult<Vec<String>> {
    let log_file = current_log_file()?;
    if !log_file.exists() {
        return Ok(Vec::new());
    }

    let content = std::fs::read_to_string(&log_file)
        .map_err(|e| AppError::new(ErrorCode::IoError, format!("读取日志文件失败: {e}")))?;

    let lines: Vec<String> = content
        .lines()
        .rev()
        .take(max_lines)
        .map(|l| l.to_string())
        .collect();

    Ok(lines.into_iter().rev().collect())
}

/// 清理所有日志文件。
pub fn clear_logs() -> AppResult<()> {
    let log_dir = log_dir()?;
    if !log_dir.exists() {
        return Ok(());
    }

    for entry in std::fs::read_dir(&log_dir)
        .map_err(|e| AppError::new(ErrorCode::IoError, format!("读取日志目录失败: {e}")))?
    {
        let entry = entry
            .map_err(|e| AppError::new(ErrorCode::IoError, format!("读取日志目录项失败: {e}")))?;
        let path = entry.path();
        if path.is_file() {
            std::fs::remove_file(&path)
                .map_err(|e| AppError::new(ErrorCode::IoError, format!("删除日志文件失败: {e}")))?;
        }
    }

    info!(
        target: "pyforge_ai::logging",
        "日志文件已清理"
    );

    Ok(())
}

/// 便捷日志宏封装（带 target）。
#[macro_export]
macro_rules! app_info {
    (target: $target:expr, $($arg:tt)*) => {
        tracing::info!(target: $target, $($arg)*)
    };
    ($($arg:tt)*) => {
        tracing::info!(target: "pyforge_ai", $($arg)*)
    };
}

#[macro_export]
macro_rules! app_warn {
    (target: $target:expr, $($arg:tt)*) => {
        tracing::warn!(target: $target, $($arg)*)
    };
    ($($arg:tt)*) => {
        tracing::warn!(target: "pyforge_ai", $($arg)*)
    };
}

#[macro_export]
macro_rules! app_error {
    (target: $target:expr, $($arg:tt)*) => {
        tracing::error!(target: $target, $($arg)*)
    };
    ($($arg:tt)*) => {
        tracing::error!(target: "pyforge_ai", $($arg)*)
    };
}

#[macro_export]
macro_rules! app_debug {
    (target: $target:expr, $($arg:tt)*) => {
        tracing::debug!(target: $target, $($arg)*)
    };
    ($($arg:tt)*) => {
        tracing::debug!(target: "pyforge_ai", $($arg)*)
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn log_level_from_str_parses_all_levels() {
        assert_eq!(LogLevel::from_str("off"), LogLevel::Off);
        assert_eq!(LogLevel::from_str("error"), LogLevel::Error);
        assert_eq!(LogLevel::from_str("warn"), LogLevel::Warn);
        assert_eq!(LogLevel::from_str("warning"), LogLevel::Warn);
        assert_eq!(LogLevel::from_str("info"), LogLevel::Info);
        assert_eq!(LogLevel::from_str("debug"), LogLevel::Debug);
        assert_eq!(LogLevel::from_str("trace"), LogLevel::Trace);
    }

    #[test]
    fn log_level_from_str_defaults_to_info() {
        assert_eq!(LogLevel::from_str("invalid"), LogLevel::Info);
        assert_eq!(LogLevel::from_str(""), LogLevel::Info);
    }

    #[test]
    fn log_dir_contains_pyforge_ai() {
        let dir = log_dir().unwrap();
        assert!(dir.to_string_lossy().contains("pyforge-ai"));
        assert!(dir.to_string_lossy().contains("logs"));
    }

    #[test]
    fn current_log_file_has_expected_name() {
        let file = current_log_file().unwrap();
        assert_eq!(file.file_name().unwrap(), "pyforge-ai.log");
    }
}
