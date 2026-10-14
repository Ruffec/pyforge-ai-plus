//! Python 一键安装与彻底卸载模块
//!
//! ## 安装
//! 从 python.org 官方 FTP 按版本号确定性构造安装包 URL 并流式下载（带进度事件）：
//! - Windows：官方 bootstrapper 静默安装（支持自定义 TargetDir、64/32/arm64、
//!   每用户或全机器安装、PrependPath），结束后校验 `python.exe --version`。
//! - macOS：下载官方 pkg，经 osascript 提权执行 `installer -pkg`（系统级框架目录）。
//! - Linux：下载官方源码 tarball（不做自动编译，返回明确指引）。
//!
//! ## 卸载（彻底清理）
//! 1. 五态前置守卫：存在性 → 有效性（`--version` 可解析）→ 危险路径拒绝
//!    （磁盘根目录 / Windows 目录 / Store 托管 WindowsApps / 应用自身目录 /
//!    用户主目录根）→ 依赖虚拟环境扫描（pyvenv.cfg home 指向目标目录时需 force）；
//! 2. 优先调用官方卸载器（Inno Setup 静默参数，注册表自动匹配 UninstallString），
//!    提权失败时自动回退 PowerShell RunAs；官方卸载器不可用时走手动清理；
//! 3. 残留清理（可选项）：
//!    - 文件：安装目录（带退避重试删除）、pip 用户级站点目录 `%APPDATA%\Python\Python{MM}`；
//!    - 注册表：`PythonCore\{tag}`（HKCU/HKLM/WOW6432Node，PEP 514）、卸载表项
//!      （仅当 InstallLocation 精确匹配或 DisplayName+unins000 双重匹配时删除）；
//!    - 环境变量：HKCU/HKLM 的 `Path`（保留 REG_EXPAND_SZ 类型）、PYTHONHOME、
//!      PYTHONPATH，并向系统广播 WM_SETTINGCHANGE 使 Explorer 立即生效。
//!
//! 所有子进程以 CREATE_NO_WINDOW 启动，避免桌面端闪现控制台窗口。

use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;

use super::{PythonError, PythonVersion};
use crate::events::TaskProgressEvent;

/// Windows `CREATE_NO_WINDOW`：子进程不创建控制台窗口。
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

// ============================================================================
// 版本与下载 URL 构造（纯函数，可测）
// ============================================================================

/// Windows 安装包架构。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstArch {
    X64,
    X86,
    Arm64,
}

impl InstArch {
    /// 从前端字符串解析架构（默认 64 位）。
    pub fn parse(s: Option<&str>) -> Self {
        match s.unwrap_or("").to_ascii_lowercase().as_str() {
            "32" | "x86" | "win32" => InstArch::X86,
            "arm64" => InstArch::Arm64,
            _ => InstArch::X64,
        }
    }
}

/// 将 "3.12" / "3.12.4" 归一化为三段式完整版本号（缺省补 .0）。
pub fn normalize_full_version(version: &str) -> Option<String> {
    let parts: Vec<u32> = version
        .split('.')
        .map(|p| p.trim().parse())
        .collect::<Result<Vec<_>, _>>()
        .ok()?;
    if parts.is_empty() || parts.len() > 3 || parts[0] != 3 {
        return None;
    }
    let p1 = parts.get(1).copied().unwrap_or(0);
    let p2 = parts.get(2).copied().unwrap_or(0);
    Some(format!("{}.{}.{}", parts[0], p1, p2))
}

/// 提取 "3.12.4" → "3.12" 形式的 PEP 514 版本标签。
pub fn version_tag(version: &str) -> Option<String> {
    let v = PythonVersion::parse(version)?;
    Some(format!("{}.{}", v.major, v.minor))
}

fn version_maj_min(version: &str) -> (u32, u32) {
    match PythonVersion::parse(version) {
        Some(v) => (v.major, v.minor),
        None => (0, 0),
    }
}

/// 构造 Windows 官方安装包 URL（python.org FTP，路径模式对 3.5+ 稳定）。
pub fn build_windows_installer_url(version: &str, arch: InstArch) -> Option<String> {
    let full = normalize_full_version(version)?;
    let file = match arch {
        InstArch::X64 => format!("python-{full}-amd64.exe"),
        InstArch::X86 => format!("python-{full}.exe"),
        InstArch::Arm64 => format!("python-{full}-arm64.exe"),
    };
    Some(format!("https://www.python.org/ftp/python/{full}/{file}"))
}

/// 构造 macOS 官方 pkg URL（3.10+ 为 macos11.pkg，更早为 macosx10.9.pkg）。
pub fn build_macos_pkg_url(version: &str) -> Option<String> {
    let full = normalize_full_version(version)?;
    let (maj, min) = version_maj_min(&full);
    let suffix = if (maj, min) >= (3, 10) {
        "macos11.pkg"
    } else {
        "macosx10.9.pkg"
    };
    Some(format!(
        "https://www.python.org/ftp/python/{full}/python-{full}-{suffix}"
    ))
}

/// 构造 Linux 源码 tarball URL。
pub fn build_linux_source_url(version: &str) -> Option<String> {
    let full = normalize_full_version(version)?;
    Some(format!(
        "https://www.python.org/ftp/python/{full}/Python-{full}.tgz"
    ))
}

// ============================================================================
// 安装目录校验（支持中文与特殊字符，拒绝危险/非法路径）
// ============================================================================

