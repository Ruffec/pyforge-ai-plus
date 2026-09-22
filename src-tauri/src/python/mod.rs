//! Python 版本管理模块
//!
//! 提供 Python 解释器扫描、版本管理、健康检查、环境变量获取等功能。
//! 所有公共 API 均预留，供未来模块扩展使用。

#![allow(dead_code)]

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

use once_cell::sync::Lazy;
use rayon::prelude::*;
use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::platform::{get_adapter, PlatformAdapter};
use crate::security;

static SCAN_CACHE: Lazy<Mutex<Option<Vec<PythonInfo>>>> = Lazy::new(|| Mutex::new(None));

static VERSION_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)python\s+(?P<major>\d+)\.(?P<minor>\d+)(?:\.(?P<patch>\d+))?").unwrap()
});

/// Python 安装信息。
#[derive(Debug, Clone, Serialize)]
pub struct PythonInfo {
    /// 唯一标识，通常取规范化后的绝对路径。
    pub id: String,
    /// 版本号字符串。
    pub version: String,
    /// Python 可执行文件路径。
    pub path: PathBuf,
    /// 是否为当前活动/默认版本。
    pub is_active: bool,
    /// pip 版本号（可选）。
    pub pip_version: Option<String>,
    /// 已安装包数量（可选）。
    pub packages_count: Option<usize>,
    /// 架构信息，例如 "64bit" / "32bit"（可选）。
    pub architecture: Option<String>,
}

/// 解析后的 Python 版本号。
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
pub struct PythonVersion {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
}

impl PythonVersion {
    /// 从版本字符串解析，例如 "3.10.4" 或 "Python 3.10.4"。
    pub fn parse<S: AsRef<str>>(input: S) -> Option<Self> {
        let caps = VERSION_REGEX.captures(input.as_ref())?;
        let major = caps.name("major")?.as_str().parse().ok()?;
        let minor = caps.name("minor")?.as_str().parse().ok()?;
        let patch = caps
            .name("patch")
            .and_then(|m| m.as_str().parse().ok())
            .unwrap_or(0);
        Some(Self {
            major,
            minor,
            patch,
        })
    }
}

impl std::fmt::Display for PythonVersion {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}.{}.{}", self.major, self.minor, self.patch)
    }
}

impl PythonVersion {
    /// 返回常见的点分版本字符串（例如 "3.10.4"）。
    pub fn to_semver_string(&self) -> String {
        format!("{}.{}.{}", self.major, self.minor, self.patch)
    }
}

/// Python 安装扫描器。
pub struct PythonScanner {
    adapter: Box<dyn PlatformAdapter>,
}

impl PythonScanner {
    /// 使用当前平台适配器创建扫描器。
    pub fn new() -> Self {
        Self {
            adapter: get_adapter(),
        }
    }

    /// 使用指定适配器创建扫描器（便于测试）。
    pub fn with_adapter(adapter: Box<dyn PlatformAdapter>) -> Self {
        Self { adapter }
    }

    /// 扫描系统中所有可识别的 Python 安装。
    pub fn scan(&self) -> Vec<PythonInfo> {
        let candidates = self.collect_candidates();

        let active_path = self.resolve_active_python();

        let infos: Vec<PythonInfo> = candidates
            .par_iter()
            .filter_map(|path| {
                let mut info = get_python_details(path).ok()?;
                info.is_active = active_path
                    .as_ref()
                    .map(|active| active == path)
                    .unwrap_or(false);
                Some(info)
            })
            .collect();

        let mut sorted = infos;
        sorted.sort_by(|a, b| {
            let va = PythonVersion::parse(&a.version);
            let vb = PythonVersion::parse(&b.version);
            match (va, vb) {
                (Some(va), Some(vb)) => vb.cmp(&va),
                (Some(_), None) => std::cmp::Ordering::Less,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (None, None) => b.version.cmp(&a.version),
            }
        });

        sorted
    }

