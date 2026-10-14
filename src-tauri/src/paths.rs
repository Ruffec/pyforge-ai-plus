//! 平台路径规则模块
//!
//! 应用启动阶段优先执行设备系统平台检测（Windows / macOS / Linux），
//! 并依据平台规则生成「非系统盘」优先的默认存储路径：
//! - Windows：自动选择第一个非系统固定盘符（如 `D:\PyForge`），无可用分区时
//!   回退到用户数据目录；
//! - macOS / Linux：使用用户主目录（`~/PyForge`），避免写入系统目录；
//!
//! 该模块是唯一的平台路径规则来源，前端设置页与后端默认值共用，
//! 新增路径规则只需扩展 [`PlatformPaths`] 字段并在 [`platform_default_paths`]
//! 中按平台补全，即可获得一致的展示与落盘行为。

use crate::error::{AppError, AppResult, ErrorCode};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// 平台默认路径规则（前端设置页展示与后端默认值共用）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlatformPaths {
    /// Python 解释器安装 / 扫描根目录
    pub python_installations_path: String,
    /// 虚拟环境根目录
    pub venv_root: String,
    /// 缓存目录
    pub cache_dir: String,
    /// 日志目录
    pub log_dir: String,
    /// 平台标识（windows / macos / linux）
    pub platform: String,
    /// 存储根目录（Windows 为非系统盘下的 PyForge 根，如 `D:\PyForge`；
    /// macOS / Linux 为 `~/PyForge`）
    pub storage_root: String,
}

/// 检测当前运行平台标识。
pub fn platform_id() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

/// Windows：返回第一个非系统盘的固定盘符根目录（`D:\` .. `Z:\`）。
fn windows_non_system_root() -> Option<PathBuf> {
    let system_drive = std::env::var("SystemDrive")
        .unwrap_or_else(|_| "C:".to_string())
        .trim_end_matches('\\')
        .to_uppercase();

    for letter in b'D'..=b'Z' {
        let drive = format!("{}:\\", letter as char);
        let root = PathBuf::from(&drive);
        // 固定盘符判定：目录存在即可访问；排除系统盘
        if root.is_dir() && !drive.starts_with(&system_drive) {
            return Some(root);
        }
    }
    None
}

/// 回退根目录：无法确定非系统盘 / 主目录时，使用用户数据目录。
fn fallback_root() -> AppResult<PathBuf> {
    dirs::data_dir()
        .map(|d| d.join("pyforge-ai"))
        .ok_or_else(|| AppError::new(ErrorCode::ConfigError, "无法确定数据目录"))
}

/// 计算当前平台「非系统盘优先」的存储根目录。
pub fn storage_root() -> AppResult<PathBuf> {
    if cfg!(target_os = "windows") {
        if let Some(root) = windows_non_system_root() {
            return Ok(root.join("PyForge"));
        }
        fallback_root()
    } else if let Some(home) = dirs::home_dir() {
        Ok(home.join("PyForge"))
    } else {
        fallback_root()
    }
}

/// 应用数据根目录（存储根下的 `pyforge-ai`）：配置、快照等用户数据
/// 统一收敛于此，保证不写系统盘。
pub fn app_data_root() -> AppResult<PathBuf> {
    Ok(storage_root()?.join("pyforge-ai"))
}

/// 计算当前平台的默认路径规则（非系统盘优先）。
pub fn platform_default_paths() -> AppResult<PlatformPaths> {
    let root = storage_root()?;
    let to_string = |p: PathBuf| p.to_string_lossy().trim_end_matches(['/', '\\']).to_string();

    Ok(PlatformPaths {
        python_installations_path: to_string(root.join("python")),
        venv_root: to_string(root.join("envs")),
        cache_dir: to_string(root.join("cache")),
        log_dir: to_string(root.join("logs")),
        platform: platform_id().to_string(),
        storage_root: to_string(root),
    })
}

/// 旧版默认虚拟环境根目录（数据目录下的 pyforge-ai/venvs），
/// 用于判断用户是否从未自定义过路径。
pub fn legacy_venv_root() -> Option<String> {
    dirs::data_dir()
        .map(|d| d.join("pyforge-ai").join("venvs").to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn platform_id_is_valid() {
        assert!(matches!(platform_id(), "windows" | "macos" | "linux"));
    }

    #[test]
    fn platform_default_paths_are_non_empty_and_consistent() {
        let paths = platform_default_paths().expect("平台路径规则应可计算");
        assert!(!paths.python_installations_path.is_empty());
        assert!(!paths.venv_root.is_empty());
        assert!(!paths.cache_dir.is_empty());
        assert!(!paths.log_dir.is_empty());
        // 所有子路径必须位于统一存储根目录之下
        assert!(paths.venv_root.starts_with(&paths.storage_root));
        assert!(paths.cache_dir.starts_with(&paths.storage_root));
        assert!(paths.log_dir.starts_with(&paths.storage_root));
    }

    #[test]
    fn windows_non_system_root_excludes_system_drive() {
        if cfg!(target_os = "windows") {
            if let Some(root) = windows_non_system_root() {
                let system_drive = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into());
                assert!(!root
                    .to_string_lossy()
                    .to_uppercase()
                    .starts_with(&system_drive.to_uppercase()));
            }
        }
    }
}