/// 安装目录校验结果。
#[derive(Debug, Clone, Serialize)]
pub struct DirValidation {
    pub valid: bool,
    pub writable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// Windows 保留设备名（不含扩展名部分比对）。
const WINDOWS_RESERVED_NAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// 判断路径是否落在危险区域（禁止安装/卸载），返回拒绝原因。
pub fn danger_reason(path: &Path) -> Option<String> {
    let lower = path.to_string_lossy().to_ascii_lowercase();
    let lower_norm = lower.trim_end_matches(['\\', '/']);

    // 磁盘根目录（C:\ 或 /）
    let is_root = path.parent().is_none()
        || Path::new(lower_norm).components().count() <= 1;
    if is_root {
        return Some("不能使用磁盘根目录作为 Python 安装/卸载目标".to_string());
    }

    // Windows 系统目录 / Store 托管目录
    let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".to_string());
    let system_root = system_root.to_ascii_lowercase();
    if lower_norm.starts_with(&system_root) {
        return Some("不能操作系统 Windows 目录".to_string());
    }
    if lower_norm.contains("windowsapps") {
        return Some(
            "该 Python 由 Microsoft Store 托管，请在「设置 → 应用」中卸载，应用无法代为操作"
                .to_string(),
        );
    }

    // 应用自身安装目录
    if let Ok(exe) = std::env::current_exe() {
        if let Some(app_dir) = exe.parent() {
            if same_location(&lower_norm, &app_dir.to_string_lossy()) {
                return Some("不能操作 PyForge AI 应用自身所在目录".to_string());
            }
        }
    }

    // 用户主目录根
    if let Some(profile) = dirs::home_dir() {
        if same_location(&lower_norm, &profile.to_string_lossy()) {
            return Some("不能使用用户主目录根作为目标".to_string());
        }
    }

    None
}

/// 宽松比较两个路径字符串是否指向同一位置（大小写/末尾分隔符不敏感）。
pub fn same_location(a: &str, b: &str) -> bool {
    let norm = |s: &str| s.trim().trim_end_matches(['\\', '/']).to_ascii_lowercase();
    norm(a) == norm(b)
}

/// 校验自定义安装目录的合法性、可写性与安全性。
pub fn validate_install_dir(path: &Path) -> DirValidation {
    let invalid = |reason: &str| DirValidation {
        valid: false,
        writable: false,
        reason: Some(reason.to_string()),
    };

    let raw = path.to_string_lossy();
    if raw.trim().is_empty() {
        return invalid("路径不能为空");
    }

    // 必须是绝对路径
    let abs_probe = PathBuf::from(raw.trim());
    if !abs_probe.is_absolute() {
        return invalid("必须是绝对路径（例如 D:\\Python\\Python312）");
    }

    // 非法字符（冒号仅允许盘符位置）
    for (idx, ch) in raw.char_indices() {
        if matches!(ch, '<' | '>' | '"' | '|' | '?' | '*') {
            return invalid(&format!("路径包含非法字符 «{ch}»"));
        }
        if ch == ':' && idx != 1 {
            return invalid("路径中仅允许盘符位置出现冒号");
        }
    }

    // 分段末尾的点/空格（Windows 会剥离，导致定位漂移）；保留设备名
    for seg in raw.split(['\\', '/']) {
        let seg = seg.trim();
        if seg.is_empty() {
            continue;
        }
        if seg.ends_with('.') || seg.ends_with(' ') {
            return invalid(&format!("路径段 «{seg}» 末尾不能是点或空格"));
        }
        let stem = seg.split('.').next().unwrap_or(seg).to_ascii_uppercase();
        if WINDOWS_RESERVED_NAMES.contains(&stem.as_str()) {
            return invalid(&format!("«{seg}» 是 Windows 保留设备名，不能使用"));
        }
    }

    // 危险区域
    if let Some(reason) = danger_reason(&abs_probe) {
        return invalid(&reason);
    }

    // 长度预算：为依赖树深层路径预留余量
    if raw.chars().count() > 200 {
        return invalid("路径过长（>200 字符），深层依赖路径可能超过系统上限");
    }

    // 可写性：探测最近一个已存在的祖先目录（不提前创建最终目录）
    let mut probe = abs_probe.clone();
    while !probe.exists() {
        match probe.parent() {
            Some(p) => probe = p.to_path_buf(),
            None => break,
        }
    }
    let writable = probe.is_dir() && {
        let test_file = probe.join(".pyforge_write_test");
        match std::fs::File::create(&test_file) {
            Ok(mut f) => {
                let ok = f.write_all(b"ok").is_ok();
                drop(f);
                let _ = std::fs::remove_file(&test_file);
                ok
            }
            Err(_) => false,
        }
    };
    if !writable {
        return DirValidation {
            valid: false,
            writable: false,
            reason: Some("目录不可写（可能需要管理员权限，或父目录不存在）".to_string()),
        };
    }

    DirValidation {
        valid: true,
        writable: true,
        reason: None,
    }
}

// ============================================================================
// 依赖虚拟环境扫描
// ============================================================================

/// 扫描配置的虚拟环境根目录，找出 pyvenv.cfg home 指向目标目录的 venv。
pub fn find_dependent_venvs(target_dir: &Path) -> Vec<String> {
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Ok(cfg) = crate::config::get_config() {
        if !cfg.venv.default_root.trim().is_empty() {
            roots.push(PathBuf::from(cfg.venv.default_root.trim()));
        }
        if !cfg.paths.venv_root.trim().is_empty() {
            roots.push(PathBuf::from(cfg.paths.venv_root.trim()));
        }
    }
    find_dependent_venvs_in_roots(target_dir, &roots)
}

/// 在给定根目录集合中扫描依赖 venv（根集合可注入，便于测试与未来扩展）。
pub fn find_dependent_venvs_in_roots(target_dir: &Path, roots: &[PathBuf]) -> Vec<String> {
    let mut found: Vec<String> = Vec::new();
    for root in roots {
        if root.is_dir() {
            walk_pyvenv(root, 0, 3, target_dir, &mut found);
        }
    }
    found.sort();
    found.dedup();
    found
}

fn walk_pyvenv(dir: &Path, depth: usize, max_depth: usize, target: &Path, out: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.filter_map(|e| e.ok()) {
        let p = entry.path();
        if !p.is_dir() || depth >= max_depth {
            continue;
        }
        let cfg = p.join("pyvenv.cfg");
        if cfg.is_file() {
            if venv_home_matches(&cfg, target) {
                out.push(p.to_string_lossy().to_string());
            }
        } else {
            walk_pyvenv(&p, depth + 1, max_depth, target, out);
        }
    }
}

fn venv_home_matches(cfg_path: &Path, target: &Path) -> bool {
    let Ok(content) = std::fs::read_to_string(cfg_path) else {
        return false;
    };
    for line in content.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("home") {
            let rest = rest.trim().strip_prefix('=').unwrap_or("").trim();
            let home = rest.trim_matches('"');
            if !home.is_empty() && same_location(home, &target.to_string_lossy()) {
                return true;
            }
        }
    }
    false
}

// ============================================================================
// 文件与子进程工具
// ============================================================================

/// 带退避重试的删除（Windows 文件锁释放通常 ≤610ms，退避预算覆盖之）。
pub fn remove_path_with_retry(path: &Path, max_attempts: u32, base_interval_ms: u64) -> Result<(), std::io::Error> {
    let mut last_err: Option<std::io::Error> = None;
    for attempt in 0..max_attempts {
        if !path.exists() {
            return Ok(());
        }
        let res = if path.is_dir() {
            std::fs::remove_dir_all(path)
        } else {
            std::fs::remove_file(path)
        };
        match res {
            Ok(()) => {
                if !path.exists() {
                    return Ok(());
                }
                last_err = Some(std::io::Error::other("删除调用成功但路径仍存在"));
            }
            Err(e) => last_err = Some(e),
        }
        std::thread::sleep(Duration::from_millis(base_interval_ms * (attempt as u64 + 1)));
    }
    Err(last_err.unwrap_or_else(|| std::io::Error::other("删除失败")))
}

#[cfg(target_os = "windows")]
fn spawn_command(cmd: &mut std::process::Command) -> std::io::Result<std::process::ExitStatus> {
    use std::os::windows::process::CommandExt as _;
    cmd.creation_flags(CREATE_NO_WINDOW).status()
}

#[cfg(not(target_os = "windows"))]
fn spawn_command(cmd: &mut std::process::Command) -> std::io::Result<std::process::ExitStatus> {
    cmd.status()
}

#[cfg(target_os = "windows")]
fn spawn_command_output(cmd: &mut std::process::Command) -> std::io::Result<std::process::Output> {
    use std::os::windows::process::CommandExt as _;
    cmd.creation_flags(CREATE_NO_WINDOW).output()
}

#[cfg(not(target_os = "windows"))]
fn spawn_command_output(cmd: &mut std::process::Command) -> std::io::Result<std::process::Output> {
    cmd.output()
}

/// 读取目标目录下 python.exe 的版本输出（“Python 3.12.4”）。
fn query_python_version(dir: &Path) -> Result<String, String> {
    let exe = dir.join(python_exe_name());
    if !exe.is_file() {
        return Err(format!("{} 不存在", exe.display()));
    }
    let mut cmd = std::process::Command::new(&exe);
    cmd.arg("--version");
    let output = spawn_command_output(&mut cmd).map_err(|e| e.to_string())?;
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    if PythonVersion::parse(&text).is_none() {
        return Err(format!("无法解析版本输出: {}", text.trim()));
    }
    Ok(text.trim().to_string())
}

fn python_exe_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "python.exe"
    } else {
        "bin/python3"
    }
}

/// 安装包缓存目录：`{配置的 Python 安装路径}\_installers`，无配置时回退应用数据目录。
fn installer_cache_dir() -> PathBuf {
    if let Ok(cfg) = crate::config::get_config() {
        let p = cfg.paths.python_installations_path.trim().to_string();
        if !p.is_empty() {
            return PathBuf::from(p).join("_installers");
        }
    }
    dirs::data_dir()
        .map(|d| d.join("pyforge-ai").join("installers"))
        .unwrap_or_else(std::env::temp_dir)
}

/// 单引号包裹并转义（用于 osascript / PowerShell 传参，杜绝注入）。
fn sq_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

// ============================================================================
// 下载
// ============================================================================

/// 流式下载文件并发送任务进度（progress_span.0 → progress_span.1 映射下载进度）。
async fn download_file(
    url: &str,
    dest: &Path,
    task_id: &str,
    task_type: &str,
    progress_span: (u8, u8),
) -> Result<PathBuf, PythonError> {
    use tokio::io::AsyncWriteExt;

    let (p_lo, p_hi) = (progress_span.0 as f32, progress_span.1 as f32);
    let map = |frac: f32| (p_lo + (p_hi - p_lo) * frac.clamp(0.0, 1.0)) as u8;

    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| PythonError::Io(format!("创建下载目录失败: {e}")))?;
    }

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .user_agent("PyForgeAI/0.1 (+python-installer)")
        .build()
        .map_err(|e| PythonError::Io(e.to_string()))?;

    let mut resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| PythonError::Io(format!("连接 python.org 失败: {e}")))?;
    if !resp.status().is_success() {
        return Err(PythonError::NotFound(format!(
            "python.org 未提供该下载（HTTP {}）：{url}",
            resp.status().as_u16()
        )));
    }

    let total = resp.content_length();
    let mut file = tokio::fs::File::create(dest)
        .await
        .map_err(|e| PythonError::Io(format!("创建下载文件失败: {e}")))?;

    let mut downloaded: u64 = 0;
    let mut last_progress: u8 = 0;
    let mut last_emit = std::time::Instant::now();
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| PythonError::Io(format!("下载中断: {e}")))?
    {
        file.write_all(&chunk)
            .await
            .map_err(|e| PythonError::Io(format!("写入下载文件失败: {e}")))?;
        downloaded += chunk.len() as u64;
        if let Some(total) = total {
            if total > 0 {
                let pct = map(downloaded as f32 / total as f32);
                // 进度至少变化 1% 或距上次推送 200ms 才发事件，避免刷屏
                if pct != last_progress || last_emit.elapsed() >= Duration::from_millis(200) {
                    last_progress = pct;
                    last_emit = std::time::Instant::now();
                    let _ = crate::events::update_task(TaskProgressEvent::progress(
                        task_id,
                        task_type,
                        pct,
                        format!(
                            "下载中 {:.1}/{:.1} MB",
                            downloaded as f32 / 1048576.0,
                            total as f32 / 1048576.0
                        ),
                    ));
                }
            }
        }
    }
    file.flush()
        .await
        .map_err(|e| PythonError::Io(e.to_string()))?;
    drop(file);

    if downloaded == 0 {
        return Err(PythonError::Io("下载内容为空".to_string()));
    }
    let _ = crate::events::update_task(TaskProgressEvent::progress(
        task_id,
        task_type,
        p_hi as u8,
        format!("下载完成（{:.1} MB）", downloaded as f32 / 1048576.0),
    ));
    Ok(dest.to_path_buf())
}