    fn collect_candidates(&self) -> Vec<PathBuf> {
        let mut candidates: Vec<PathBuf> = Vec::new();

        for name in ["python3", "python"] {
            if let Ok(path) = which::which(name) {
                candidates.push(path);
            }
        }

        for dir in self.adapter.python_search_paths() {
            Self::collect_from_dir(&dir, 3, &mut candidates);
        }

        if let Some(path_env) = std::env::var_os("PATH") {
            for dir in std::env::split_paths(&path_env) {
                for name in ["python", "python3"] {
                    let candidate = dir.join(name);
                    if candidate.exists() {
                        candidates.push(candidate);
                    }
                }
            }
        }

        let mut seen = HashSet::new();
        candidates
            .into_iter()
            .filter_map(|path| match std::fs::canonicalize(&path) {
                Ok(canonical) if seen.insert(canonical.clone()) => Some(canonical),
                _ => None,
            })
            .collect()
    }

    fn collect_from_dir(dir: &Path, depth: usize, candidates: &mut Vec<PathBuf>) {
        if depth == 0 || !dir.is_dir() {
            return;
        }

        let entries: Vec<_> = match std::fs::read_dir(dir) {
            Ok(iter) => iter.filter_map(|e| e.ok()).collect(),
            Err(_) => return,
        };

        for entry in entries {
            let path = entry.path();
            if path.is_dir() {
                Self::collect_from_dir(&path, depth - 1, candidates);
            } else if Self::is_python_executable(&path) {
                candidates.push(path);
            }
        }
    }

    fn is_python_executable(path: &Path) -> bool {
        let file_name = match path.file_name().and_then(|n| n.to_str()) {
            Some(name) => name,
            None => return false,
        };

        let lower = file_name.to_ascii_lowercase();
        if lower == "python" || lower == "python3" || lower.starts_with("python3.") {
            return path.is_file();
        }

        if cfg!(target_os = "windows") {
            if lower == "python.exe" || lower == "python3.exe" || lower.starts_with("python3.") {
                return path.is_file();
            }
        }

        false
    }

    fn resolve_active_python(&self) -> Option<PathBuf> {
        for name in ["python3", "python"] {
            if let Ok(path) = which::which(name) {
                if let Ok(canonical) = std::fs::canonicalize(path) {
                    return Some(canonical);
                }
            }
        }
        None
    }
}

impl Default for PythonScanner {
    fn default() -> Self {
        Self::new()
    }
}

/// Python 相关操作可能产生的错误。
#[derive(Debug, Clone, Serialize)]
pub enum PythonError {
    Io(String),
    Parse(String),
    NotFound(String),
    NotImplemented(String),
    Platform(String),
}

impl std::fmt::Display for PythonError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PythonError::Io(msg) => write!(f, "IO 错误: {msg}"),
            PythonError::Parse(msg) => write!(f, "解析错误: {msg}"),
            PythonError::NotFound(msg) => write!(f, "未找到: {msg}"),
            PythonError::NotImplemented(msg) => write!(f, "未实现: {msg}"),
            PythonError::Platform(msg) => write!(f, "平台错误: {msg}"),
        }
    }
}

impl std::error::Error for PythonError {}

impl From<std::io::Error> for PythonError {
    fn from(err: std::io::Error) -> Self {
        PythonError::Io(err.to_string())
    }
}

/// 获取指定 Python 可执行文件的详细信息。
pub fn get_python_details(path: &Path) -> Result<PythonInfo, PythonError> {
    if !path.exists() {
        return Err(PythonError::NotFound(format!(
            "Python 可执行文件不存在: {}",
            path.display()
        )));
    }

    let version_output = run_python_command(path, &["--version"])?;
    let version_str = String::from_utf8_lossy(&version_output.stdout)
        .trim()
        .to_string();

    let parsed = PythonVersion::parse(&version_str)
        .ok_or_else(|| PythonError::Parse(format!("无法解析版本: {version_str}")))?;

    let version = parsed.to_semver_string();

    let pip_version = get_pip_version(path).ok();
    let packages_count = get_packages_count(path).ok();
    let architecture = get_architecture(path).ok();

    let id = std::fs::canonicalize(path)
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .to_string();

    Ok(PythonInfo {
        id,
        version,
        path: path.to_path_buf(),
        is_active: false,
        pip_version,
        packages_count,
        architecture,
    })
}

