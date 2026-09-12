//! 统一错误处理模块
//!
//! 提供应用级统一错误类型、错误码体系，以及与各模块错误的转换。
//! 所有 Tauri 命令最终返回的错误都应转换为 `AppError`，确保前端
//! 能够获得结构化、可追溯的错误信息。
//! 所有公共 API 均预留，供未来模块扩展使用。

#![allow(dead_code)]

use serde::Serialize;
use std::fmt;
use thiserror::Error;

/// 应用错误码，用于前端进行错误分类与国际化。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    /// 未知错误
    Unknown,
    /// IO 操作失败
    IoError,
    /// 路径校验失败（目录穿越等）
    PathValidation,
    /// 命令执行失败
    CommandFailed,
    /// 命令执行超时
    CommandTimeout,
    /// Shell 注入检测
    ShellInjection,
    /// URL 方案不合法
    InvalidUrlScheme,
    /// Python 未找到
    PythonNotFound,
    /// Python 版本解析失败
    PythonVersionParse,
    /// 虚拟环境已存在
    VenvAlreadyExists,
    /// 虚拟环境不存在
    VenvNotFound,
    /// 虚拟环境已损坏
    VenvCorrupted,
    /// 包未找到
    PackageNotFound,
    /// 包安装失败
    PackageInstallFailed,
    /// 包卸载失败
    PackageUninstallFailed,
    /// 依赖冲突
    DependencyConflict,
    /// 镜像源连接失败
    MirrorConnectionFailed,
    /// AI 配置无效
    AiConfigInvalid,
    /// AI API 调用失败
    AiApiError,
    /// AI 返回内容为空
    AiNoResponse,
    /// 配置文件读写失败
    ConfigError,
    /// 项目解析失败
    ProjectParseError,
    /// 操作被用户取消
    Cancelled,
    /// 不支持的平台
    UnsupportedPlatform,
    /// 权限不足
    PermissionDenied,
}

impl ErrorCode {
    /// 返回错误码的 HTTP 风格状态码，便于前端统一处理。
    pub fn status_code(&self) -> u16 {
        match self {
            ErrorCode::Unknown => 500,
            ErrorCode::IoError => 500,
            ErrorCode::PathValidation => 400,
            ErrorCode::CommandFailed => 500,
            ErrorCode::CommandTimeout => 408,
            ErrorCode::ShellInjection => 400,
            ErrorCode::InvalidUrlScheme => 400,
            ErrorCode::PythonNotFound => 404,
            ErrorCode::PythonVersionParse => 422,
            ErrorCode::VenvAlreadyExists => 409,
            ErrorCode::VenvNotFound => 404,
            ErrorCode::VenvCorrupted => 422,
            ErrorCode::PackageNotFound => 404,
            ErrorCode::PackageInstallFailed => 500,
            ErrorCode::PackageUninstallFailed => 500,
            ErrorCode::DependencyConflict => 409,
            ErrorCode::MirrorConnectionFailed => 502,
            ErrorCode::AiConfigInvalid => 400,
            ErrorCode::AiApiError => 502,
            ErrorCode::AiNoResponse => 502,
            ErrorCode::ConfigError => 500,
            ErrorCode::ProjectParseError => 422,
            ErrorCode::Cancelled => 499,
            ErrorCode::UnsupportedPlatform => 501,
            ErrorCode::PermissionDenied => 403,
        }
    }

    /// 返回错误码的简短描述，用于日志。
    pub fn description(&self) -> &'static str {
        match self {
            ErrorCode::Unknown => "未知错误",
            ErrorCode::IoError => "IO 操作失败",
            ErrorCode::PathValidation => "路径校验失败",
            ErrorCode::CommandFailed => "命令执行失败",
            ErrorCode::CommandTimeout => "命令执行超时",
            ErrorCode::ShellInjection => "检测到 Shell 注入尝试",
            ErrorCode::InvalidUrlScheme => "URL 方案不合法",
            ErrorCode::PythonNotFound => "未找到 Python 解释器",
            ErrorCode::PythonVersionParse => "Python 版本解析失败",
            ErrorCode::VenvAlreadyExists => "虚拟环境已存在",
            ErrorCode::VenvNotFound => "虚拟环境不存在",
            ErrorCode::VenvCorrupted => "虚拟环境已损坏",
            ErrorCode::PackageNotFound => "未找到指定包",
            ErrorCode::PackageInstallFailed => "包安装失败",
            ErrorCode::PackageUninstallFailed => "包卸载失败",
            ErrorCode::DependencyConflict => "依赖冲突",
            ErrorCode::MirrorConnectionFailed => "镜像源连接失败",
            ErrorCode::AiConfigInvalid => "AI 配置无效",
            ErrorCode::AiApiError => "AI API 调用失败",
            ErrorCode::AiNoResponse => "AI 未返回有效内容",
            ErrorCode::ConfigError => "配置文件读写失败",
            ErrorCode::ProjectParseError => "项目文件解析失败",
            ErrorCode::Cancelled => "操作被取消",
            ErrorCode::UnsupportedPlatform => "不支持的平台",
            ErrorCode::PermissionDenied => "权限不足",
        }
    }
}

/// 应用统一错误类型。
#[derive(Debug, Error)]
pub struct AppError {
    /// 错误码
    pub code: ErrorCode,
    /// 用户可读的错误消息
    pub message: String,
    /// 可选的详细技术信息（仅日志，不返回前端）
    pub details: Option<String>,
}