// ============================================================================
// 安装
// ============================================================================

/// 安装参数。
#[derive(Debug, Clone)]
pub struct InstallOptions {
    pub version: String,
    /// Windows 架构："64"（默认）| "32" | "arm64"
    pub arch: Option<String>,
    /// 自定义安装目录（None 时使用官方默认目录）
    pub install_dir: Option<String>,
    /// 是否全机器安装（需要管理员授权；默认 false 每用户安装，无 UAC）
    pub all_users: Option<bool>,
    /// 是否写入 PATH（默认 true，由官方安装器执行）
    pub prepend_path: Option<bool>,
}

/// 安装结果。
#[derive(Debug, Clone, Serialize)]
pub struct InstallResult {
    pub success: bool,
    pub version: String,
    pub task_id: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installed_path: Option<String>,
    pub reboot_required: bool,
    pub warnings: Vec<String>,
}

/// 执行一键安装（命令入口，异步）。
pub async fn install_python(opts: InstallOptions) -> Result<InstallResult, PythonError> {
    let full = normalize_full_version(&opts.version)
        .ok_or_else(|| PythonError::Parse(format!("仅支持 Python 3 版本号，收到: {}", opts.version)))?;
    let tag = version_tag(&full)
        .ok_or_else(|| PythonError::Parse(format!("无法解析版本标签: {full}")))?;

    let task_id = crate::uuid_v4();
    let task_type = "python_install";
    crate::events::register_task(&task_id, task_type)
        .map_err(|e| PythonError::Io(e.message.clone()))?;
    let _ = crate::events::update_task(TaskProgressEvent::started(
        &task_id,
        task_type,
        format!("准备安装 Python {full}"),
    ));

    let result = install_python_inner(&full, &tag, &opts, &task_id, task_type).await;

    match &result {
        Ok(res) => {
            let _ = crate::events::update_task(TaskProgressEvent::completed(
                &task_id,
                task_type,
                &res.message,
            ));
            if res.success {
                let _ = crate::events::emit_notification(
                    "Python 安装完成",
                    &format!("Python {full} 已安装到 {}", res.installed_path.as_deref().unwrap_or("默认目录")),
                    "success",
                );
            }
        }
        Err(e) => {
            let _ = crate::events::update_task(TaskProgressEvent::failed(&task_id, task_type, &e.to_string()));
        }
    }
    result.map(|mut r| {
        r.task_id = task_id;
        r
    })
}

async fn install_python_inner(
    full_src: &str,
    tag_src: &str,
    opts: &InstallOptions,
    task_id: &str,
    task_type: &str,
) -> Result<InstallResult, PythonError> {
    let full = full_src.to_string();
    let tag = tag_src.to_string();
    let os = std::env::consts::OS;
    let mut warnings: Vec<String> = Vec::new();

    // ---- 0. 缺陷⑥修复：安装路径参数显式校验（空/格式异常立即终止，杜绝参数丢失
    // 导致安装器忽略目录落错位置）----
    let install_dir: Option<String> = match opts.install_dir.as_deref() {
        None => None,
        Some(raw) => {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                return Err(PythonError::Platform(
                    "安装目录参数为空：请填写有效的安装路径，或清除该项以使用默认目录".to_string(),
                ));
            }
            let v = validate_install_dir(Path::new(trimmed));
            if !v.valid {
                crate::app_error!(
                    target: "pyforge_ai::installer",
                    "安装[参数校验] 目录非法，终止安装: {} — {:?}",
                    trimmed,
                    v.reason
                );
                return Err(PythonError::Platform(format!(
                    "安装目录校验失败，已终止安装：{}",
                    v.reason.unwrap_or_else(|| "路径不合法".to_string())
                )));
            }
            Some(trimmed.to_string())
        }
    };
    crate::app_info!(
        target: "pyforge_ai::installer",
        "安装[开始] version={} arch={:?} TargetDir={:?} all_users={:?} prepend_path={:?}",
        full,
        opts.arch,
        install_dir,
        opts.all_users,
        opts.prepend_path
    );

    // 1. 构造下载 URL
    let arch = InstArch::parse(opts.arch.as_deref());
    let (url, filename) = match os {
        "windows" => {
            let f = match arch {
                InstArch::X64 => format!("python-{full}-amd64.exe"),
                InstArch::X86 => format!("python-{full}-x86.exe"),
                InstArch::Arm64 => format!("python-{full}-arm64.exe"),
            };
            (build_windows_installer_url(&full, arch), f)
        }
        "macos" => (build_macos_pkg_url(&full), format!("python-{full}.pkg")),
        "linux" => (build_linux_source_url(&full), format!("Python-{full}.tgz")),
        _ => {
            return Err(PythonError::Platform(format!("不支持的平台: {os}")));
        }
    };
    let url = url.ok_or_else(|| PythonError::Parse(format!("无法构造 {full} 的下载地址")))?;
    let dest = installer_cache_dir().join(&filename);

    // 2. 下载（2 → 85 进度区间）
    let _ = crate::events::update_task(TaskProgressEvent::progress(
        task_id,
        task_type,
        2,
        format!("开始下载 {url}"),
    ));
    download_file(&url, &dest, task_id, task_type, (2, 85)).await?;

    // 3. 按平台执行安装（阻塞线程池；警告随结果返回，避免跨 await 借用）
    let all_users = opts.all_users.unwrap_or(false);
    let prepend_path = opts.prepend_path.unwrap_or(true);

    // 闭包需 'static：克隆进入阻塞线程，外层保留原值供后续校验与清理使用
    let full_inner = full.clone();
    let dest_inner = dest.clone();
    let (install_result, install_warnings) = spawn_blocking(move || match os {
        "windows" => install_windows(
            dest_inner.as_path(),
            &full_inner,
            &tag,
            install_dir.as_deref(),
            all_users,
            prepend_path,
        ),
        "macos" => install_macos(dest_inner.as_path(), &tag),
        _ => {
            let warns = vec!["Linux 平台仅下载官方源码包，自动化编译安装暂未支持；请解压后按 README 编译，或使用系统包管理器（apt/dnf/pacman）".to_string()];
            Ok((PathBuf::new(), warns))
        }
    })
    .await
    .map_err(|e| PythonError::Io(format!("安装线程失败: {e}")))?
    .map_err(|e: PythonError| e)?;

    warnings.extend(install_warnings);

    if os == "linux" {
        return Ok(InstallResult {
            success: true,
            version: full.clone(),
            task_id: String::new(),
            message: format!("源码包已下载到 {}（Linux 暂不支持自动化编译安装）", dest.display()),
            installed_path: Some(dest.display().to_string()),
            reboot_required: false,
            warnings,
        });
    }

    // 4. 校验安装结果（install_result 即安装根目录）
    let _ = crate::events::update_task(TaskProgressEvent::progress(
        task_id,
        task_type,
        95,
        "正在验证安装结果...",
    ));
    let version_output = query_python_version(&install_result)
        .map_err(|e| PythonError::Platform(format!("安装后校验失败: {e}")))?;
    let detected = PythonVersion::parse(&version_output).map(|v| v.to_semver_string());
    let maj_min = format!("{}.{}", version_maj_min(&full).0, version_maj_min(&full).1);
    if !detected
        .as_deref()
        .map(|d| d.starts_with(&maj_min))
        .unwrap_or(false)
    {
        return Err(PythonError::Platform(format!(
            "安装完成但版本校验不匹配：期望 {maj_min}.x，实际 {}",
            detected.as_deref().unwrap_or("未知")
        )));
    }

    // 5. 成功收尾：清缓存 + 重扫 + 广播（两端列表实时刷新）
    super::clear_scan_cache();
    let versions = super::scan_python_versions();
    let _ = crate::events::emit(crate::events::CHANNEL_PYTHON_SCANNED, &versions);
    let _ = std::fs::remove_file(&dest); // 清理安装包缓存（保留磁盘空间）

    Ok(InstallResult {
        success: true,
        version: full.clone(),
        task_id: String::new(),
        message: format!("Python {full} 安装成功"),
        installed_path: Some(install_result.display().to_string()),
        reboot_required: false,
        warnings,
    })
}

