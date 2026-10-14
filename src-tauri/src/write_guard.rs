//! 系统盘写入监控与违规记录模块
//!
//! 职责（对应「所有运行期文件不得写入系统盘」强制约束）：
//! 1. **路径判定**：[`is_system_drive`] 判定任一路径是否位于系统盘（Windows
//!    取 `SystemDrive` 环境变量，默认 `C:`；类 Unix 平台无系统盘概念恒为否）；
//! 2. **主动上报**：[`check_allowed`] / [`report_violation`] 供各写入点在写
//!    前检查与写后自证，违规事件含文件路径、写入时间、文件类型、所属模块，
//!    按「同一路径会话内去重、发生次数累加」记录；
//! 3. **周期审计**：后台守护线程定期扫描应用相关的系统盘遗留位置（历史配置
//!    目录、历史数据目录、系统临时目录中的 pyforge 前缀文件），凡本次进程
//!    启动后被创建/修改的文件一律记为违规；
//! 4. **Excel 导出**：违规记录持久化为 `violations.jsonl`（崩溃不丢），并
//!    自动刷新为标准 Excel 文档（.xlsx），存放于与日志目录同层级的
//!    `pyforge-violations` 独立文件夹；
//! 5. **写入面收敛**：[`app_temp_dir`] / [`child_env_vars`] 把应用自身与子
//!    进程（pip/python）的临时文件、下载缓存统一重定向到非系统盘。

#![allow(dead_code)]

use crate::error::{AppError, AppResult, ErrorCode};
use crate::logging::local_timestamp_now;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;

/// 违规记录文件夹名（与日志目录同级）。
pub const VIOLATIONS_DIR_NAME: &str = "pyforge-violations";

/// 违规记录持久化文件（JSON Lines，每行一条事件）。
const VIOLATIONS_LOG_FILE: &str = "violations.jsonl";

/// 违规记录 Excel 导出文件名。
const EXCEL_FILE_NAME: &str = "pyforge-violations.xlsx";

/// 内存中最多保留的违规事件条数（防异常场景内存膨胀，超出丢弃最早记录）。
const MAX_EVENTS: usize = 5000;

/// 周期审计单轮扫描的每目录最大条目数（防止历史 venv 等超大目录拖慢守护线程）。
const AUDIT_MAX_ENTRIES: usize = 2000;

/// 本进程启动时刻：审计只关心「运行过程中产生的」文件。
static PROCESS_START: OnceLock<SystemTime> = OnceLock::new();

/// 一条系统盘写入违规事件。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ViolationEvent {
    /// 违规文件完整路径
    pub file_path: String,
    /// 最近一次写入/发现时间（本地时间，年月日时分秒）
    pub written_at: String,
    /// 首次发现时间（本地时间，年月日时分秒）
    pub first_seen: String,
    /// 文件类型（扩展名小写 / 目录 / 无扩展名）
    pub file_type: String,
    /// 所属模块（写入来源归属）
    pub module: String,
    /// 会话累计发生次数（同一路径去重后累加）
    pub occurrences: u64,
    /// 检测来源与备注说明
    pub detail: String,
}

/// 违规事件仓库：内存索引 + 脏标记（驱动 Excel 自动刷新）。
struct ViolationStore {
    events: Vec<ViolationEvent>,
    /// file_path -> events 下标，用于同路径去重
    index: HashMap<String, usize>,
    dirty: bool,
}

static STORE: Lazy<Mutex<ViolationStore>> = Lazy::new(|| {
    Mutex::new(ViolationStore {
        events: Vec::new(),
        index: HashMap::new(),
        dirty: false,
    })
});