/// 扫描系统中的 Python 版本，结果会被缓存。
pub fn scan_python_versions() -> Vec<PythonInfo> {
    if let Ok(cache) = SCAN_CACHE.lock() {
        if let Some(ref infos) = *cache {
            return infos.clone();
        }
    }

    let scanner = PythonScanner::new();
    let infos = scanner.scan();

    if let Ok(mut cache) = SCAN_CACHE.lock() {
        *cache = Some(infos.clone());
    }

    infos
}

/// 清除 Python 扫描缓存。
pub fn clear_scan_cache() {
    if let Ok(mut cache) = SCAN_CACHE.lock() {
        *cache = None;
    }
}

/// 设置系统默认 Python 版本。
pub fn set_default_python(python_path: &Path) -> Result<(), PythonError> {
    security::validate_path(python_path, &[]).map_err(|e| PythonError::Io(e.to_string()))?;
    if !python_path.exists() {
        return Err(PythonError::NotFound(format!(
            "Python 可执行文件不存在: {}",
            python_path.display()
        )));
    }

    let adapter = get_adapter();
    adapter
        .set_default_python(python_path)
        .map_err(|e| PythonError::Platform(e.to_string()))?;
    clear_scan_cache();
    Ok(())
}

fn run_python_command(path: &Path, args: &[&str]) -> Result<std::process::Output, PythonError> {
    let output = Command::new(path)
        .args(args)
        .output()
        .map_err(|e| PythonError::Io(format!("运行 {} 失败: {e}", path.display())))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(PythonError::Io(format!(
            "命令 {} 执行失败: {}",
            path.display(),
            stderr
        )));
    }

    Ok(output)
}

fn get_pip_version(path: &Path) -> Result<String, PythonError> {
    let output = run_python_command(path, &["-m", "pip", "--version"])?;
    let text = String::from_utf8_lossy(&output.stdout);
    let first_line = text.lines().next().unwrap_or("").trim().to_string();
    if first_line.is_empty() {
        return Err(PythonError::Parse("pip 版本输出为空".to_string()));
    }
    Ok(first_line)
}

fn get_packages_count(path: &Path) -> Result<usize, PythonError> {
    let output = run_python_command(path, &["-m", "pip", "list", "--format=json"])?;
    let text = String::from_utf8_lossy(&output.stdout);
    let json: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| PythonError::Parse(e.to_string()))?;

    match json.as_array() {
        Some(arr) => Ok(arr.len()),
        None => Err(PythonError::Parse("pip list 输出格式异常".to_string())),
    }
}

fn get_architecture(path: &Path) -> Result<String, PythonError> {
    let output = run_python_command(
        path,
        &["-c", "import platform; print(platform.architecture()[0])"],
    )?;
    let text = String::from_utf8_lossy(&output.stdout);
    Ok(text.trim().to_string())
}

// ============================================================================
// 企业级增强功能
// ============================================================================

/// Python 安装健康检查结果。
#[derive(Debug, Clone, Serialize)]
pub struct PythonHealthCheck {
    /// Python 可执行文件路径
    pub path: String,
    /// 是否可执行
    pub is_executable: bool,
    /// 版本是否可解析
    pub version_valid: bool,
    /// pip 是否可用
    pub pip_available: bool,
    /// pip 版本
    pub pip_version: Option<String>,
    /// 是否能导入标准库
    pub stdlib_working: bool,
    /// 站点包目录是否可写
    pub site_packages_writable: bool,
    /// 整体健康状态
    pub healthy: bool,
    /// 问题列表
    pub issues: Vec<String>,
}