/// tokio::task::spawn_blocking 的薄包装（便于测试注入）。
async fn spawn_blocking<T, F>(f: F) -> Result<T, tokio::task::JoinError>
where
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
{
    tokio::task::spawn_blocking(f).await
}

/// Windows 静默安装：官方 bootstrapper（Inno Setup 参数集）。返回（安装根目录, 警告）。
#[allow(clippy::too_many_arguments)]
fn install_windows(
    installer: &Path,
    full: &str,
    tag: &str,
    install_dir: Option<&str>,
    all_users: bool,
    prepend_path: bool,
) -> Result<(PathBuf, Vec<String>), PythonError> {
    let mut warnings: Vec<String> = Vec::new();
    let mut args: Vec<String> = vec![
        "/quiet".into(),
        "/norestart".into(),
        format!("InstallAllUsers={}", if all_users { 1 } else { 0 }),
        "Include_pip=1".into(),
        "Include_launcher=1".into(),
        // 每用户安装时启动器放入 %LocalAppData%，避免写入系统目录
        format!("InstallLauncherAllUsers={}", if all_users { 1 } else { 0 }),
    ];
    if prepend_path {
        args.push("PrependPath=1".into());
    }
    if let Some(dir) = install_dir {
        args.push(format!("TargetDir={dir}"));
    }
    crate::app_info!(
        target: "pyforge_ai::installer",
        "安装[Windows] 启动安装器: {} 参数: {:?}",
        installer.display(),
        args
    );

    let code = run_elevatable(installer, &args)
        .map_err(|e| PythonError::Platform(format!("启动安装器失败: {e}")))?;
    crate::app_info!(
        target: "pyforge_ai::installer",
        "安装[Windows] 安装器退出码: {:?}",
        code
    );
    // 3010 = 成功但需要重启
    let reboot_required = code == Some(3010);
    if reboot_required {
        warnings.push("安装器返回 3010：需要重启系统后 Python 完全生效".to_string());
    } else if code != Some(0) {
        return Err(PythonError::Platform(format!(
            "安装器退出码 {code:?}，安装未成功。常见原因：自定义目录无写入权限、旧版本安装未完成、UAC 被拒绝"
        )));
    }

    // 解析最终安装目录（未指定时按官方默认规则推定）
    let dir = match install_dir {
        Some(d) => PathBuf::from(d),
        None => default_python_dir(all_users, tag),
    };
    if !dir.join("python.exe").is_file() {
        // 缺陷⑥：显式检测安装器忽略 TargetDir 的情况——落到了官方默认目录
        if install_dir.is_some() {
            let fallback = default_python_dir(all_users, tag);
            if fallback.join("python.exe").is_file() {
                return Err(PythonError::NotFound(format!(
                    "安装器忽略了自定义目录 TargetDir：Python 实际落在了 {}，而请求目录 {} 未生效。请确认目录权限或重新安装",
                    fallback.display(),
                    dir.display()
                )));
            }
        }
        return Err(PythonError::NotFound(format!(
            "安装器已退出，但未在 {} 找到 python.exe（若使用了非默认目录请确认 TargetDir）",
            dir.display()
        )));
    }
    let _ = full;
    crate::app_info!(
        target: "pyforge_ai::installer",
        "安装[Windows] 完成: TargetDir={:?} → 实际目录 {}",
        install_dir,
        dir.display()
    );
    Ok((dir, warnings))
}

/// 按官方规则推定默认安装目录。
fn default_python_dir(all_users: bool, tag: &str) -> PathBuf {
    let py_dir = format!("Python{}", tag.replace('.', ""));
    if all_users {
        if cfg!(target_os = "windows") {
            let base = std::env::var("ProgramW6432")
                .or_else(|_| std::env::var("ProgramFiles"))
                .unwrap_or_else(|_| r"C:\Program Files".to_string());
            PathBuf::from(base).join(&py_dir)
        } else {
            PathBuf::from("/Library/Frameworks/Python.framework/Versions").join(tag)
        }
    } else if cfg!(target_os = "windows") {
        let base = std::env::var("LOCALAPPDATA").unwrap_or_default();
        PathBuf::from(base).join("Programs").join("Python").join(&py_dir)
    } else {
        PathBuf::from("/Library/Frameworks/Python.framework/Versions").join(tag)
    }
}