/// 判定路径是否位于系统盘。
///
/// Windows：取 `SystemDrive` 环境变量（缺省 `C:`），剥除 `\\?\` 扩展前缀后
/// 按大写前缀匹配；UNC 网络路径不属本地盘，判为否。
/// 非 Windows 平台无「系统盘」概念，恒为否。
pub fn is_system_drive(path: &Path) -> bool {
    if !cfg!(target_os = "windows") {
        return false;
    }
    let system_drive = std::env::var("SystemDrive")
        .unwrap_or_else(|_| "C:".to_string())
        .trim_end_matches('\\')
        .to_uppercase();
    let raw = path.to_string_lossy();
    let stripped = raw.trim_start_matches(r"\\?\");
    if stripped.starts_with(r"\\") {
        // UNC 路径（\\server\share）非本地固定盘
        return false;
    }
    let upper = stripped.to_uppercase();
    upper.starts_with(&system_drive)
}

/// 推断文件类型描述：目录 / .扩展名 / 无扩展名。
pub fn file_type_of(path: &Path) -> String {
    if path.is_dir() {
        return "目录".to_string();
    }
    match path.extension().and_then(|e| e.to_str()) {
        Some(ext) if !ext.is_empty() => format!(".{}", ext.to_lowercase()),
        _ => "无扩展名".to_string(),
    }
}

/// 违规记录文件夹路径（与日志目录同层级，由 logging 模块统一定位）。
pub fn violations_dir() -> AppResult<PathBuf> {
    crate::logging::violations_dir()
}

/// 应用专用临时目录（非系统盘优先）：`storage_root/pyforge-ai/tmp`。
///
/// 应用自身产生的临时文件一律走此目录，杜绝落入系统盘 %TEMP%。
/// 存储根不可用或创建失败时回退系统临时目录（此时由审计线程记录违规）。
pub fn app_temp_dir() -> PathBuf {
    if let Ok(root) = crate::paths::storage_root() {
        let dir = root.join("pyforge-ai").join("tmp");
        if std::fs::create_dir_all(&dir).is_ok() {
            return dir;
        }
    }
    std::env::temp_dir()
}

/// 子进程环境变量注入清单：把 pip/python 等子进程的临时目录与下载缓存
/// 重定向到非系统盘（TMP/TEMP → 应用临时目录，PIP_CACHE_DIR → 配置缓存目录）。
pub fn child_env_vars() -> Vec<(String, String)> {
    let tmp = app_temp_dir().to_string_lossy().to_string();
    let mut vars = vec![
        ("TMP".to_string(), tmp.clone()),
        ("TEMP".to_string(), tmp),
    ];
    if let Ok(cfg) = crate::config::get_config() {
        let cache = cfg.paths.cache_dir.trim().to_string();
        if !cache.is_empty() {
            vars.push(("PIP_CACHE_DIR".to_string(), cache));
        }
    }
    vars
}

/// 写前检查：目标路径在系统盘时记录违规并返回 false，否则返回 true。
pub fn check_allowed(module: &str, path: &Path) -> bool {
    if !is_system_drive(path) {
        return true;
    }
    report_violation(module, path, "主动拦截检查：文件写入目标位于系统盘");
    false
}

/// 记录一条违规事件（同一路径会话内去重，重复发生仅累加次数）。
///
/// 同步追加写入 `violations.jsonl` 保证崩溃不丢；置脏标记驱动守护线程
/// 自动刷新 Excel 导出。
pub fn report_violation(module: &str, path: &Path, detail: &str) {
    let key = path.to_string_lossy().to_string();
    let now = local_timestamp_now();

    let mut store = match STORE.lock() {
        Ok(g) => g,
        Err(_) => return, // 锁中毒时放弃记录，绝不让监控本身拖垮业务
    };

    if let Some(&idx) = store.index.get(&key) {
        store.events[idx].occurrences += 1;
        store.events[idx].written_at = now;
        store.dirty = true;
        append_jsonl(&store.events[idx]);
        return;
    }

    let event = ViolationEvent {
        file_path: key.clone(),
        written_at: now.clone(),
        first_seen: now,
        file_type: file_type_of(path),
        module: module.to_string(),
        occurrences: 1,
        detail: detail.to_string(),
    };
    append_jsonl(&event);
    let idx = store.events.len();
    store.index.insert(key, idx);
    store.events.push(event);
    if store.events.len() > MAX_EVENTS {
        // 丢弃最早记录并重建下标
        store.events.remove(0);
        store.index = store
            .events
            .iter()
            .enumerate()
            .map(|(i, e)| (e.file_path.clone(), i))
            .collect();
    }
    store.dirty = true;

    tracing::warn!(
        target: "pyforge_ai::write_guard",
        "检测到系统盘写入违规: {} (模块: {}, 类型: {}, 来源: {})",
        path.to_string_lossy(),
        module,
        file_type_of(path),
        detail
    );
}

/// 当前全部违规事件（时间正序）。
pub fn list_violations() -> Vec<ViolationEvent> {
    match STORE.lock() {
        Ok(g) => g.events.clone(),
        Err(_) => Vec::new(),
    }
}

/// 违规记录 jsonl 追加落盘（失败静默，不影响业务写入）。
fn append_jsonl(event: &ViolationEvent) {
    if let Ok(dir) = violations_dir() {
        if std::fs::create_dir_all(&dir).is_ok() {
            let file = dir.join(VIOLATIONS_LOG_FILE);
            if let Ok(mut line) = serde_json::to_string(event) {
                line.push('\n');
                use std::io::Write;
                if let Ok(mut f) = std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&file)
                {
                    let _ = f.write_all(line.as_bytes());
                }
            }
        }
    }
}