/// 对指定 Python 安装执行健康检查。
pub fn health_check(path: &Path) -> PythonHealthCheck {
    let mut issues = Vec::new();

    // 1. 检查文件是否存在且可执行
    let is_executable = path.exists() && path.is_file();
    if !is_executable {
        issues.push("Python 可执行文件不存在或不是有效文件".to_string());
    }

    // 2. 检查版本是否可解析
    let version_valid = if is_executable {
        match run_python_command(path, &["--version"]) {
            Ok(output) => {
                let text = String::from_utf8_lossy(&output.stdout);
                PythonVersion::parse(&text).is_some()
            }
            Err(_) => false,
        }
    } else {
        false
    };
    if !version_valid && is_executable {
        issues.push("无法解析 Python 版本号".to_string());
    }

    // 3. 检查 pip 是否可用
    let (pip_available, pip_version) = if is_executable {
        match run_python_command(path, &["-m", "pip", "--version"]) {
            Ok(output) => {
                let text = String::from_utf8_lossy(&output.stdout);
                let version = text.lines().next().map(|l| l.trim().to_string());
                (true, version)
            }
            Err(_) => (false, None),
        }
    } else {
        (false, None)
    };
    if !pip_available && is_executable {
        issues.push("pip 不可用，建议运行 python -m ensurepip".to_string());
    }

    // 4. 检查标准库是否可导入
    let stdlib_working = if is_executable {
        run_python_command(path, &["-c", "import os, sys, json, subprocess; print('ok')"]).is_ok()
    } else {
        false
    };
    if !stdlib_working && is_executable {
        issues.push("标准库导入失败，Python 安装可能已损坏".to_string());
    }

    // 5. 检查站点包目录是否可写
    let site_packages_writable = if is_executable {
        match run_python_command(
            path,
            &["-c", "import site; print(site.getsitepackages()[0])"],
        ) {
            Ok(output) => {
                let text = String::from_utf8_lossy(&output.stdout);
                let site_dir = text.trim();
                if !site_dir.is_empty() {
                    let test_file = std::path::Path::new(site_dir).join(".pyforge_write_test");
                    match std::fs::write(&test_file, "test") {
                        Ok(_) => {
                            let _ = std::fs::remove_file(&test_file);
                            true
                        }
                        Err(_) => false,
                    }
                } else {
                    false
                }
            }
            Err(_) => false,
        }
    } else {
        false
    };
    if !site_packages_writable && is_executable {
        issues.push("站点包目录不可写，安装包时可能需要管理员权限".to_string());
    }

    let healthy = is_executable && version_valid && pip_available && stdlib_working;

    PythonHealthCheck {
        path: path.to_string_lossy().to_string(),
        is_executable,
        version_valid,
        pip_available,
        pip_version,
        stdlib_working,
        site_packages_writable,
        healthy,
        issues,
    }
}

/// Python 版本兼容性检查结果。
#[derive(Debug, Clone, Serialize)]
pub struct CompatibilityCheck {
    pub package_name: String,
    pub required_version: String,
    pub current_version: String,
    pub compatible: bool,
    pub reason: String,
}

/// 检查当前 Python 版本是否满足包的版本要求。
pub fn check_compatibility(
    python_version: &PythonVersion,
    package_name: &str,
    required: &str,
) -> CompatibilityCheck {
    // 简化的版本要求解析（支持 >=, <=, ==, >, <, !=）
    let mut compatible = true;
    let mut reason = String::new();

    for constraint in required.split(',') {
        let constraint = constraint.trim();
        if constraint.is_empty() {
            continue;
        }

        let (op, ver_str) = if let Some(rest) = constraint.strip_prefix(">=") {
            (">=", rest.trim())
        } else if let Some(rest) = constraint.strip_prefix("<=") {
            ("<=", rest.trim())
        } else if let Some(rest) = constraint.strip_prefix("==") {
            ("==", rest.trim())
        } else if let Some(rest) = constraint.strip_prefix("!=") {
            ("!=", rest.trim())
        } else if let Some(rest) = constraint.strip_prefix('>') {
            (">", rest.trim())
        } else if let Some(rest) = constraint.strip_prefix('<') {
            ("<", rest.trim())
        } else {
            ("==", constraint)
        };

        if let Some(req_ver) = PythonVersion::parse(ver_str) {
            let cmp = python_version.cmp(&req_ver);
            let ok = match op {
                ">=" => cmp != std::cmp::Ordering::Less,
                "<=" => cmp != std::cmp::Ordering::Greater,
                "==" => cmp == std::cmp::Ordering::Equal,
                "!=" => cmp != std::cmp::Ordering::Equal,
                ">" => cmp == std::cmp::Ordering::Greater,
                "<" => cmp == std::cmp::Ordering::Less,
                _ => true,
            };
            if !ok {
                compatible = false;
                reason = format!(
                    "Python {} 不满足 {} 的要求 {}",
                    python_version, package_name, constraint
                );
                break;
            }
        }
    }

    if compatible && reason.is_empty() {
        reason = format!("Python {} 满足 {} 的版本要求", python_version, package_name);
    }

    CompatibilityCheck {
        package_name: package_name.to_string(),
        required_version: required.to_string(),
        current_version: python_version.to_string(),
        compatible,
        reason,
    }
}