/// macOS 安装：osascript 提权执行 installer -pkg（系统框架目录，忽略自定义目录）。
fn install_macos(pkg: &Path, tag: &str) -> Result<(PathBuf, Vec<String>), PythonError> {
    let warnings = vec![
        "macOS 官方 pkg 安装到系统框架目录（/Library/Frameworks/Python.framework），自定义安装目录不适用".to_string(),
    ];
    let script = format!(
        "do shell script \"installer -pkg {} -target /\" with administrator privileges",
        sq_quote(&pkg.display().to_string())
    );
    let mut cmd = std::process::Command::new("osascript");
    cmd.arg("-e").arg(&script);
    let output = cmd
        .output()
        .map_err(|e| PythonError::Platform(format!("启动 osascript 失败: {e}")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(PythonError::Platform(format!(
            "macOS 安装失败（可能拒绝了管理员授权）: {}",
            stderr.trim()
        )));
    }
    let dir = PathBuf::from("/Library/Frameworks/Python.framework/Versions").join(tag);
    if !dir.join("bin/python3").exists() {
        return Err(PythonError::NotFound(format!(
            "安装完成但未找到 {}",
            dir.join("bin/python3").display()
        )));
    }
    Ok((dir, warnings))
}

/// 运行一个可能需要提权的可执行文件：先直启，遇 740（需要提权）回退 PowerShell RunAs。
fn run_elevatable(exe: &Path, args: &[String]) -> Result<Option<i32>, String> {
    let mut cmd = std::process::Command::new(exe);
    cmd.args(args);
    match spawn_command(&mut cmd) {
        Ok(status) => return Ok(status.code()),
        Err(e) => {
            let is_elevation = e.raw_os_error() == Some(740);
            if !is_elevation {
                return Err(e.to_string());
            }
        }
    }
    // 提权回退：PowerShell Start-Process -Verb RunAs（触发 UAC），退出码经 exit 透传
    let args_ps: Vec<String> = args.iter().map(|a| sq_quote(a)).collect();
    let script = format!(
        "$p = Start-Process -FilePath {} -ArgumentList {} -Verb RunAs -Wait -PassThru; exit $p.ExitCode",
        sq_quote(&exe.display().to_string()),
        args_ps.join(",")
    );
    let mut ps = std::process::Command::new("powershell");
    ps.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", &script]);
    let status = spawn_command(&mut ps).map_err(|e| format!("提权执行失败: {e}"))?;
    Ok(status.code())
}

// ============================================================================
// 卸载
// ============================================================================

/// 官方卸载器注册项（Inno Setup 传统安装器或 Burn bundle）。
#[derive(Debug, Clone)]
pub struct OfficialUninstaller {
    pub key_path: String,
    pub display_name: Option<String>,
    pub uninstall_string: Option<String>,
    pub quiet_string: Option<String>,
    /// Burn bundle（python.org 官方安装器）：键内含 BundleCachePath 值
    pub is_bundle: bool,
    pub bundle_cache_path: Option<String>,
}

/// 判断 DisplayName 是否指向指定 Python 版本（full=完整版本号）。
fn display_matches_version(display: &str, version: Option<&str>) -> bool {
    let lower = display.to_lowercase();
    if !lower.contains("python") {
        return false;
    }
    match version {
        None => true,
        Some(v) => {
            if lower.contains(&v.to_lowercase()) {
                return true;
            }
            // 降级：maj.min 标签（链式产品族显示名可能只含 maj.min）
            version
                .and_then(version_tag)
                .map(|t| lower.contains(&t.to_lowercase()))
                .unwrap_or(false)
        }
    }
}

/// 卸载报告。
#[derive(Debug, Clone, Serialize)]
pub struct UninstallReport {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    pub official_uninstaller_used: bool,
    pub removed_paths: Vec<String>,
    pub removed_registry_keys: Vec<String>,
    pub removed_env_entries: Vec<String>,
    /// MSI/Burn 安装器注册残留清理明细（UserData Products / UpgradeCodes /
    /// Components 引用 / Package Cache 等）
    pub msi_residue_removed: Vec<String>,
    /// 清理后仍未安装干净的 MSI 产品（非空表示有残留，success=false）
    pub msi_products_remaining: Vec<String>,
    pub warnings: Vec<String>,
    pub dependent_venvs: Vec<String>,
    pub duration_ms: u64,
}

/// 卸载选项。
#[derive(Debug, Clone)]
pub struct UninstallOptions {
    /// python.exe 完整路径
    pub path: String,
    /// 清理环境变量（PATH / PYTHONHOME / PYTHONPATH）
    pub remove_env: bool,
    /// 清理注册表（PythonCore + 卸载表项）
    pub remove_registry: bool,
    /// 强制卸载（存在依赖 venv / 为默认版本时需要）
    pub force: bool,
}

/// 执行彻底卸载（命令入口，异步；重活放入阻塞线程池）。
pub async fn uninstall_python(opts: UninstallOptions) -> Result<UninstallReport, PythonError> {
    let task_id = crate::uuid_v4();
    let task_type = "python_uninstall";
    crate::events::register_task(&task_id, task_type)
        .map_err(|e| PythonError::Io(e.message.clone()))?;
    let _ = crate::events::update_task(TaskProgressEvent::started(
        &task_id,
        task_type,
        "正在校验卸载目标...",
    ));

    let started = std::time::Instant::now();
    // 闭包需 'static：克隆 task_id 进入阻塞线程，外层保留原值用于任务状态更新
    let task_inner = task_id.clone();
    let outcome = spawn_blocking(move || uninstall_blocking(opts, &task_inner, task_type))
        .await
        .map_err(|e| PythonError::Io(format!("卸载线程失败: {e}")))?;

    match &outcome {
        Ok(report) => {
            let _ = crate::events::update_task(TaskProgressEvent::completed(
                &task_id,
                task_type,
                if report.success { "Python 卸载完成" } else { "卸载完成但存在警告" },
            ));
            let _ = crate::events::emit_notification(
                if report.success { "Python 卸载完成" } else { "卸载完成（含警告）" },
                &format!(
                    "清理 {} 项文件路径、{} 项注册表、{} 项环境变量",
                    report.removed_paths.len(),
                    report.removed_registry_keys.len(),
                    report.removed_env_entries.len()
                ),
                "success",
            );
            // 清缓存 + 重扫 + 广播，两端列表同步移除
            super::clear_scan_cache();
            let versions = super::scan_python_versions();
            let _ = crate::events::emit(crate::events::CHANNEL_PYTHON_SCANNED, &versions);
        }
        Err(e) => {
            let _ = crate::events::update_task(TaskProgressEvent::failed(&task_id, task_type, &e.to_string()));
        }
    }

    outcome.map(|mut r| {
        r.duration_ms = started.elapsed().as_millis() as u64;
        r
    })
}

fn uninstall_blocking(
    opts: UninstallOptions,
    task_id: &str,
    task_type: &str,
) -> Result<UninstallReport, PythonError> {
    let mut report = UninstallReport {
        success: true,
        version: None,
        official_uninstaller_used: false,
        removed_paths: Vec::new(),
        removed_registry_keys: Vec::new(),
        removed_env_entries: Vec::new(),
        msi_residue_removed: Vec::new(),
        msi_products_remaining: Vec::new(),
        warnings: Vec::new(),
        dependent_venvs: Vec::new(),
        duration_ms: 0,
    };

    // ---- 1. 前置守卫 ----
    let raw_exe = PathBuf::from(opts.path.trim());
    if opts.path.trim().is_empty() {
        return Err(PythonError::NotFound("卸载目标路径为空".to_string()));
    }
    let exe = std::fs::canonicalize(&raw_exe)
        .map(|p| super::normalize_display_path(p))
        .unwrap_or_else(|_| raw_exe.clone());
    if !exe.is_file() {
        return Err(PythonError::NotFound(format!(
            "Python 可执行文件不存在: {}",
            exe.display()
        )));
    }
    let dir = exe
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| PythonError::NotFound("无法定位安装目录".to_string()))?;

    if let Some(reason) = danger_reason(&dir) {
        return Err(PythonError::Platform(format!("拒绝卸载：{reason}")));
    }

    // 有效性：--version 可解析
    let version_output = query_python_version(&dir)
        .map_err(|e| PythonError::NotFound(format!("目标不是有效的 Python 安装: {e}")))?;
    let version = PythonVersion::parse(&version_output).map(|v| v.to_semver_string());
    report.version = version.clone();

    // 依赖 venv 扫描
    let venvs = find_dependent_venvs(&dir);
    if !venvs.is_empty() && !opts.force {
        return Err(PythonError::Platform(format!(
            "检测到 {} 个虚拟环境依赖此 Python（{}…）。请先删除这些环境，或使用「强制卸载」（这些环境将失效）",
            venvs.len(),
            venvs.first().map(String::as_str).unwrap_or("")
        )));
    }
    report.dependent_venvs = venvs;
    if !report.dependent_venvs.is_empty() {
        report.warnings.push(format!(
            "强制卸载后 {} 个虚拟环境将失效: {}",
            report.dependent_venvs.len(),
            report.dependent_venvs.join("、")
        ));
    }

    let _ = crate::events::update_task(TaskProgressEvent::progress(
        task_id,
        task_type,
        10,
        format!("目标确认: Python {} @ {}", version.as_deref().unwrap_or("?"), dir.display()),
    ));

    // ---- 2. 官方卸载器优先（Windows：Inno / Burn bundle 双支持）----
    if cfg!(target_os = "windows") {
        let found = winreg_cleanup::find_official_uninstallers(&dir, version.as_deref());
        crate::app_info!(
            target: "pyforge_ai::installer",
            "卸载[官方卸载器] 版本={:?} 命中 {} 个注册项",
            version,
            found.len()
        );
        if !found.is_empty() {
            let first = &found[0];
            let _ = crate::events::update_task(TaskProgressEvent::progress(
                task_id,
                task_type,
                20,
                "正在运行官方卸载程序...",
            ));
            let exe_path = parse_uninstall_exe(
                first.quiet_string.as_deref().or(first.uninstall_string.as_deref()),
            );
            match exe_path {
                Some(unins) => {
                    match run_official_uninstaller(&unins, first.is_bundle, first.quiet_string.is_some()) {
                        Ok(()) => {
                            report.official_uninstaller_used = true;
                            report.removed_registry_keys.push(first.key_path.clone());
                            crate::app_info!(
                                target: "pyforge_ai::installer",
                                "卸载[官方卸载器] 执行成功: {} (bundle={})",
                                unins.display(),
                                first.is_bundle
                            );
                        }
                        Err(e) => report
                            .warnings
                            .push(format!("官方卸载器执行失败，转入手动清理: {e}")),
                    }
                }
                None => report
                    .warnings
                    .push(format!("无法解析卸载命令: {}", first.key_path)),
            }
        } else {
            report
                .warnings
                .push("未找到官方卸载器注册项（可能为解压/便携安装），直接执行手动清理".to_string());
        }
    }

    // ---- 2.5 MSI / Burn 安装器注册残留清扫（UserData Products / UpgradeCodes /
    // Components 值引用 / Package Cache），随后用 MsiQueryProductState 校验 ----
    if opts.remove_registry && cfg!(target_os = "windows") {
        if let Some(ver) = version.as_deref() {
            let _ = crate::events::update_task(TaskProgressEvent::progress(
                task_id,
                task_type,
                35,
                "正在清扫安装器注册残留...",
            ));
            let residue = super::msi_residue::sweep_msi_residue(ver);
            crate::app_info!(
                target: "pyforge_ai::installer",
                "卸载[MSI残留清扫] 清理 {} 项, 残留 {} 个产品, 警告 {} 条",
                residue.removed.len(),
                residue.remaining.len(),
                residue.warnings.len()
            );
            report.msi_residue_removed.extend(residue.removed);
            report.warnings.extend(residue.warnings);
            if !residue.remaining.is_empty() {
                report.msi_products_remaining = residue.remaining.clone();
                report.success = false;
                report.warnings.push(format!(
                    "仍有 {} 个 MSI 产品注册未清除（可能需要管理员权限）：{}",
                    residue.remaining.len(),
                    residue.remaining.join("；")
                ));
            }
        } else {
            report
                .warnings
                .push("版本号无法解析，跳过 MSI 安装器注册残留清扫".to_string());
        }
    }

    // ---- 3. 残留文件清理 ----
    let _ = crate::events::update_task(TaskProgressEvent::progress(
        task_id,
        task_type,
        45,
        "正在清理安装目录与残留文件...",
    ));
    // 官方卸载器可能已删除目录；幂等处理
    if dir.exists() {
        match remove_path_with_retry(&dir, 5, 600) {
            Ok(()) => report.removed_paths.push(dir.display().to_string()),
            Err(e) => {
                report.success = false;
                report.warnings.push(format!(
                    "安装目录删除失败（可能被占用）: {} — {e}",
                    dir.display()
                ));
            }
        }
    } else if report.official_uninstaller_used {
        report.removed_paths.push(format!("{}（官方卸载器）", dir.display()));
    }

    // pip 用户级站点目录（%APPDATA%\Python\Python{MM}），版本级隔离可安全删除
    if let Some(tag) = version.as_ref().map(|v| version_tag(v)).flatten() {
        if let Some(appdata) = dirs::data_dir() {
            let user_site = appdata.join("Python").join(format!("Python{}", tag.replace('.', "")));
            if user_site.exists() {
                match remove_path_with_retry(&user_site, 3, 500) {
                    Ok(()) => report.removed_paths.push(user_site.display().to_string()),
                    Err(e) => report.warnings.push(format!(
                        "pip 用户目录清理失败: {} — {e}",
                        user_site.display()
                    )),
                }
            }
        }
    }

    // ---- 4. 注册表清理（Windows）----
    if opts.remove_registry {
        let _ = crate::events::update_task(TaskProgressEvent::progress(
            task_id,
            task_type,
            65,
            "正在清理注册表项...",
        ));
        if let Some(tag) = version.as_ref().and_then(|v| version_tag(v)) {
            let (removed, warns) = winreg_cleanup::remove_python_core_keys(&tag);
            report.removed_registry_keys.extend(removed);
            report.warnings.extend(warns);
        } else {
            report
                .warnings
                .push("版本号无法解析，跳过 PythonCore 注册表清理".to_string());
        }
        if cfg!(target_os = "windows") {
            let (removed, warns) = winreg_cleanup::remove_uninstall_entries(&dir, version.as_deref());
            report.removed_registry_keys.extend(removed);
            report.warnings.extend(warns);
        }
    }

    // ---- 5. 环境变量清理（Windows；macOS/Linux 提示手动处理 shell 配置）----
    if opts.remove_env {
        let _ = crate::events::update_task(TaskProgressEvent::progress(
            task_id,
            task_type,
            82,
            "正在清理环境变量...",
        ));
        let (removed, warns) = winreg_cleanup::clean_python_env_vars(&dir);
        report.removed_env_entries.extend(removed);
        report.warnings.extend(warns);
        winreg_cleanup::broadcast_env_change();
    }
    #[cfg(not(target_os = "windows"))]
    if opts.remove_env {
        report.warnings.push(
            "macOS/Linux: 请手动检查 ~/.zshrc、~/.bash_profile 等 shell 配置中的 Python 相关 PATH 行".to_string(),
        );
    }

    // ---- 6. 结果校验 ----
    if dir.exists() {
        report.warnings.push(format!("目录仍存在: {}", dir.display()));
    }
    let _ = crate::events::update_task(TaskProgressEvent::progress(
        task_id,
        task_type,
        98,
        "卸载完成",
    ));
    Ok(report)
}