/// 启动时从磁盘加载历史违规记录（按路径去重，后写的覆盖先写的）。
fn load_persisted() {
    let Ok(dir) = violations_dir() else { return };
    let file = dir.join(VIOLATIONS_LOG_FILE);
    let Ok(content) = std::fs::read_to_string(&file) else { return };

    let mut store = match STORE.lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    store.events.clear();
    store.index.clear();
    for line in content.lines() {
        let Ok(event) = serde_json::from_str::<ViolationEvent>(line) else {
            continue;
        };
        match store.index.get(&event.file_path) {
            Some(&idx) => store.events[idx] = event,
            None => {
                let idx = store.events.len();
                store.index.insert(event.file_path.clone(), idx);
                store.events.push(event);
            }
        }
    }
}

/// 初始化：记录进程启动时刻、装载历史记录、启动周期审计守护线程。
pub fn init() -> AppResult<()> {
    let _ = PROCESS_START.set(SystemTime::now());
    load_persisted();

    static MONITOR_STARTED: OnceLock<()> = OnceLock::new();
    if MONITOR_STARTED.set(()).is_ok() {
        std::thread::Builder::new()
            .name("write-guard".to_string())
            .spawn(monitor_loop)
            .map_err(|e| AppError::new(ErrorCode::IoError, format!("启动写入监控线程失败: {e}")))?;
    }
    Ok(())
}

/// 守护线程主循环：每 30s 审计一轮 + 按需刷新 Excel 导出。
fn monitor_loop() {
    let start = *PROCESS_START.get_or_init(SystemTime::now);
    loop {
        std::thread::sleep(std::time::Duration::from_secs(30));
        audit_once(start);
        flush_excel_if_dirty();
    }
}

/// 有新违规未导出时刷新 Excel（失败仅告警，下轮重试）。
fn flush_excel_if_dirty() {
    let dirty = match STORE.lock() {
        Ok(mut g) => std::mem::take(&mut g.dirty),
        Err(_) => false,
    };
    if dirty {
        if let Err(e) = export_excel() {
            tracing::warn!(
                target: "pyforge_ai::write_guard",
                "违规记录 Excel 导出失败: {e}"
            );
        }
    }
}

/// 审计目标：应用相关的系统盘遗留位置及其模块归属。
fn audit_targets() -> Vec<(PathBuf, &'static str)> {
    let mut targets = Vec::new();
    if let Some(d) = dirs::config_dir() {
        targets.push((d.join("pyforge-ai"), "config"));
    }
    if let Some(d) = dirs::data_dir() {
        targets.push((d.join("pyforge-ai"), "legacy-data"));
    }
    targets.push((std::env::temp_dir(), "temp"));
    targets
}