/// Python 环境变量信息。
#[derive(Debug, Clone, Serialize)]
pub struct PythonEnvInfo {
    /// PYTHONPATH 内容
    pub python_path: Option<String>,
    /// PYTHONHOME 内容
    pub python_home: Option<String>,
    /// VIRTUAL_ENV 内容（当前激活的虚拟环境）
    pub virtual_env: Option<String>,
    /// PATH 中包含的 Python 相关路径
    pub path_python_entries: Vec<String>,
}

/// 获取当前 Python 相关环境变量信息。
pub fn get_python_env_info() -> PythonEnvInfo {
    let python_path = std::env::var("PYTHONPATH").ok();
    let python_home = std::env::var("PYTHONHOME").ok();
    let virtual_env = std::env::var("VIRTUAL_ENV").ok();

    let path_python_entries = std::env::var_os("PATH")
        .map(|paths| {
            std::env::split_paths(&paths)
                .filter(|p| {
                    let s = p.to_string_lossy().to_lowercase();
                    s.contains("python") || s.contains("anaconda") || s.contains("miniconda")
                })
                .map(|p| p.to_string_lossy().to_string())
                .collect()
        })
        .unwrap_or_default();

    PythonEnvInfo {
        python_path,
        python_home,
        virtual_env,
        path_python_entries,
    }
}