/// 从 UninstallString / QuietUninstallString 中解析出卸载器可执行文件路径。
fn parse_uninstall_exe(uninstall_string: Option<&str>) -> Option<PathBuf> {
    let s = uninstall_string?.trim();
    if s.is_empty() {
        return None;
    }
    if let Some(rest) = s.strip_prefix('"') {
        let end = rest.find('"')?;
        return Some(PathBuf::from(&rest[..end]));
    }
    // 未加引号：截到第一个参数边界（Inno 用 / 开关，传统工具用 - 开关）
    let end = s.find(" -").or_else(|| s.find(" /")).unwrap_or(s.len());
    let path = s[..end].trim();
    if path.is_empty() {
        None
    } else {
        Some(PathBuf::from(path))
    }
}

/// 运行官方卸载器：Burn bundle 用 `/uninstall /quiet /norestart`，
/// Inno 用 `/verysilent /suppressmsgboxes /norestart`；quiet 已注册时按注册命令原样执行。
fn run_official_uninstaller(unins: &Path, is_bundle: bool, quiet_registered: bool) -> Result<(), String> {
    let mut args: Vec<String> = Vec::new();
    if !quiet_registered {
        if is_bundle {
            args = vec!["/uninstall".into(), "/quiet".into(), "/norestart".into()];
        } else {
            args = vec![
                "/verysilent".into(),
                "/suppressmsgboxes".into(),
                "/norestart".into(),
            ];
        }
    }
    crate::app_info!(
        target: "pyforge_ai::installer",
        "运行官方卸载器: {} (bundle={}) 参数: {:?}",
        unins.display(),
        is_bundle,
        args
    );
    match run_elevatable(unins, &args) {
        Ok(code) if code == Some(0) || code == Some(3010) => Ok(()),
        Ok(Some(1602)) => Err("用户取消了官方卸载器（UAC/确认框被拒绝）".to_string()),
        Ok(code) => Err(format!("卸载器退出码 {code:?}")),
        Err(e) => Err(e),
    }
}

// ============================================================================
// Windows 注册表 / 环境变量清理实现
// ============================================================================

#[cfg(target_os = "windows")]
pub(crate) mod winreg_cleanup {
    use std::path::Path;
    use winreg::enums::{self, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::types::{FromRegValue, ToRegValue};
    use winreg::RegKey;
    use super::same_location;

    const PYTHON_CORE: &str = r"SOFTWARE\Python\PythonCore";
    const PYTHON_CORE_WOW: &str = r"SOFTWARE\WOW6432Node\Python\PythonCore";
    const UNINSTALL_HKCU: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall";
    const UNINSTALL_HKLM: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall";
    const UNINSTALL_HKLM_WOW: &str = r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall";
    const HKCU_ENV: &str = "Environment";
    const HKLM_ENV: &str = r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment";

    type Removed = Vec<String>;
    type Warnings = Vec<String>;

    use super::{display_matches_version, OfficialUninstaller};

    /// 递归删除注册表键（winreg 只提供叶子删除，需自底向上）。
    pub(crate) fn delete_key_tree(root: &RegKey, path: &str) -> std::io::Result<()> {
        let key = root.open_subkey_with_flags(path, enums::KEY_READ | enums::KEY_WRITE)?;
        for child in key.enum_keys().filter_map(|r| r.ok()).collect::<Vec<_>>() {
            let _ = delete_key_tree(root, &format!("{path}\\{child}"));
        }
        drop(key);
        root.delete_subkey(path)
    }

    /// 删除三个位置的 PythonCore\{tag}（HKCU 必成；HKLM 无管理员权限时记警告）。
    pub fn remove_python_core_keys(tag: &str) -> (Removed, Warnings) {
        let mut removed = Vec::new();
        let mut warnings = Vec::new();
        let targets = [
            (HKEY_CURRENT_USER, PYTHON_CORE, "HKCU"),
            (HKEY_LOCAL_MACHINE, PYTHON_CORE, "HKLM"),
            (HKEY_LOCAL_MACHINE, PYTHON_CORE_WOW, "HKLM(WOW6432Node)"),
        ];
        for (hive, base, label) in targets {
            let path = format!("{base}\\{tag}");
            let root = RegKey::predef(hive);
            match root.open_subkey_with_flags(base, enums::KEY_READ) {
                // 先确认 tag 子键存在，避免误报
                Ok(core) if core.enum_keys().any(|k| k.map(|k| k == tag).unwrap_or(false)) => {
                    drop(core);
                    match delete_key_tree(&root, &path) {
                        Ok(()) => removed.push(format!("HK{}\\{}", label, path)),
                        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
                            warnings.push(format!(
                                "系统级注册表 {} 需要管理员权限，已跳过（不影响用户级卸载）",
                                path
                            ));
                        }
                        Err(e) => warnings.push(format!("删除注册表 {} 失败: {e}", path)),
                    }
                }
                _ => {}
            }
        }
        (removed, warnings)
    }