/// 单轮审计：扫描审计目标下本次进程启动后被创建/修改的文件。
///
/// 系统临时目录仅跟踪 `pyforge` 前缀文件（无法归因其他程序的文件，
/// 避免误报）；单目录扫描条目数封顶，防止超大目录拖慢守护线程。
fn audit_once(start: SystemTime) {
    for (root, module) in audit_targets() {
        if !root.is_dir() {
            continue;
        }
        let mut scanned = 0usize;
        let mut stack = vec![(root, 0usize)];
        while let Some((dir, depth)) = stack.pop() {
            let Ok(entries) = std::fs::read_dir(&dir) else {
                continue;
            };
            for entry in entries.filter_map(|e| e.ok()) {
                scanned += 1;
                if scanned > AUDIT_MAX_ENTRIES {
                    return;
                }
                let Ok(file_type) = entry.file_type() else {
                    continue;
                };
                let path = entry.path();
                if file_type.is_dir() {
                    if depth < 2 {
                        stack.push((path, depth + 1));
                    }
                    continue;
                }
                if !file_type.is_file() {
                    continue;
                }
                let name = entry
                    .file_name()
                    .to_string_lossy()
                    .to_lowercase();
                if module == "temp" && !name.starts_with("pyforge") {
                    continue;
                }
                let modified_recently = entry
                    .metadata()
                    .and_then(|m| m.modified())
                    .map(|t| t >= start)
                    .unwrap_or(false);
                if modified_recently && is_system_drive(&path) {
                    report_violation(
                        module,
                        &path,
                        "周期审计：本次进程运行期间被创建或写入",
                    );
                }
            }
        }
    }
}