/// 验证 Python 可执行文件是否有效。
pub fn validate_python_executable(path: &Path) -> Result<(), PythonError> {
    if !path.exists() {
        return Err(PythonError::NotFound(format!(
            "Python 可执行文件不存在: {}",
            path.display()
        )));
    }
    if !path.is_file() {
        return Err(PythonError::Parse(format!(
            "路径不是文件: {}",
            path.display()
        )));
    }

    // 尝试执行 --version 验证
    let output = Command::new(path)
        .arg("--version")
        .output()
        .map_err(|e| PythonError::Io(format!("执行 Python 失败: {e}")))?;

    if !output.status.success() {
        return Err(PythonError::Parse(format!(
            "Python 执行失败，退出码: {:?}",
            output.status.code()
        )));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    if PythonVersion::parse(&stdout).is_none() {
        return Err(PythonError::Parse(format!(
            "无法解析 Python 版本输出: {}",
            stdout.trim()
        )));
    }

    Ok(())
}

/// 获取 Python 的 sys.path（模块搜索路径）。
pub fn get_sys_path(path: &Path) -> Result<Vec<String>, PythonError> {
    let output = run_python_command(
        path,
        &["-c", "import sys, json; print(json.dumps(sys.path))"],
    )?;
    let text = String::from_utf8_lossy(&output.stdout);
    let paths: Vec<String> = serde_json::from_str(text.trim())
        .map_err(|e| PythonError::Parse(format!("解析 sys.path 失败: {e}")))?;
    Ok(paths)
}

/// 获取 Python 已安装的标准模块列表。
pub fn get_stdlib_modules(path: &Path) -> Result<Vec<String>, PythonError> {
    let output = run_python_command(
        path,
        &["-c", "import sys, json; print(json.dumps(sys.stdlib_module_names))"],
    )?;
    let text = String::from_utf8_lossy(&output.stdout);
    let modules: Vec<String> = serde_json::from_str(text.trim())
        .map_err(|e| PythonError::Parse(format!("解析标准模块列表失败: {e}")))?;
    Ok(modules)
}

// ============================================================================
// python.org 官方发布版本
// ============================================================================

/// 可安装的 Python 官方稳定版本（来自 python.org）。
#[derive(Debug, Clone, Serialize)]
pub struct PythonOrgRelease {
    pub version: String,
    pub release_date: String,
    pub release_page_url: String,
    pub is_latest: bool,
}

#[derive(Debug, Deserialize)]
struct ReleaseVersionEntry {
    version: String,
    #[serde(default)]
    is_latest: bool,
}

#[derive(Debug, Deserialize)]
struct ReleaseEntry {
    #[serde(default)]
    pre_release: bool,
    #[serde(default)]
    release_date: String,
    #[serde(default)]
    release_page_url: String,
    #[serde(default)]
    release_version: Option<ReleaseVersionEntry>,
}

/// 提取 (major, minor, micro) 元组用于排序比较。
fn version_key(version: &str) -> (u64, u64, u64) {
    let parts: Vec<u64> = version
        .split('.')
        .filter_map(|p| p.trim().parse().ok())
        .collect();
    (
        parts.first().copied().unwrap_or(0),
        parts.get(1).copied().unwrap_or(0),
        parts.get(2).copied().unwrap_or(0),
    )
}

/// 从 python.org 官方 API 拉取已发布的 Python 3 稳定版本列表（过滤预发布版），
/// 按版本号从新到旧排序。
pub async fn fetch_python_org_releases() -> Result<Vec<PythonOrgRelease>, reqwest::Error> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .user_agent("PyForgeAI/0.1")
        .build()?;

    let entries: Vec<ReleaseEntry> = client
        .get("https://www.python.org/api/v2/downloads/release/?is_published=true")
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;

    let mut releases: Vec<PythonOrgRelease> = entries
        .into_iter()
        .filter(|entry| !entry.pre_release)
        .filter_map(|entry| {
            let rv = entry.release_version?;
            // 只保留 Python 3 且非预发布的稳定版本
            if !rv.version.starts_with('3') {
                return None;
            }
            Some(PythonOrgRelease {
                version: rv.version,
                release_date: entry.release_date,
                release_page_url: entry.release_page_url,
                is_latest: rv.is_latest,
            })
        })
        .collect();

    releases.sort_by(|a, b| version_key(&b.version).cmp(&version_key(&a.version)));
    Ok(releases)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_python_version_string_full() {
        let v = PythonVersion::parse("Python 3.10.4").unwrap();
        assert_eq!(
            v,
            PythonVersion {
                major: 3,
                minor: 10,
                patch: 4,
            }
        );
    }

    #[test]
    fn parse_python_version_string_without_patch() {
        let v = PythonVersion::parse("python 3.9").unwrap();
        assert_eq!(
            v,
            PythonVersion {
                major: 3,
                minor: 9,
                patch: 0,
            }
        );
    }

    #[test]
    fn parse_python_version_string_case_insensitive() {
        let v = PythonVersion::parse("PYTHON 3.11.2").unwrap();
        assert_eq!(
            v,
            PythonVersion {
                major: 3,
                minor: 11,
                patch: 2,
            }
        );
    }

    #[test]
    fn parse_python_version_string_invalid() {
        assert!(PythonVersion::parse("not a version").is_none());
        assert!(PythonVersion::parse("2").is_none());
    }

    #[test]
    fn python_version_display_and_semver() {
        let v = PythonVersion {
            major: 3,
            minor: 8,
            patch: 12,
        };
        assert_eq!(v.to_string(), "3.8.12");
        assert_eq!(v.to_semver_string(), "3.8.12");
    }
}