    /// 查找与目标目录/版本匹配的官方卸载器注册项（Inno 与 Burn bundle 双支持）。
    pub fn find_official_uninstallers(
        target_dir: &Path,
        version: Option<&str>,
    ) -> Vec<OfficialUninstaller> {
        let mut found = Vec::new();
        let sources = [
            (HKEY_CURRENT_USER, UNINSTALL_HKCU),
            (HKEY_LOCAL_MACHINE, UNINSTALL_HKLM),
            (HKEY_LOCAL_MACHINE, UNINSTALL_HKLM_WOW),
        ];
        for (hive, base) in sources {
            let root = RegKey::predef(hive);
            let Ok(uninstall) = root.open_subkey_with_flags(base, enums::KEY_READ) else {
                continue;
            };
            for name in uninstall.enum_keys().filter_map(|r| r.ok()).collect::<Vec<_>>() {
                let Ok(entry) = uninstall.open_subkey_with_flags(&name, enums::KEY_READ) else {
                    continue;
                };
                let location: Option<String> = entry.get_value("InstallLocation").ok();
                let display: Option<String> = entry.get_value("DisplayName").ok();
                let uninstall_str: Option<String> = entry.get_value("UninstallString").ok();
                let quiet: Option<String> = entry.get_value("QuietUninstallString").ok();
                let bundle_cache: Option<String> = entry.get_value("BundleCachePath").ok();

                // Burn bundle：含 BundleCachePath 且显示名指向目标 Python 版本
                let bundle_match = bundle_cache.is_some()
                    && display
                        .as_deref()
                        .map(|d| display_matches_version(d, version))
                        .unwrap_or(false);
                let location_match = location
                    .as_deref()
                    .map(|l| same_location(l, &target_dir.to_string_lossy()))
                    .unwrap_or(false);
                // Inno：DisplayName 含 "Python {maj}.{min}" 且确为 unins000 卸载器
                let name_match = !bundle_match
                    && display
                        .as_deref()
                        .map(|d| {
                            d.to_lowercase().contains("python")
                                && uninstall_str
                                    .as_deref()
                                    .map(|u| u.to_lowercase().contains("unins000.exe"))
                                    .unwrap_or(false)
                            && location
                                .as_deref()
                                .map(|l| same_location(l, &target_dir.to_string_lossy()))
                                .unwrap_or(true)
                        })
                        .unwrap_or(false);
                if bundle_match || location_match || name_match {
                    found.push(OfficialUninstaller {
                        key_path: format!("{}\\{}", base, name),
                        display_name: display,
                        uninstall_string: uninstall_str,
                        quiet_string: quiet,
                        is_bundle: bundle_match,
                        bundle_cache_path: bundle_cache,
                    });
                }
            }
        }
        found
    }

    /// 删除与目标目录/版本匹配的卸载表项（含 Burn bundle 键）。
    pub fn remove_uninstall_entries(
        target_dir: &Path,
        version: Option<&str>,
    ) -> (Removed, Warnings) {
        let mut removed = Vec::new();
        let mut warnings = Vec::new();
        let sources = [
            (HKEY_CURRENT_USER, UNINSTALL_HKCU, "HKCU"),
            (HKEY_LOCAL_MACHINE, UNINSTALL_HKLM, "HKLM"),
            (HKEY_LOCAL_MACHINE, UNINSTALL_HKLM_WOW, "HKLM(WOW6432Node)"),
        ];
        for entry_info in find_official_uninstallers(target_dir, version) {
            let key_path = entry_info.key_path;
            // key_path 形如 "{base}\\{name}"，base 决定 hive（HKCU/HKLM base 前缀相同，
            // 因此按 find 阶段同源的 sources 顺序逐一尝试存在的那个）
            let mut handled = false;
            for (hive, base, label) in sources {
                if !key_path.starts_with(base) {
                    continue;
                }
                match attempt_delete(hive, &key_path) {
                    Ok(true) => {
                        removed.push(format!("{label}\\{key_path}"));
                        handled = true;
                    }
                    Ok(false) => {}
                    Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => warnings.push(
                        format!("卸载表项 {key_path} 需要管理员权限，已跳过"),
                    ),
                    Err(e) => warnings.push(format!("删除卸载表项 {key_path} 失败: {e}")),
                }
                if handled {
                    break;
                }
            }
        }
        (removed, warnings)
    }

    fn attempt_delete(hive: winreg::HKEY, path: &str) -> std::io::Result<bool> {
        let root = RegKey::predef(hive);
        if !path.contains('\\') {
            return Ok(false);
        }
        let parent = match path.rsplit_once('\\') {
            Some((p, _)) => p.to_string(),
            None => return Ok(false),
        };
        let leaf = path.rsplit_once('\\').map(|(_, l)| l).unwrap_or(path);
        match root.open_subkey_with_flags(&parent, enums::KEY_READ) {
            Ok(parent_key) => {
                let exists = parent_key.enum_keys().any(|k| k.map(|k| k == leaf).unwrap_or(false));
                drop(parent_key);
                if !exists {
                    return Ok(false);
                }
                delete_key_tree(&root, path)?;
                Ok(true)
            }
            Err(_) => Ok(false),
        }
    }

    /// 清理 HKCU/HKLM 的 Path、PYTHONHOME、PYTHONPATH 中指向目标目录的条目。
    /// 返回 (移除的条目描述, 警告)。
    pub fn clean_python_env_vars(target_dir: &Path) -> (Removed, Warnings) {
        let mut removed = Vec::new();
        let mut warnings = Vec::new();

        let dir = target_dir.to_string_lossy().to_string();
        let scripts = format!("{}\\Scripts", dir.trim_end_matches('\\'));

        // —— Path（HKCU 必清；HKLM 尽力而为）——
        for (hive, env_path, label) in [
            (HKEY_CURRENT_USER, HKCU_ENV, "HKCU"),
            (HKEY_LOCAL_MACHINE, HKLM_ENV, "HKLM"),
        ] {
            let root = RegKey::predef(hive);
            let Ok(env) = root.open_subkey_with_flags(env_path, enums::KEY_READ | enums::KEY_WRITE) else {
                if label == "HKLM" {
                    warnings.push("系统级环境变量需管理员权限，已跳过 HKLM PATH 清理".to_string());
                }
                continue;
            };
            let Ok(raw) = env.get_raw_value("Path") else {
                continue;
            };
            // winreg 0.52 的 RegValue 是 {bytes, vtype} 结构体；仅处理字符串两类，
            // 保留原 REG_EXPAND_SZ 类型以免 %VAR% 引用被展开固化为字面值
            let is_expand = raw.vtype == enums::REG_EXPAND_SZ;
            if raw.vtype != enums::REG_SZ && raw.vtype != enums::REG_EXPAND_SZ {
                continue;
            }
            let value = match String::from_reg_value(&raw) {
                Ok(v) => v,
                Err(_) => continue,
            };
            let mut removed_count = 0usize;
            let kept: Vec<&str> = value
                .split(';')
                .filter(|seg| {
                    let t = seg.trim();
                    if t.is_empty() {
                        return false;
                    }
                    // 含 % 的未展开段无法比对，保持原样
                    if t.contains('%') {
                        return true;
                    }
                    if same_location(t, &dir) || same_location(t, &scripts) {
                        removed_count += 1;
                        removed.push(format!("{}\\Path ← {}", label, t));
                        return false;
                    }
                    true
                })
                .collect();
            if removed_count > 0 {
                let new_value = kept.join(";");
                // to_reg_value 产出 NUL 结尾的 UTF-16LE REG_SZ；按原类型回写
                let mut new_raw = new_value.to_reg_value();
                if is_expand {
                    new_raw.vtype = enums::REG_EXPAND_SZ;
                }
                if let Err(e) = env.set_raw_value("Path", &new_raw) {
                    warnings.push(format!("写入 {} Path 失败: {e}", label));
                }
            }
        }

        // —— PYTHONHOME / PYTHONPATH ——
        for var in ["PYTHONHOME", "PYTHONPATH"] {
            let _ = clean_single_var(var, target_dir, &mut removed, &mut warnings);
        }

        (removed, warnings)
    }

    fn clean_single_var(
        var: &str,
        target_dir: &Path,
        removed: &mut Removed,
        warnings: &mut Warnings,
    ) {
        for (hive, env_path, label) in [
            (HKEY_CURRENT_USER, HKCU_ENV, "HKCU"),
            (HKEY_LOCAL_MACHINE, HKLM_ENV, "HKLM"),
        ] {
            let root = RegKey::predef(hive);
            let Ok(env) = root.open_subkey_with_flags(env_path, enums::KEY_READ | enums::KEY_WRITE) else {
                continue;
            };
            let Ok(value) = env.get_value::<String, _>(var) else {
                continue;
            };
            if var == "PYTHONHOME" {
                if same_location(&value, &target_dir.to_string_lossy()) {
                    match env.delete_value(var) {
                        Ok(()) => removed.push(format!("{label}\\{var} = {value}")),
                        Err(e) => warnings.push(format!("删除 {label}\\{var} 失败: {e}")),
                    }
                }
            } else {
                // PYTHONPATH 是分号列表：过滤指向目标目录的段
                let target = target_dir.to_string_lossy().to_string();
                let kept: Vec<&str> = value
                    .split(';')
                    .filter(|seg| {
                        let t = seg.trim();
                        !t.is_empty() && !same_location(t, &target)
                    })
                    .collect();
                if kept.len() != value.split(';').filter(|s| !s.trim().is_empty()).count() {
                    if kept.is_empty() {
                        let _ = env.delete_value(var);
                        removed.push(format!("{label}\\{var} = {value}"));
                    } else if let Err(e) = env.set_value(var, &kept.join(";")) {
                        warnings.push(format!("重写 {label}\\{var} 失败: {e}"));
                    } else {
                        removed.push(format!("{label}\\{var}（已剔除目标条目）"));
                    }
                }
            }
        }
    }