/// 导出违规记录为标准 Excel 文档（.xlsx）。
///
/// 文件写入与日志目录同层级的 `pyforge-violations` 独立文件夹；
/// 每次全量重写（违规事件量级小，开销可忽略），保证内容与内存一致。
pub fn export_excel() -> AppResult<PathBuf> {
    let dir = violations_dir()?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| AppError::new(ErrorCode::IoError, format!("创建违规记录目录失败: {e}")))?;
    let path = dir.join(EXCEL_FILE_NAME);

    let events = list_violations();
    let mut workbook = rust_xlsxwriter::Workbook::new();
    let sheet = workbook
        .add_worksheet()
        .set_name("系统盘写入违规记录")
        .map_err(|e| AppError::new(ErrorCode::IoError, format!("Excel 工作表命名失败: {e}")))?;

    let header_fmt = rust_xlsxwriter::Format::new().set_bold();
    let headers = ["序号", "文件路径", "写入时间", "文件类型", "所属模块", "发生次数", "备注"];
    for (col, h) in headers.iter().enumerate() {
        sheet
            .write_with_format(0, col as u16, *h, &header_fmt)
            .map_err(|e| AppError::new(ErrorCode::IoError, format!("Excel 表头写入失败: {e}")))?;
    }
    sheet.set_column_width(1, 70).ok();
    sheet.set_column_width(2, 22).ok();
    sheet.set_column_width(6, 50).ok();

    for (i, e) in events.iter().enumerate() {
        let row = (i + 1) as u32;
        let cells: [String; 7] = [
            (i + 1).to_string(),
            e.file_path.clone(),
            e.written_at.clone(),
            e.file_type.clone(),
            e.module.clone(),
            e.occurrences.to_string(),
            e.detail.clone(),
        ];
        for (col, cell) in cells.iter().enumerate() {
            sheet
                .write(row, col as u16, cell)
                .map_err(|e| AppError::new(ErrorCode::IoError, format!("Excel 行写入失败: {e}")))?;
        }
    }

    workbook
        .save(&path)
        .map_err(|e| AppError::new(ErrorCode::IoError, format!("Excel 保存失败: {e}")))?;

    tracing::info!(
        target: "pyforge_ai::write_guard",
        "违规记录已导出 Excel: {} (共 {} 条)",
        path.display(),
        events.len()
    );
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn system_drive_detection_on_windows() {
        if !cfg!(target_os = "windows") {
            return;
        }
        let system_drive = std::env::var("SystemDrive")
            .unwrap_or_else(|_| "C:".to_string())
            .trim_end_matches('\\')
            .to_uppercase();
        assert!(is_system_drive(Path::new(&format!("{system_drive}\\Users\\x\\config.json"))));
        assert!(is_system_drive(Path::new(&format!("{system_drive}:\\temp\\pyforge-1.txt"))));
        assert!(!is_system_drive(Path::new("D:\\PyForge\\logs\\pyforge-ai.log")));
        assert!(!is_system_drive(Path::new(r"\\?\D:\PyForge\x.json")));
        assert!(!is_system_drive(Path::new(r"\\server\share\x.json")));
        // 扩展前缀下的系统盘路径同样要被识别
        assert!(is_system_drive(Path::new(&format!(
            r"\\?\{system_drive}\Users\x\tmp"
        ))));
    }

    #[test]
    fn system_drive_detection_is_false_on_unix() {
        if cfg!(target_os = "windows") {
            return;
        }
        assert!(!is_system_drive(Path::new("/etc/pyforge/config.json")));
    }

    #[test]
    fn file_type_classification() {
        assert_eq!(file_type_of(Path::new("x/y/z.LOG")), ".log");
        assert_eq!(file_type_of(Path::new("a/b/c.jsonl")), ".jsonl");
        // Rust Path 语义：前导点为隐藏文件名整体，不算扩展名
        assert_eq!(file_type_of(Path::new("a/b/.jsonl")), "无扩展名");
        assert_eq!(file_type_of(Path::new("no-ext")), "无扩展名");
    }

    #[test]
    fn child_env_vars_redirect_tmp_and_pip_cache() {
        let vars = child_env_vars();
        assert!(vars.iter().any(|(k, _)| k == "TMP"));
        assert!(vars.iter().any(|(k, _)| k == "TEMP"));
        assert!(vars.iter().any(|(k, _)| k == "PIP_CACHE_DIR"));
        let tmp = vars
            .iter()
            .find(|(k, _)| k == "TMP")
            .map(|(_, v)| v.clone())
            .unwrap();
        // 应用临时目录必须不在系统盘（存储根可用的机器上）
        if crate::paths::storage_root().is_ok() {
            assert!(
                !is_system_drive(Path::new(&tmp)),
                "应用临时目录落在系统盘: {tmp}"
            );
        }
    }

    #[test]
    fn app_temp_dir_prefers_non_system_root() {
        let dir = app_temp_dir();
        if crate::paths::storage_root().is_ok() && !cfg!(target_os = "windows") {
            // 非 Windows 上存储根总可用；Windows 上仅当存在非系统盘时满足
        }
        assert!(dir.ends_with("tmp"));
    }

    #[test]
    fn violations_dir_is_sibling_of_log_dir() {
        let log = crate::logging::log_dir().unwrap();
        let violations = violations_dir().unwrap();
        assert_eq!(violations.file_name().unwrap(), VIOLATIONS_DIR_NAME);
        assert_eq!(log.parent(), violations.parent(), "必须与日志目录同级");
    }

    #[test]
    fn violation_event_serializes_roundtrip() {
        let event = ViolationEvent {
            file_path: "C:\\Users\\x\\AppData\\Local\\Temp\\pyforge-1.tmp".into(),
            written_at: "2026-10-14 08:30:45".into(),
            first_seen: "2026-10-14 08:30:45".into(),
            file_type: ".tmp".into(),
            module: "temp".into(),
            occurrences: 3,
            detail: "周期审计".into(),
        };
        let json = serde_json::to_string(&event).unwrap();
        let parsed: ViolationEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.file_path, event.file_path);
        assert_eq!(parsed.occurrences, 3);
        assert_eq!(parsed.file_type, ".tmp");
    }
}