impl AppError {
    /// 创建新的应用错误。
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            details: None,
        }
    }

    /// 附带详细技术信息。
    pub fn with_details(mut self, details: impl Into<String>) -> Self {
        self.details = Some(details.into());
        self
    }

    /// 从任意错误创建未知错误。
    pub fn from_any(err: &dyn std::error::Error) -> Self {
        Self::new(ErrorCode::Unknown, err.to_string())
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{:?}] {}", self.code, self.message)
    }
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("AppError", 3)?;
        state.serialize_field("code", &self.code)?;
        state.serialize_field("message", &self.message)?;
        state.serialize_field("status_code", &self.code.status_code())?;
        state.end()
    }
}

// ============================================================================
// 与各模块错误的转换
// ============================================================================

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        let code = match err.kind() {
            std::io::ErrorKind::NotFound => ErrorCode::PythonNotFound,
            std::io::ErrorKind::PermissionDenied => ErrorCode::PermissionDenied,
            _ => ErrorCode::IoError,
        };
        Self::new(code, err.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        Self::new(ErrorCode::ConfigError, format!("JSON 解析失败: {err}"))
    }
}

impl From<crate::security::SecurityError> for AppError {
    fn from(err: crate::security::SecurityError) -> Self {
        use crate::security::SecurityError::*;
        let code = match &err {
            PathTraversal(_) => ErrorCode::PathValidation,
            InvalidPath(_) => ErrorCode::PathValidation,
            Io(_) => ErrorCode::IoError,
            CommandFailed(_) => ErrorCode::CommandFailed,
            Timeout(_) => ErrorCode::CommandTimeout,
            ShellInjection(_) => ErrorCode::ShellInjection,
            InvalidUrlScheme(_) => ErrorCode::InvalidUrlScheme,
        };
        Self::new(code, err.to_string())
    }
}

impl From<crate::python::PythonError> for AppError {
    fn from(err: crate::python::PythonError) -> Self {
        use crate::python::PythonError::*;
        let code = match &err {
            Io(_) => ErrorCode::IoError,
            Parse(_) => ErrorCode::PythonVersionParse,
            NotFound(_) => ErrorCode::PythonNotFound,
            NotImplemented(_) => ErrorCode::UnsupportedPlatform,
            Platform(_) => ErrorCode::UnsupportedPlatform,
        };
        Self::new(code, err.to_string())
    }
}

impl From<crate::venv::VenvError> for AppError {
    fn from(err: crate::venv::VenvError) -> Self {
        use crate::venv::VenvError::*;
        let code = match &err {
            Io(_) => ErrorCode::IoError,
            CommandFailed(msg) => {
                if msg.contains("already exists") {
                    ErrorCode::VenvAlreadyExists
                } else {
                    ErrorCode::CommandFailed
                }
            }
            Timeout(_) => ErrorCode::CommandTimeout,
            InvalidPath(_) => ErrorCode::VenvNotFound,
            PathTraversal(_) => ErrorCode::PathValidation,
            Json(_) => ErrorCode::ConfigError,
            Utf8(_) => ErrorCode::IoError,
        };
        Self::new(code, err.to_string())
    }
}

impl From<crate::ai::AiError> for AppError {
    fn from(err: crate::ai::AiError) -> Self {
        use crate::ai::AiError::*;
        let code = match &err {
            OpenAI(_) => ErrorCode::AiApiError,
            Serde(_) => ErrorCode::AiNoResponse,
            Security(_) => ErrorCode::PathValidation,
            Config(_) => ErrorCode::AiConfigInvalid,
            NoChoices => ErrorCode::AiNoResponse,
        };
        Self::new(code, err.to_string())
    }
}

impl From<reqwest::Error> for AppError {
    fn from(err: reqwest::Error) -> Self {
        if err.is_timeout() {
            Self::new(ErrorCode::CommandTimeout, err.to_string())
        } else if err.is_connect() {
            Self::new(ErrorCode::MirrorConnectionFailed, err.to_string())
        } else {
            Self::new(ErrorCode::IoError, err.to_string())
        }
    }
}

/// 应用统一 Result 类型。
pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_code_status_codes_are_reasonable() {
        assert_eq!(ErrorCode::Unknown.status_code(), 500);
        assert_eq!(ErrorCode::PythonNotFound.status_code(), 404);
        assert_eq!(ErrorCode::CommandTimeout.status_code(), 408);
        assert_eq!(ErrorCode::VenvAlreadyExists.status_code(), 409);
        assert_eq!(ErrorCode::Cancelled.status_code(), 499);
    }

    #[test]
    fn app_error_serializes_with_code_and_message() {
        let err = AppError::new(ErrorCode::PythonNotFound, "Python 3.12 未找到");
        let json = serde_json::to_string(&err).unwrap();
        assert!(json.contains("\"code\":\"python_not_found\""));
        assert!(json.contains("\"message\":\"Python 3.12 未找到\""));
        assert!(json.contains("\"status_code\":404"));
    }

    #[test]
    fn app_error_display_includes_code() {
        let err = AppError::new(ErrorCode::IoError, "磁盘已满");
        let display = format!("{err}");
        assert!(display.contains("IoError"));
        assert!(display.contains("磁盘已满"));
    }

    #[test]
    fn io_error_not_found_maps_to_python_not_found() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file missing");
        let app_err: AppError = io_err.into();
        assert_eq!(app_err.code, ErrorCode::PythonNotFound);
    }

    #[test]
    fn io_error_permission_denied_maps_correctly() {
        let io_err = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "access denied");
        let app_err: AppError = io_err.into();
        assert_eq!(app_err.code, ErrorCode::PermissionDenied);
    }
}