    /// 广播 WM_SETTINGCHANGE，使 Explorer 与新进程立即感知环境变量变化。
    pub fn broadcast_env_change() {
        use windows_sys::Win32::Foundation::{HWND, LPARAM, WPARAM};
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            SendMessageTimeoutW, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE,
        };

        const HWND_BROADCAST: HWND = 0xFFFF as HWND;
        let mut result: usize = 0;
        let param = b"Environment\0";
        unsafe {
            SendMessageTimeoutW(
                HWND_BROADCAST,
                WM_SETTINGCHANGE,
                0 as WPARAM,
                param.as_ptr() as LPARAM,
                SMTO_ABORTIFHUNG,
                1000,
                &mut result,
            );
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub(crate) mod winreg_cleanup {
    use std::path::Path;

    /// 非 Windows 平台：注册表清理不适用。
    pub fn remove_python_core_keys(_tag: &str) -> (Vec<String>, Vec<String>) {
        (Vec::new(), Vec::new())
    }

    pub fn find_official_uninstallers(
        _target_dir: &Path,
        _version: Option<&str>,
    ) -> Vec<super::OfficialUninstaller> {
        Vec::new()
    }

    pub fn remove_uninstall_entries(
        _target_dir: &Path,
        _version: Option<&str>,
    ) -> (Vec<String>, Vec<String>) {
        (Vec::new(), Vec::new())
    }

    pub fn clean_python_env_vars(_target_dir: &Path) -> (Vec<String>, Vec<String>) {
        (Vec::new(), Vec::new())
    }

    pub fn broadcast_env_change() {}
}

// ============================================================================
// 测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_full_version_pads_missing_patch() {
        assert_eq!(normalize_full_version("3.12"), Some("3.12.0".to_string()));
        assert_eq!(normalize_full_version("3.12.4"), Some("3.12.4".to_string()));
        assert_eq!(normalize_full_version("3.13.1"), Some("3.13.1".to_string()));
        assert_eq!(normalize_full_version("2.7.18"), None);
        assert_eq!(normalize_full_version("abc"), None);
        assert_eq!(normalize_full_version("3.12.4.1"), None);
    }

    #[test]
    fn version_tag_extracts_major_minor() {
        assert_eq!(version_tag("3.12.4"), Some("3.12".to_string()));
        assert_eq!(version_tag("Python 3.9.7"), Some("3.9".to_string()));
        assert_eq!(version_tag("nope"), None);
    }

    #[test]
    fn windows_installer_urls_match_official_ftp_layout() {
        assert_eq!(
            build_windows_installer_url("3.12.4", InstArch::X64).unwrap(),
            "https://www.python.org/ftp/python/3.12.4/python-3.12.4-amd64.exe"
        );
        assert_eq!(
            build_windows_installer_url("3.12", InstArch::X86).unwrap(),
            "https://www.python.org/ftp/python/3.12.0/python-3.12.0.exe"
        );
        assert_eq!(
            build_windows_installer_url("3.11.9", InstArch::Arm64).unwrap(),
            "https://www.python.org/ftp/python/3.11.9/python-3.11.9-arm64.exe"
        );
    }

    #[test]
    fn macos_pkg_url_switches_suffix_at_3_10() {
        assert_eq!(
            build_macos_pkg_url("3.12.4").unwrap(),
            "https://www.python.org/ftp/python/3.12.4/python-3.12.4-macos11.pkg"
        );
        assert_eq!(
            build_macos_pkg_url("3.9.7").unwrap(),
            "https://www.python.org/ftp/python/3.9.7/python-3.9.7-macosx10.9.pkg"
        );
    }

    #[test]
    fn linux_source_url() {
        assert_eq!(
            build_linux_source_url("3.12.4").unwrap(),
            "https://www.python.org/ftp/python/3.12.4/Python-3.12.4.tgz"
        );
    }

    #[test]
    fn parse_uninstall_exe_handles_quoted_and_bare() {
        assert_eq!(
            parse_uninstall_exe(Some(r#""C:\Py312\unins000.exe""#)),
            Some(PathBuf::from(r"C:\Py312\unins000.exe"))
        );
        assert_eq!(
            parse_uninstall_exe(Some(r"C:\Py312\unins000.exe")),
            Some(PathBuf::from(r"C:\Py312\unins000.exe"))
        );
        assert_eq!(
            parse_uninstall_exe(Some(r"C:\Py312\unins000.exe /verysilent")),
            Some(PathBuf::from(r"C:\Py312\unins000.exe"))
        );
        assert_eq!(parse_uninstall_exe(Some("")), None);
        assert_eq!(parse_uninstall_exe(None), None);
    }

    #[test]
    fn same_location_ignores_case_and_trailing_separators() {
        assert!(same_location(r"D:\Python312\", r"d:\python312"));
        assert!(same_location("/usr/local/py", "/usr/local/py/"));
        assert!(!same_location(r"D:\Python312", r"D:\Python311"));
    }

    #[test]
    fn validate_rejects_empty_and_relative() {
        let v = validate_install_dir(Path::new(""));
        assert!(!v.valid);
        let v = validate_install_dir(Path::new("relative/dir"));
        assert!(!v.valid);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn validate_rejects_illegal_chars_and_reserved_names() {
        let v = validate_install_dir(Path::new(r"D:\py<th>312"));
        assert!(!v.valid);
        let v = validate_install_dir(Path::new(r"D:\trailing."));
        assert!(!v.valid);
        let v = validate_install_dir(Path::new(r"D:\CON"));
        assert!(!v.valid);
        let v = validate_install_dir(Path::new(r"D:\ok dir|bad"));
        assert!(!v.valid);
    }

    #[test]
    fn validate_rejects_dangerous_targets() {
        // 磁盘根目录
        let root = if cfg!(target_os = "windows") { r"C:\" } else { "/" };
        let v = validate_install_dir(Path::new(root));
        assert!(!v.valid, "根目录必须被拒绝");
    }

    #[test]
    fn validate_accepts_writable_temp_dir() {
        let base = std::env::temp_dir().join("pyforge_installer_test");
        let target = base.join("自定义 安装#目录(特殊&字符)");
        let _ = std::fs::create_dir_all(&target);
        let v = validate_install_dir(&target);
        assert!(v.valid, "可写的自定义目录应通过校验: {:?}", v.reason);
        assert!(v.writable);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn remove_path_with_retry_deletes_and_is_idempotent() {
        let base = std::env::temp_dir().join("pyforge_retry_test");
        let nested = base.join("a/b/c");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("f.txt"), b"x").unwrap();
        remove_path_with_retry(&base, 3, 50).unwrap();
        assert!(!base.exists());
        // 幂等：再次删除不报错
        remove_path_with_retry(&base, 3, 50).unwrap();
    }

    #[test]
    fn find_dependent_venvs_detects_matching_home() {
        let base = std::env::temp_dir().join("pyforge_venv_scan_test");
        let target = base.join("Python312");
        let venv = base.join("venvs").join("myenv");
        std::fs::create_dir_all(&venv).unwrap();
        std::fs::write(
            venv.join("pyvenv.cfg"),
            format!("home = {}\ninclude-system-site-packages = false\n", target.display()),
        )
        .unwrap();
        std::fs::create_dir_all(&target).unwrap();

        // 直接注入 fixture 根目录（配置未初始化时 find_dependent_venvs 无根可扫）
        let found = find_dependent_venvs_in_roots(&target, &[base.clone()]);
        assert!(found.iter().any(|p| p.ends_with("myenv")), "应找到依赖 venv: {found:?}");
        // 无关目录不误报
        let other = base.join("Python399");
        std::fs::create_dir_all(&other).unwrap();
        assert!(find_dependent_venvs_in_roots(&other, &[base.clone()]).is_empty());

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn danger_reason_blocks_windows_apps_and_system() {
        // WindowsApps 关键字无论平台均应拒绝
        let p = Path::new(r"C:\Users\a\AppData\Local\Microsoft\WindowsApps\python.exe");
        assert!(danger_reason(p.parent().unwrap()).is_some());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn danger_reason_blocks_windows_dir_and_drive_root() {
        assert!(danger_reason(Path::new(r"C:\Windows")).is_some());
        assert!(danger_reason(Path::new(r"C:\Windows\System32")).is_some());
        assert!(danger_reason(Path::new(r"C:\")).is_some());
        assert!(danger_reason(Path::new(r"D:\Python312")).is_none());
    }
}
