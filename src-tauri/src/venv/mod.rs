//! 虚拟环境管理模块
//!
//! 提供虚拟环境的创建、删除、克隆、导出、依赖管理、快照等功能。
//! 所有公共 API 均预留，供未来模块扩展使用。

#![allow(dead_code)]

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use thiserror::Error;

use crate::security;

const PROCESS_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VirtualEnvironment {
    pub id: String,
    pub name: String,
    pub python_version: String,
    pub path: String,
    pub size_bytes: u64,
    pub packages_count: usize,
    pub status: String,
    #[serde(with = "chrono::serde::ts_seconds")]
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Dependency {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DependencyNode {
    pub name: String,
    pub version: String,
    pub children: Vec<DependencyNode>,
}

#[derive(Debug, Error)]
pub enum VenvError {
    #[error("IO error: {0}")]
    Io(#[from] io::Error),
    #[error("Command failed: {0}")]
    CommandFailed(String),
    #[error("Command timed out after {0:?}")]
    Timeout(Duration),
    #[error("Invalid path: {0}")]
    InvalidPath(PathBuf),
    #[error("Path traversal detected: {0}")]
    PathTraversal(PathBuf),
    #[error("JSON parse error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("UTF-8 error: {0}")]
    Utf8(#[from] std::string::FromUtf8Error),
}

pub type Result<T> = std::result::Result<T, VenvError>;

impl From<security::SecurityError> for VenvError {
    fn from(err: security::SecurityError) -> Self {
        match err {
            security::SecurityError::PathTraversal(p) => VenvError::PathTraversal(p),
            security::SecurityError::InvalidPath(p) => VenvError::InvalidPath(p),
            security::SecurityError::Io(e) => VenvError::Io(e),
            security::SecurityError::CommandFailed(s) => VenvError::CommandFailed(s),
            security::SecurityError::Timeout(d) => VenvError::Timeout(d),
            other => VenvError::CommandFailed(other.to_string()),
        }
    }
}

#[derive(Debug, Default)]
pub struct VenvManager;

impl VenvManager {
    pub fn new() -> Self {
        Self
    }
}

/// Returns the list of directories under which venv operations are allowed.
fn allowed_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(config_dir) = dirs::config_dir() {
        roots.push(config_dir.join("pyforge-ai"));
    }
    if let Some(data_dir) = dirs::data_dir() {
        roots.push(data_dir.join("pyforge-ai"));
    }
    if let Ok(cwd) = std::env::current_dir() {
        roots.push(cwd.join("venvs"));
    }
    roots
}

/// Resolves a path to an absolute path, canonicalizing it if it already exists.
fn canonicalize_or_abs(path: &Path) -> Result<PathBuf> {
    if path.exists() {
        Ok(fs::canonicalize(path)?)
    } else {
        let abs = if path.is_absolute() {
            path.to_path_buf()
        } else {
            std::env::current_dir()?.join(path)
        };
        Ok(abs)
    }
}

fn system_time_to_chrono(time: SystemTime) -> DateTime<Utc> {
    let duration = time.duration_since(UNIX_EPOCH).unwrap_or_default();
    DateTime::from_timestamp(duration.as_secs() as i64, duration.subsec_nanos())
        .unwrap_or_else(|| Utc::now())
}

fn dir_size(path: &Path) -> Result<u64> {
    let mut total = 0u64;
    if path.is_dir() {
        for entry in fs::read_dir(path)? {
            let entry = entry?;
            let metadata = entry.metadata()?;
            if metadata.is_dir() {
                total += dir_size(&entry.path())?;
            } else {
                total += metadata.len();
            }
        }
    } else {
        total += fs::metadata(path)?.len();
    }
    Ok(total)
}

fn python_executable_from_venv(path: &Path) -> PathBuf {
    if cfg!(target_os = "windows") {
        path.join("Scripts").join("python.exe")
    } else {
        path.join("bin").join("python")
    }
}

fn pip_executable_from_venv(path: &Path) -> PathBuf {
    if cfg!(target_os = "windows") {
        path.join("Scripts").join("pip.exe")
    } else {
        path.join("bin").join("pip")
    }
}

fn run_command_with_timeout(cmd: &mut Command, timeout: Duration) -> Result<(String, String)> {
    let mut child = cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()?;

    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");

    let stdout_handle = thread::spawn(move || {
        let mut buf = String::new();
        let mut reader = stdout;
        io::Read::read_to_string(&mut reader, &mut buf).map(|_| buf)
    });

    let stderr_handle = thread::spawn(move || {
        let mut buf = String::new();
        let mut reader = stderr;
        io::Read::read_to_string(&mut reader, &mut buf).map(|_| buf)
    });

    let start = Instant::now();
    let status = loop {
        match child.try_wait()? {
            Some(status) => break status,
            None => {
                if start.elapsed() >= timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(VenvError::Timeout(timeout));
                }
                thread::sleep(Duration::from_millis(100));
            }
        }
    };

    let stdout = stdout_handle
        .join()
        .map_err(|_| VenvError::CommandFailed("stdout reader panicked".to_string()))??;
    let stderr = stderr_handle
        .join()
        .map_err(|_| VenvError::CommandFailed("stderr reader panicked".to_string()))??;

    if !status.success() {
        return Err(VenvError::CommandFailed(format!(
            "exit code {:?}: {}",
            status.code(),
            stderr.trim()
        )));
    }

    Ok((stdout, stderr))
}

pub fn list_venvs(root_path: &Path) -> Vec<VirtualEnvironment> {
    let mut result = Vec::new();
    if security::validate_path(root_path, &allowed_roots()).is_err() {
        return result;
    }
    let Ok(root) = canonicalize_or_abs(root_path) else {
        return result;
    };
    let Ok(entries) = fs::read_dir(&root) else {
        return result;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let py_exec = python_executable_from_venv(&path);
        if !py_exec.exists() {
            continue;
        }

        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string();

        let python_version = match get_python_version(&py_exec) {
            Ok(v) => v,
            Err(_) => "unknown".to_string(),
        };

        let size_bytes = dir_size(&path).unwrap_or(0);
        let packages_count = match get_dependencies_count(&path) {
            Ok(c) => c,
            Err(_) => 0,
        };

        let created_at = match fs::metadata(&path).and_then(|m| m.created()) {
            Ok(t) => system_time_to_chrono(t),
            Err(_) => Utc::now(),
        };

        let status = if py_exec.exists() { "active" } else { "broken" }.to_string();

        result.push(VirtualEnvironment {
            id: name.clone(),
            name,
            python_version,
            path: path.to_string_lossy().to_string(),
            size_bytes,
            packages_count,
            status,
            created_at,
        });
    }

    result
}

fn get_python_version(python_path: &Path) -> Result<String> {
    let (stdout, _) =
        run_command_with_timeout(&mut Command::new(python_path).arg("--version"), PROCESS_TIMEOUT)?;
    Ok(stdout.trim().to_string())
}

fn get_dependencies_count(path: &Path) -> Result<usize> {
    let pip = pip_executable_from_venv(path);
    if !pip.exists() {
        return Ok(0);
    }
    let (stdout, _) = run_command_with_timeout(
        &mut Command::new(&pip).args(["list", "--format=json"]),
        PROCESS_TIMEOUT,
    )?;
    let deps: Vec<Dependency> = serde_json::from_str(&stdout)?;
    Ok(deps.len())
}

pub fn create_venv(
    name: &str,
    python_path: &Path,
    target_dir: &Path,
) -> Result<VirtualEnvironment> {
    let target_candidate = target_dir.join(name);
    security::validate_path(&target_candidate, &allowed_roots())?;
    let target = canonicalize_or_abs(&target_candidate)?;
    if target.exists() {
        return Err(VenvError::CommandFailed(format!(
            "target directory already exists: {}",
            target.display()
        )));
    }

    security::validate_path(python_path, &[])?;
    let python = canonicalize_or_abs(python_path)?;
    run_command_with_timeout(
        &mut Command::new(&python).arg("-m").arg("venv").arg(&target),
        PROCESS_TIMEOUT,
    )?;

    let py_exec = python_executable_from_venv(&target);
    let python_version = match get_python_version(&py_exec) {
        Ok(v) => v,
        Err(_) => "unknown".to_string(),
    };

    Ok(VirtualEnvironment {
        id: name.to_string(),
        name: name.to_string(),
        python_version,
        path: target.to_string_lossy().to_string(),
        size_bytes: dir_size(&target)?,
        packages_count: 0,
        status: "active".to_string(),
        created_at: Utc::now(),
    })
}

pub fn remove_venv(path: &Path) -> Result<()> {
    security::validate_path(path, &allowed_roots())?;
    let target = canonicalize_or_abs(path)?;
    if !target.exists() {
        return Err(VenvError::InvalidPath(target));
    }
    if target.is_dir() {
        fs::remove_dir_all(&target)?;
    } else {
        fs::remove_file(&target)?;
    }
    Ok(())
}

fn copy_dir_all(src: &Path, dst: &Path) -> Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        let metadata = entry.metadata()?;
        if metadata.is_dir() {
            copy_dir_all(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

pub fn clone_venv(source: &Path, target: &Path) -> Result<VirtualEnvironment> {
    security::validate_path(source, &allowed_roots())?;
    security::validate_path(target, &allowed_roots())?;
    let src = canonicalize_or_abs(source)?;
    let dst = canonicalize_or_abs(target)?;

    if !src.exists() || !src.is_dir() {
        return Err(VenvError::InvalidPath(src));
    }
    if dst.exists() {
        return Err(VenvError::CommandFailed(format!(
            "target directory already exists: {}",
            dst.display()
        )));
    }

    copy_dir_all(&src, &dst)?;

    let py_exec = python_executable_from_venv(&dst);
    let python_version = match get_python_version(&py_exec) {
        Ok(v) => v,
        Err(_) => "unknown".to_string(),
    };

    let name = dst
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("cloned")
        .to_string();

    let created_at = match fs::metadata(&dst).and_then(|m| m.created()) {
        Ok(t) => system_time_to_chrono(t),
        Err(_) => Utc::now(),
    };

    Ok(VirtualEnvironment {
        id: name.clone(),
        name,
        python_version,
        path: dst.to_string_lossy().to_string(),
        size_bytes: dir_size(&dst)?,
        packages_count: get_dependencies_count(&dst).unwrap_or(0),
        status: "active".to_string(),
        created_at,
    })
}

pub fn export_venv(path: &Path) -> Result<String> {
    security::validate_path(path, &allowed_roots())?;
    let target = canonicalize_or_abs(path)?;
    let pip = pip_executable_from_venv(&target);
    if !pip.exists() {
        return Err(VenvError::CommandFailed(
            "pip executable not found in virtual environment".to_string(),
        ));
    }
    let (stdout, _) =
        run_command_with_timeout(&mut Command::new(&pip).args(["freeze"]), PROCESS_TIMEOUT)?;
    Ok(stdout)
}

pub fn get_dependencies(path: &Path) -> Result<Vec<Dependency>> {
    security::validate_path(path, &allowed_roots())?;
    let target = canonicalize_or_abs(path)?;
    let pip = pip_executable_from_venv(&target);
    if !pip.exists() {
        return Err(VenvError::CommandFailed(
            "pip executable not found in virtual environment".to_string(),
        ));
    }
    let (stdout, _) = run_command_with_timeout(
        &mut Command::new(&pip).args(["list", "--format=json"]),
        PROCESS_TIMEOUT,
    )?;
    let mut deps: Vec<Dependency> = serde_json::from_str(&stdout)?;
    deps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(deps)
}

#[derive(Debug, serde::Deserialize)]
struct PipdeptreeEntry {
    key: String,
    package_name: String,
    installed_version: String,
    dependencies: Vec<PipdeptreeDependency>,
}

#[derive(Debug, serde::Deserialize)]
struct PipdeptreeDependency {
    package_name: String,
    installed_version: String,
}

pub fn get_dependency_tree(path: &Path) -> Result<DependencyNode> {
    security::validate_path(path, &allowed_roots())?;
    let target = canonicalize_or_abs(path)?;
    let pip = pip_executable_from_venv(&target);
    if !pip.exists() {
        return Err(VenvError::CommandFailed(
            "pip executable not found in virtual environment".to_string(),
        ));
    }

    // Try pipdeptree --json-tree first via the venv Python interpreter.
    let py_exec = python_executable_from_venv(&target);
    match run_command_with_timeout(
        &mut Command::new(&py_exec).args(["-m", "pipdeptree", "--json-tree"]),
        PROCESS_TIMEOUT,
    ) {
        Ok((stdout, _)) => {
            let entries: Vec<PipdeptreeEntry> = serde_json::from_str(&stdout)?;
            return Ok(build_tree(entries));
        }
        Err(_) => {
            // Fallback: build a shallow tree from pip list.
            let deps = get_dependencies(&target)?;
            let children = deps
                .into_iter()
                .map(|d| DependencyNode {
                    name: d.name,
                    version: d.version,
                    children: Vec::new(),
                })
                .collect();
            Ok(DependencyNode {
                name: target
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("environment")
                    .to_string(),
                version: String::new(),
                children,
            })
        }
    }
}

fn build_tree(entries: Vec<PipdeptreeEntry>) -> DependencyNode {
    let children: Vec<DependencyNode> = entries
        .iter()
        .map(|entry| DependencyNode {
            name: entry.package_name.clone(),
            version: entry.installed_version.clone(),
            children: entry
                .dependencies
                .iter()
                .map(|dep| DependencyNode {
                    name: dep.package_name.clone(),
                    version: dep.installed_version.clone(),
                    children: Vec::new(),
                })
                .collect(),
        })
        .collect();

    DependencyNode {
        name: "environment".to_string(),
        version: String::new(),
        children,
    }
}

#[allow(dead_code)]
fn is_inside_root(path: &Path, root: &Path) -> bool {
    let roots = vec![root.to_path_buf()];
    security::validate_path(path, &roots).is_ok()
}

// ============================================================================
// 企业级增强功能
// ============================================================================

/// 虚拟环境快照。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VenvSnapshot {
    /// 快照 ID
    pub id: String,
    /// 虚拟环境名称
    pub venv_name: String,
    /// 虚拟环境路径
    pub venv_path: String,
    /// Python 版本
    pub python_version: String,
    /// 快照创建时间
    pub created_at: DateTime<Utc>,
    /// 依赖列表（requirements.txt 格式）
    pub requirements: String,
    /// 包数量
    pub packages_count: usize,
    /// 快照描述
    pub description: Option<String>,
}

/// 虚拟环境修复结果。
#[derive(Debug, Clone, Serialize)]
pub struct VenvRepairResult {
    /// 是否修复成功
    pub success: bool,
    /// 执行的修复操作
    pub actions: Vec<String>,
    /// 修复输出
    pub output: String,
    /// 仍存在的问题
    pub remaining_issues: Vec<String>,
}

/// 虚拟环境验证结果。
#[derive(Debug, Clone, Serialize)]
pub struct VenvValidationResult {
    /// 虚拟环境路径
    pub path: String,
    /// 是否有效
    pub valid: bool,
    /// Python 可执行文件是否存在
    pub python_exists: bool,
    /// pip 是否可用
    pub pip_available: bool,
    /// pyvenv.cfg 是否存在且有效
    pub config_valid: bool,
    /// 站点包目录是否存在
    pub site_packages_exists: bool,
    /// 问题列表
    pub issues: Vec<String>,
}

/// 验证虚拟环境的完整性。
pub fn validate_venv(path: &Path) -> Result<VenvValidationResult> {
    security::validate_path(path, &allowed_roots())?;
    let target = canonicalize_or_abs(path)?;

    let mut issues = Vec::new();

    // 检查 Python 可执行文件
    let py_exec = python_executable_from_venv(&target);
    let python_exists = py_exec.exists();
    if !python_exists {
        issues.push(format!("Python 可执行文件不存在: {}", py_exec.display()));
    }

    // 检查 pip
    let pip_exec = pip_executable_from_venv(&target);
    let pip_available = pip_exec.exists();
    if !pip_available {
        issues.push("pip 可执行文件不存在".to_string());
    }

    // 检查 pyvenv.cfg
    let config_file = target.join("pyvenv.cfg");
    let config_valid = if config_file.exists() {
        match std::fs::read_to_string(&config_file) {
            Ok(content) => {
                let has_home = content.contains("home =");
                let has_version = content.contains("version =");
                if !has_home {
                    issues.push("pyvenv.cfg 缺少 home 配置".to_string());
                }
                if !has_version {
                    issues.push("pyvenv.cfg 缺少 version 配置".to_string());
                }
                has_home && has_version
            }
            Err(e) => {
                issues.push(format!("读取 pyvenv.cfg 失败: {}", e));
                false
            }
        }
    } else {
        issues.push("pyvenv.cfg 不存在".to_string());
        false
    };

    // 检查站点包目录
    let site_packages = if cfg!(target_os = "windows") {
        target.join("Lib").join("site-packages")
    } else {
        // Linux/macOS: lib/pythonX.Y/site-packages
        let mut found = false;
        let mut sp = PathBuf::new();
        if let Ok(lib_dir) = std::fs::read_dir(target.join("lib")) {
            for entry in lib_dir.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with("python") {
                    let candidate = entry.path().join("site-packages");
                    if candidate.exists() {
                        sp = candidate;
                        found = true;
                        break;
                    }
                }
            }
        }
        if !found {
            sp = target.join("lib").join("site-packages");
        }
        sp
    };
    let site_packages_exists = site_packages.exists();
    if !site_packages_exists {
        issues.push(format!("站点包目录不存在: {}", site_packages.display()));
    }

    let valid = python_exists && pip_available && config_valid && site_packages_exists;

    Ok(VenvValidationResult {
        path: target.to_string_lossy().to_string(),
        valid,
        python_exists,
        pip_available,
        config_valid,
        site_packages_exists,
        issues,
    })
}

/// 修复虚拟环境（重新安装 pip、修复配置等）。
pub fn repair_venv(path: &Path) -> Result<VenvRepairResult> {
    security::validate_path(path, &allowed_roots())?;
    let target = canonicalize_or_abs(path)?;

    let mut actions = Vec::new();
    let mut output_parts = Vec::new();
    let mut remaining_issues = Vec::new();

    let py_exec = python_executable_from_venv(&target);
    if !py_exec.exists() {
        remaining_issues.push("Python 可执行文件不存在，无法自动修复，请重新创建环境".to_string());
        return Ok(VenvRepairResult {
            success: false,
            actions,
            output: output_parts.join("\n"),
            remaining_issues,
        });
    }

    // 1. 尝试 ensurepip 重新安装 pip
    actions.push("重新安装 pip (ensurepip)".to_string());
    match run_command_with_timeout(
        &mut Command::new(&py_exec).args(["-m", "ensurepip", "--upgrade"]),
        PROCESS_TIMEOUT,
    ) {
        Ok((stdout, stderr)) => {
            output_parts.push(format!("[ensurepip]\n{}\n{}", stdout, stderr));
        }
        Err(e) => {
            remaining_issues.push(format!("ensurepip 失败: {}", e));
        }
    }

    // 2. 升级 pip
    actions.push("升级 pip 到最新版本".to_string());
    match run_command_with_timeout(
        &mut Command::new(&py_exec).args(["-m", "pip", "install", "--upgrade", "pip"]),
        PROCESS_TIMEOUT,
    ) {
        Ok((stdout, stderr)) => {
            output_parts.push(format!("[pip upgrade]\n{}\n{}", stdout, stderr));
        }
        Err(e) => {
            remaining_issues.push(format!("pip 升级失败: {}", e));
        }
    }

    // 3. 安装/升级 setuptools 和 wheel
    actions.push("安装/升级 setuptools 和 wheel".to_string());
    match run_command_with_timeout(
        &mut Command::new(&py_exec).args([
            "-m", "pip", "install", "--upgrade", "setuptools", "wheel",
        ]),
        PROCESS_TIMEOUT,
    ) {
        Ok((stdout, stderr)) => {
            output_parts.push(format!("[setuptools/wheel]\n{}\n{}", stdout, stderr));
        }
        Err(e) => {
            remaining_issues.push(format!("setuptools/wheel 安装失败: {}", e));
        }
    }

    let success = remaining_issues.is_empty();

    Ok(VenvRepairResult {
        success,
        actions,
        output: output_parts.join("\n"),
        remaining_issues,
    })
}

/// 创建虚拟环境快照（保存依赖列表）。
pub fn create_snapshot(path: &Path, description: Option<String>) -> Result<VenvSnapshot> {
    security::validate_path(path, &allowed_roots())?;
    let target = canonicalize_or_abs(path)?;

    let name = target
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    let py_exec = python_executable_from_venv(&target);
    let python_version = if py_exec.exists() {
        match get_python_version(&py_exec) {
            Ok(v) => v,
            Err(_) => "unknown".to_string(),
        }
    } else {
        "unknown".to_string()
    };

    let requirements = export_venv(&target)?;
    let packages_count = requirements.lines().filter(|l| !l.trim().is_empty()).count();

    let snapshot_id = format!(
        "snap-{}-{}",
        name,
        chrono::Utc::now().format("%Y%m%d-%H%M%S")
    );

    // 保存快照到元数据目录
    if let Some(data_dir) = dirs::data_dir() {
        let snapshot_dir = data_dir.join("pyforge-ai").join("snapshots");
        std::fs::create_dir_all(&snapshot_dir)?;
        let snapshot_file = snapshot_dir.join(format!("{}.json", snapshot_id));
        let snapshot = VenvSnapshot {
            id: snapshot_id.clone(),
            venv_name: name.clone(),
            venv_path: target.to_string_lossy().to_string(),
            python_version,
            created_at: Utc::now(),
            requirements: requirements.clone(),
            packages_count,
            description,
        };
        let json = serde_json::to_string_pretty(&snapshot)?;
        std::fs::write(&snapshot_file, json)?;
        return Ok(snapshot);
    }

    Ok(VenvSnapshot {
        id: snapshot_id,
        venv_name: name,
        venv_path: target.to_string_lossy().to_string(),
        python_version,
        created_at: Utc::now(),
        requirements,
        packages_count,
        description,
    })
}

/// 列出所有已保存的快照。
pub fn list_snapshots() -> Result<Vec<VenvSnapshot>> {
    let mut snapshots = Vec::new();

    if let Some(data_dir) = dirs::data_dir() {
        let snapshot_dir = data_dir.join("pyforge-ai").join("snapshots");
        if snapshot_dir.exists() {
            for entry in std::fs::read_dir(&snapshot_dir)? {
                let entry = entry?;
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) == Some("json") {
                    if let Ok(content) = std::fs::read_to_string(&path) {
                        if let Ok(snapshot) = serde_json::from_str::<VenvSnapshot>(&content) {
                            snapshots.push(snapshot);
                        }
                    }
                }
            }
        }
    }

    snapshots.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(snapshots)
}

/// 从快照恢复虚拟环境依赖。
pub fn restore_from_snapshot(snapshot_id: &str, target_venv: &Path) -> Result<String> {
    let snapshots = list_snapshots()?;
    let snapshot = snapshots
        .iter()
        .find(|s| s.id == snapshot_id)
        .ok_or_else(|| VenvError::CommandFailed(format!("快照不存在: {}", snapshot_id)))?;

    security::validate_path(target_venv, &allowed_roots())?;
    let target = canonicalize_or_abs(target_venv)?;
    let py_exec = python_executable_from_venv(&target);

    if !py_exec.exists() {
        return Err(VenvError::CommandFailed(
            "目标虚拟环境中 Python 不存在".to_string(),
        ));
    }

    // 写入临时 requirements 文件
    let temp_req = std::env::temp_dir().join(format!("pyforge-restore-{}.txt", snapshot_id));
    std::fs::write(&temp_req, &snapshot.requirements)?;

    let result = run_command_with_timeout(
        &mut Command::new(&py_exec).args(["-m", "pip", "install", "-r"]).arg(&temp_req),
        PROCESS_TIMEOUT,
    );

    let _ = std::fs::remove_file(&temp_req);

    match result {
        Ok((stdout, _)) => Ok(stdout),
        Err(e) => Err(VenvError::CommandFailed(format!("恢复依赖失败: {}", e))),
    }
}

/// 删除快照。
pub fn delete_snapshot(snapshot_id: &str) -> Result<()> {
    if let Some(data_dir) = dirs::data_dir() {
        let snapshot_file = data_dir
            .join("pyforge-ai")
            .join("snapshots")
            .join(format!("{}.json", snapshot_id));
        if snapshot_file.exists() {
            std::fs::remove_file(&snapshot_file)?;
        }
    }
    Ok(())
}

/// 导出虚拟环境为可迁移的压缩包（仅依赖列表 + 元数据）。
pub fn export_portable(path: &Path) -> Result<String> {
    security::validate_path(path, &allowed_roots())?;
    let target = canonicalize_or_abs(path)?;

    let name = target
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("venv")
        .to_string();

    let py_exec = python_executable_from_venv(&target);
    let python_version = if py_exec.exists() {
        match get_python_version(&py_exec) {
            Ok(v) => v,
            Err(_) => "unknown".to_string(),
        }
    } else {
        "unknown".to_string()
    };

    let requirements = export_venv(&target)?;

    // 生成导出脚本
    let export_content = format!(
        "# PyForge AI 虚拟环境导出\n\
         # 环境名称: {name}\n\
         # Python 版本: {python_version}\n\
         # 导出时间: {now}\n\
         #\n\
         # 恢复方法:\n\
         #   python -m venv <env_name>\n\
         #   <env_name>/Scripts/activate (Windows) 或 source <env_name>/bin/activate (Linux/macOS)\n\
         #   pip install -r requirements.txt\n\
         \n\
         # === requirements.txt ===\n\
         {requirements}\n",
        name = name,
        python_version = python_version,
        now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S UTC"),
        requirements = requirements
    );

    Ok(export_content)
}

/// 获取虚拟环境的磁盘使用详情。
pub fn get_venv_disk_usage(path: &Path) -> Result<serde_json::Value> {
    security::validate_path(path, &allowed_roots())?;
    let target = canonicalize_or_abs(path)?;

    let total_size = dir_size(&target)?;

    let mut breakdown = serde_json::Map::new();

    // 统计各子目录大小
    if let Ok(entries) = std::fs::read_dir(&target) {
        for entry in entries.flatten() {
            let entry_path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            let size = if entry_path.is_dir() {
                dir_size(&entry_path).unwrap_or(0)
            } else {
                entry.metadata().map(|m| m.len()).unwrap_or(0)
            };
            breakdown.insert(name, serde_json::Value::from(size));
        }
    }

    Ok(serde_json::json!({
        "total_bytes": total_size,
        "total_mb": (total_size as f64) / (1024.0 * 1024.0),
        "breakdown": breakdown,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn virtual_environment_serializes_required_fields() {
        let env = VirtualEnvironment {
            id: "test-env".to_string(),
            name: "test-env".to_string(),
            python_version: "3.10.4".to_string(),
            path: "/tmp/test-env".to_string(),
            size_bytes: 1024,
            packages_count: 5,
            status: "active".to_string(),
            created_at: chrono::Utc::now(),
        };
        let json = serde_json::to_string(&env).unwrap();
        assert!(json.contains("\"id\":\"test-env\""));
        assert!(json.contains("\"name\":\"test-env\""));
        assert!(json.contains("\"python_version\":\"3.10.4\""));
        assert!(json.contains("\"path\":\"/tmp/test-env\""));
        assert!(json.contains("\"size_bytes\":1024"));
        assert!(json.contains("\"packages_count\":5"));
        assert!(json.contains("\"status\":\"active\""));
        assert!(json.contains("\"created_at\":"));
    }

    #[test]
    fn virtual_environment_roundtrips_through_json() {
        let env = VirtualEnvironment {
            id: "roundtrip-env".to_string(),
            name: "Roundtrip Env".to_string(),
            python_version: "3.11.2".to_string(),
            path: "/home/user/.venvs/roundtrip-env".to_string(),
            size_bytes: 4096,
            packages_count: 3,
            status: "active".to_string(),
            created_at: Utc::now(),
        };
        let json = serde_json::to_string(&env).unwrap();
        let restored: VirtualEnvironment = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.id, env.id);
        assert_eq!(restored.name, env.name);
        assert_eq!(restored.python_version, env.python_version);
        assert_eq!(restored.path, env.path);
        assert_eq!(restored.size_bytes, env.size_bytes);
        assert_eq!(restored.packages_count, env.packages_count);
        assert_eq!(restored.status, env.status);
        assert_eq!(restored.created_at.timestamp(), env.created_at.timestamp());
    }

    #[test]
    fn validate_path_accepts_child_of_root() {
        let root = std::env::current_dir().unwrap();
        assert!(is_inside_root(Path::new("src"), &root));
    }

    #[test]
    fn validate_path_rejects_traversal_within_venv() {
        let root = std::env::current_dir().unwrap();
        assert!(!is_inside_root(Path::new("../foo"), &root));
    }

    #[test]
    fn allowed_roots_is_non_empty() {
        let roots = allowed_roots();
        assert!(!roots.is_empty());
    }
}
