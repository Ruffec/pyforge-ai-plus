//! 结构化日志系统模块
//!
//! 提供应用级日志初始化、日志级别动态切换、日志文件轮转管理。
//! 基于 `tracing` 生态，文件采用企业级结构化纯文本格式（时间 / 级别 / 模块 /
//! 线程 ID / 全链路 trace ID / 正文），按大小轮转（默认 10MB，序号后缀递增）。
//! 所有公共 API 均预留，供未来模块扩展使用。

#![allow(dead_code)]

use crate::config::{get_config, LoggingConfig};
use crate::error::{AppError, AppResult, ErrorCode};
use std::fmt::Debug;
use std::path::PathBuf;
use std::sync::{OnceLock, RwLock};
use std::time::Duration;
use tracing::field;
use tracing::{debug, info, Level, Subscriber};
use tracing::Event as TracingEvent;
use tracing_subscriber::{
    fmt::{self, format::Writer, FormatEvent},
    prelude::*,
    registry::LookupSpan,
    EnvFilter,
    Layer,
};

/// 全局日志初始化状态。
static LOG_INITIALIZED: OnceLock<()> = OnceLock::new();

/// 进程级全链路 trace ID：进程启动后生成一次，本会话内所有日志事件
/// （含前端埋点转发）共享同一 ID，用于日志检索与全链路问题排查串联。
static TRACE_ID: OnceLock<String> = OnceLock::new();

/// 生成进程级 trace ID：时间纳秒 ^ 进程 ID ^ 序列 混合，固定 4 组 8 位十六进制段。
fn generate_trace_id() -> String {
    use std::sync::atomic::Ordering;
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let nanos = now.as_nanos() as u64;
    let pid = std::process::id() as u64;
    // pid 直接异或进低位：若 pid<<32 则 u32 截断会丢弃 pid 贡献，
    // seq=0 时首段与次段恒相同
    let mix = nanos ^ pid ^ SEQ.fetch_add(1, Ordering::Relaxed);
    format!(
        "{:08x}-{:08x}-{:08x}-{:08x}",
        mix as u32,
        nanos as u32,
        pid as u32,
        !(mix as u32)
    )
}

/// 获取当前进程的全链路 trace ID（未初始化时懒生成）。
pub fn trace_id() -> &'static str {
    TRACE_ID.get_or_init(generate_trace_id)
}

/// 当前本地时间的「年月日时分秒」文本（如 2026-10-14 08:30:45）。
pub fn local_timestamp_now() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

/// 当前线程的可读标识（如 thread-5，取自 ThreadId 数值部分）。
pub fn thread_label() -> String {
    let dbg = format!("{:?}", std::thread::current().id());
    let num = dbg
        .trim_start_matches("ThreadId(")
        .trim_end_matches(')')
        .to_string();
    format!("thread-{num}")
}

/// 标准日志级别名（DEBUG/INFO/WARN/ERROR）。
///
/// Rust tracing 生态无独立 FATAL：致命错误统一记为 ERROR（顶格级别），
/// 与企业规范五级中的 ERROR/FATAL 形成稳定映射，检索侧按 ERROR 过滤即可。
fn level_name(level: &Level) -> &'static str {
    match *level {
        Level::TRACE => "TRACE",
        Level::DEBUG => "DEBUG",
        Level::INFO => "INFO",
        Level::WARN => "WARN",
        Level::ERROR => "ERROR",
    }
}

/// 各日志级别的 ANSI 配色（业界通用后端规范）：
/// DEBUG=青、INFO=绿、WARN=黄、ERROR=加粗红、TRACE=暗紫。
fn level_ansi_code(level: &Level) -> &'static str {
    match *level {
        Level::TRACE => "2;35",
        Level::DEBUG => "36",
        Level::INFO => "32",
        Level::WARN => "33",
        Level::ERROR => "1;31",
    }
}

/// 用 ANSI 颜色码包裹文本，末尾完整复位序列——每段独立开闭，杜绝颜色串扰。
fn ansi_wrap(code: &str, text: &str) -> String {
    format!("\x1b[{code}m{text}\x1b[0m")
}

/// 把事件字段收集为「k=v」文本片段：message 正文单独提出，
/// 其余结构化字段按序拼接，保证日志正文可读且上下文完整。
/// `module` 字段会被提升为「模块名称」字段展示（前端埋点动态模块名），
/// 不再追加进正文。
#[derive(Default)]
struct TextFieldCollector {
    message: Option<String>,
    module: Option<String>,
    fields: Vec<String>,
}

impl field::Visit for TextFieldCollector {
    // record_str 拿原始字符串（Debug 形式会给 &str 加引号，污染模块名字段）
    fn record_str(&mut self, f: &field::Field, v: &str) {
        if f.name() == "message" {
            self.message = Some(v.to_string());
        } else if f.name() == "module" {
            self.module = Some(v.to_string());
        } else {
            self.fields.push(format!("{}={}", f.name(), v));
        }
    }
    fn record_debug(&mut self, f: &field::Field, v: &dyn Debug) {
        if f.name() == "message" {
            self.message = Some(format!("{v:?}"));
        } else if f.name() == "module" {
            self.module = Some(format!("{v:?}"));
        } else {
            self.fields.push(format!("{}={v:?}", f.name()));
        }
    }
}

/// 单条日志消息的长度上限（字符数）。
///
/// 超长消息（如误将大段数据/文件内容打入日志）若不设限，会同时打爆
/// 控制台（刷屏）与日志文件（单行膨胀 MB 级），日志查看与检索双双失效。
/// 超限部分统一截断并追加截断标记，控制台层与文件层同策略。
pub const MAX_LOG_MESSAGE_CHARS: usize = 4096;

/// 按字符边界截断超长文本（UTF-8 安全，String::truncate 按字节会切断多字节字符）。
pub fn truncate_chars(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        return s.to_string();
    }
    let total = s.chars().count();
    let head: String = s.chars().take(max_chars).collect();
    format!("{head}…[已截断，全长 {total} 字符]")
}

/// 企业级结构化文本日志行组装（纯函数，便于单元测试）。
///
/// 固定字段顺序：`时间 [级别] [模块] [线程ID] [trace_id] 正文 k1=v1 k2=v2`。
/// 正文与附加字段均按 [`MAX_LOG_MESSAGE_CHARS`] 截断，保证单行日志
/// 长度有界——这是「异常字符占满屏幕」类问题的代码级防线。
fn format_log_line(
    timestamp: &str,
    level_display: &str,
    module: &str,
    thread: &str,
    trace: &str,
    message_display: &str,
    extra_fields: &[String],
) -> String {
    let message_safe = truncate_chars(message_display, MAX_LOG_MESSAGE_CHARS);
    let mut line = format!("{timestamp} [{level_display}] [{module}] [{thread}] [{trace}] {message_safe}");
    for f in extra_fields {
        line.push(' ');
        line.push_str(&truncate_chars(f, MAX_LOG_MESSAGE_CHARS));
    }
    line
}

/// 企业级结构化文本日志格式。
///
/// 每条日志固定包含：本地时间（年月日时分秒）、标准级别（level）、
/// 模块来源标识（module）、线程标识（thread_id）、全链路 trace ID、
/// 消息正文（message），以及任意业务上下文字段（k=v 追加在正文之后）。
/// 控制台层带级别配色，文件层纯文本，满足日志检索 / 排查 / 监控的标准化接入。
#[derive(Clone, Copy, Default)]
struct EnterpriseText {
    /// 控制台层着色开关（文件层必须为 false，保证纯文本可检索）
    color: bool,
}

impl<S, N> FormatEvent<S, N> for EnterpriseText
where
    S: Subscriber + for<'a> LookupSpan<'a>,
    N: for<'a> tracing_subscriber::fmt::FormatFields<'a> + 'static,
{
    fn format_event(
        &self,
        _ctx: &tracing_subscriber::fmt::FmtContext<'_, S, N>,
        mut writer: Writer<'_>,
        event: &TracingEvent<'_>,
    ) -> std::fmt::Result {
        let level = level_name(event.metadata().level());
        let level_display = if self.color {
            ansi_wrap(level_ansi_code(event.metadata().level()), level)
        } else {
            level.to_string()
        };

        let mut collector = TextFieldCollector::default();
        event.record(&mut collector);
        let message = collector.message.unwrap_or_default();
        let message_display = if self.color {
            ansi_wrap(level_ansi_code(event.metadata().level()), &message)
        } else {
            message
        };
        // 模块名称：优先用事件携带的 module 字段（前端埋点动态模块名），
        // 否则回退到调用点静态 target
        let module_display = collector
            .module
            .unwrap_or_else(|| event.metadata().target().to_string());

        let line = format_log_line(
            &local_timestamp_now(),
            &level_display,
            &module_display,
            &thread_label(),
            trace_id(),
            &message_display,
            &collector.fields,
        );
        writeln!(writer, "{line}")
    }
}

/// 非阻塞写入器的生命周期守卫：必须存活于整个进程，
/// 一旦被 drop 后台写入线程立即停机，后续日志全部丢失。
static WORKER_GUARD: OnceLock<tracing_appender::non_blocking::WorkerGuard> = OnceLock::new();

/// 全局唯一活跃日志文件句柄（None = 尚未打开，事件静默丢弃）。
///
/// 通过 RwLock 支持运行期换绑：日志目录迁移完成后重新指向新目录文件，
/// 旧句柄随之释放，保证旧目录文件不再被写句柄占用，可被完整迁移或删除。
/// 这是跨盘迁移正确性的关键——不换绑的话，非阻塞写入线程会永远
/// 向旧目录的文件追加，新目录文件沦为冻结副本。
static ACTIVE_LOG_FILE: OnceLock<RwLock<Option<std::fs::File>>> = OnceLock::new();

fn active_log_file_lock() -> &'static RwLock<Option<std::fs::File>> {
    ACTIVE_LOG_FILE.get_or_init(|| RwLock::new(None))
}

/// 打开（或换绑）活跃日志文件到当前配置的日志目录。
///
/// 以追加模式打开 `pyforge-ai.log`（不存在则创建），并原子替换全局句柄；
/// 旧句柄随替换自动释放。启动初始化与日志目录迁移后均调用本函数。
pub fn open_active_log_file() -> AppResult<()> {
    let path = current_log_file()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            AppError::new(ErrorCode::IoError, format!("创建日志目录失败: {e}"))
        })?;
    }
    let file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| {
            AppError::new(ErrorCode::IoError, format!("打开日志文件失败: {e}"))
        })?;
    *active_log_file_lock()
        .write()
        .map_err(|_| AppError::new(ErrorCode::ConfigError, "日志文件锁获取失败（可能已中毒）"))? =
        Some(file);
    Ok(())
}

/// 活跃日志文件的 io::Write 适配（零状态）：非阻塞写入线程每收到一行
/// 就调用本写入器，每次写入经全局读锁解析「当前」活跃文件句柄——
/// 与换绑操作的写锁互斥，保证单行写入期间句柄不会中途更换，
/// 目录迁移换绑后新日志立即落入新目录文件。
struct ActiveFileWriter;

impl std::io::Write for ActiveFileWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let guard = active_log_file_lock()
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        match guard.as_ref() {
            // std::fs::File 实现了 `impl Write for &File`，共享引用即可写入
            Some(file) => (&*file).write(buf),
            // 文件尚未打开（启动极早期）：丢弃事件，避免阻塞日志管线
            None => Ok(buf.len()),
        }
    }
    fn flush(&mut self) -> std::io::Result<()> {
        let guard = active_log_file_lock()
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        match guard.as_ref() {
            Some(file) => (&*file).flush(),
            None => Ok(()),
        }
    }
}

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
///
/// 优先使用配置中的自定义目录（`logging.dir`），未配置或为空时
/// 回退到平台默认数据目录下的 `pyforge-ai/logs`。
pub fn log_dir() -> AppResult<PathBuf> {
    if let Ok(config) = get_config() {
        if let Some(dir) = config.logging.dir.as_deref() {
            let trimmed = dir.trim();
            if !trimmed.is_empty() {
                return Ok(PathBuf::from(trimmed));
            }
        }
    }
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

/// 获取违规记录文件夹路径。
///
/// 与日志存放目录处于同一级目录层级（如日志在 `D:\PyForge\logs`，
/// 违规记录在 `D:\PyForge\pyforge-violations`），保持目录结构清晰。
pub fn violations_dir() -> AppResult<PathBuf> {
    let parent = log_dir()?
        .parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| AppError::new(ErrorCode::ConfigError, "日志目录缺少父级，无法定位违规记录目录"))?;
    Ok(parent.join(crate::write_guard::VIOLATIONS_DIR_NAME))
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

    // 控制台输出层（与企业规范一致：控制台同为结构化文本，带级别配色）
    let console_layer = if logging.console_output {
        Some(
            fmt::layer()
                .event_format(EnterpriseText { color: true })
                .with_filter(filter.clone()),
        )
    } else {
        None
    };

    // 文件输出层（非阻塞；守卫存入全局 static 保证进程生命周期内写入线程不退出）。
    // 文件句柄由全局 ACTIVE_LOG_FILE 持有（可换绑），目录迁移后无需重建订阅者。
    open_active_log_file()?;
    let (non_blocking, guard) = tracing_appender::non_blocking(ActiveFileWriter);
    let _ = WORKER_GUARD.set(guard);

    let file_layer = fmt::layer()
        .event_format(EnterpriseText { color: false })
        .with_writer(non_blocking)
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
        current_log_file()?.display()
    );

    // 执行日志轮转检查
    rotate_logs(logging)?;

    // 启动周期轮转守护线程：每 60s 检查活跃日志大小，达到阈值自动轮转
    spawn_rotation_watcher();

    Ok(())
}

/// 启动后台轮转守护线程（每 10s 检查一次活跃文件大小，10MB 阈值下保证
/// 超限文件及时切割；仅初始化时启动一次）。
fn spawn_rotation_watcher() {
    static WATCHER_STARTED: OnceLock<()> = OnceLock::new();
    if WATCHER_STARTED.set(()).is_err() {
        return;
    }
    std::thread::Builder::new()
        .name("log-rotation".to_string())
        .spawn(move || loop {
            std::thread::sleep(Duration::from_secs(10));
            // 每轮重新读配置，用户在设置页调整大小/数量后无需重启即可生效
            match get_config() {
                Ok(cfg) => {
                    if let Err(e) = rotate_logs(&cfg.logging) {
                        tracing::warn!(
                            target: "pyforge_ai::logging",
                            "周期日志轮转失败: {e}"
                        );
                    }
                }
                Err(e) => {
                    tracing::warn!(
                        target: "pyforge_ai::logging",
                        "周期日志轮转读取配置失败: {e}"
                    );
                }
            }
        })
        .map(|_| ())
        .map_err(|e| {
            tracing::warn!(target: "pyforge_ai::logging", "启动轮转守护线程失败: {e}");
            e
        })
        .ok();
}

/// 手动轮转日志文件。
///
/// 当当前日志文件超过配置的大小时，将其重命名为 `.1`、`.2` 等，
/// 并删除超过保留数量的旧日志。
pub fn rotate_logs(config: &LoggingConfig) -> AppResult<()> {
    let log_dir = log_dir()?;
    rotate_logs_in(&log_dir, config)
}

/// 轮转核心逻辑（目录注入，便于单元测试）。
fn rotate_logs_in(dir: &PathBuf, config: &LoggingConfig) -> AppResult<()> {
    let current_file = dir.join("pyforge-ai.log");

    if !current_file.exists() {
        return Ok(());
    }

    let max_size_bytes = config.max_file_size_mb * 1024 * 1024;
    // Windows 目录枚举元数据（std::fs::metadata → GetFileAttributesExW）对
    // 仍被 non_blocking 写入线程持有句柄的文件可能长期返回陈旧大小，
    // 导致轮转永不触发；必须按句柄查询（GetFileInformationByHandle）实时读取。
    let size_bytes = std::fs::OpenOptions::new()
        .read(true)
        .open(&current_file)
        .and_then(|f| f.metadata().map(|m| m.len()))
        .map_err(|e| {
            AppError::new(ErrorCode::IoError, format!("句柄查询日志大小失败: {e}"))
        })?;
    if size_bytes < max_size_bytes {
        return Ok(());
    }

    debug!(
        target: "pyforge_ai::logging",
        "日志文件大小 {} 字节超过阈值 {} 字节，执行轮转",
        size_bytes,
        max_size_bytes
    );

    // 从最旧的开始删除/重命名
    for i in (1..=config.max_files).rev() {
        let old_file = dir.join(format!("pyforge-ai.log.{}", i));
        if i == config.max_files {
            // 删除最旧的
            if old_file.exists() {
                std::fs::remove_file(&old_file)
                    .map_err(|e| AppError::new(ErrorCode::IoError, format!("删除旧日志失败: {e}")))?;
            }
        } else {
            // 重命名 .i -> .i+1
            let new_file = dir.join(format!("pyforge-ai.log.{}", i + 1));
            if old_file.exists() {
                std::fs::rename(&old_file, &new_file)
                    .map_err(|e| AppError::new(ErrorCode::IoError, format!("重命名日志失败: {e}")))?;
            }
        }
    }

    // 当前日志归档。活跃文件被 non_blocking 写入线程持有着打开句柄，
    // Windows 上 rename 后句柄会跟随旧文件（即归档文件）继续写入，
    // 新建的活跃文件反而收不到任何日志，大小检查也随之永久失效。
    // 因此统一采用「复制归档 + 截断活跃文件」策略：写入线程的句柄
    // 始终指向活跃文件，截断后（追加语义）继续从头写入，无需重启进程。
    // 截断前短暂停顿，让写入线程排队的日志行先落盘，最小化丢失窗口。
    let first_archive = dir.join("pyforge-ai.log.1");
    std::fs::copy(&current_file, &first_archive).map_err(|e| {
        AppError::new(ErrorCode::IoError, format!("复制日志归档失败: {e}"))
    })?;
    std::thread::sleep(Duration::from_millis(50));
    let truncate = std::fs::OpenOptions::new()
        .write(true)
        .open(&current_file)
        .map_err(|e| AppError::new(ErrorCode::IoError, format!("打开日志文件失败: {e}")))?;
    truncate.set_len(0).map_err(|e| {
        AppError::new(ErrorCode::IoError, format!("截断日志文件失败: {e}"))
    })?;
    drop(truncate);

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
    let filter = EnvFilter::try_new(level.to_filter_directive())
        .unwrap_or_else(|_| EnvFilter::new("info"));

    let console_layer = if config.logging.console_output {
        Some(fmt::layer().event_format(EnterpriseText { color: true }).with_filter(filter.clone()))
    } else {
        None
    };

    // 文件句柄由全局 ACTIVE_LOG_FILE 持有，切换级别无需重新打开文件
    let (non_blocking, guard) = tracing_appender::non_blocking(ActiveFileWriter);
    let _ = WORKER_GUARD.set(guard);
    let file_layer = fmt::layer()
        .event_format(EnterpriseText { color: false })
        .with_writer(non_blocking)
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
        // 历史归档中可能残留超限行（限长防线生效前写入），读取侧兜底截断，
        // 保证未来接入日志查看 UI 时单行渲染长度有界
        .map(|l| truncate_chars(l, MAX_LOG_MESSAGE_CHARS * 2))
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

/// 日志目录迁移结果（前端用于进度提示与失败反馈）。
#[derive(Debug, Clone, serde::Serialize)]
pub struct LogMigrationResult {
    /// 原日志目录
    pub from_dir: String,
    /// 新日志目录
    pub to_dir: String,
    /// 成功迁移的文件名列表
    pub migrated_files: Vec<String>,
    /// 迁移失败的文件与原因（不阻塞其余文件）
    pub failed_files: Vec<String>,
    /// 成功迁移的字节数
    pub migrated_bytes: u64,
    /// 当前活跃日志文件是否因被占用而暂留原目录（重启后自然落到新目录）
    pub active_file_deferred: bool,
}

/// 校验目标目录可用：创建目录并验证可写（写入探测文件后删除）。
fn ensure_writable_dir(dir: &PathBuf) -> AppResult<()> {
    std::fs::create_dir_all(dir)
        .map_err(|e| AppError::new(ErrorCode::IoError, format!("创建日志目录失败: {e}")))?;
    let probe = dir.join(".pyforge-write-probe");
    std::fs::write(&probe, b"ok")
        .map_err(|e| AppError::new(ErrorCode::IoError, format!("日志目录不可写: {e}")))?;
    let _ = std::fs::remove_file(&probe);
    Ok(())
}

/// 把旧目录中的所有日志文件迁移到新目录，并持久化新目录到配置。
///
/// - 单文件失败不阻塞其余文件（逐文件收集异常）；
/// - Windows 下活跃日志文件可能被文件写入器占用：改名失败时改为复制，
///   原文件保留，写入器在下次启动后自然切换到新目录；
/// - 跨盘移动场景自动退化为「复制 + 删除原文件」。
pub fn migrate_logs_to(new_dir: &str) -> AppResult<LogMigrationResult> {
    let trimmed = new_dir.trim();
    if trimmed.is_empty() {
        return Err(AppError::new(
            ErrorCode::ConfigError,
            "日志目录不能为空",
        ));
    }
    let target = PathBuf::from(trimmed);
    ensure_writable_dir(&target)?;

    let old_dir = log_dir()?;
    // 目标与当前目录相同：无文件可迁，直接返回空结果（避免自我复制/误删活跃文件）
    if old_dir == target {
        return Ok(LogMigrationResult {
            from_dir: old_dir.to_string_lossy().to_string(),
            to_dir: target.to_string_lossy().to_string(),
            migrated_files: Vec::new(),
            failed_files: Vec::new(),
            migrated_bytes: 0,
            active_file_deferred: false,
        });
    }
    let mut result = LogMigrationResult {
        from_dir: old_dir.to_string_lossy().to_string(),
        to_dir: target.to_string_lossy().to_string(),
        migrated_files: Vec::new(),
        failed_files: Vec::new(),
        migrated_bytes: 0,
        active_file_deferred: false,
    };

    // 收集旧目录中的全部日志文件（pyforge-ai.log 与轮转归档 .1 .2 ...）
    let entries: Vec<PathBuf> = std::fs::read_dir(&old_dir)
        .map(|iter| {
            iter.filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| {
                    p.is_file()
                        && p.file_name()
                            .and_then(|n| n.to_str())
                            .map(|n| n.starts_with("pyforge-ai.log"))
                            .unwrap_or(false)
                })
                .collect()
        })
        .unwrap_or_default();

    let active_file = current_log_file().ok();
    for file in entries {
        let name = file
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let dest = target.join(&name);

        let bytes = std::fs::metadata(&file).map(|m| m.len()).unwrap_or(0);
        let moved = std::fs::rename(&file, &dest).is_ok();
        if moved {
            result.migrated_files.push(name);
            result.migrated_bytes += bytes;
            continue;
        }

        // rename 失败（跨盘 / 文件被占用）：复制兜底
        match std::fs::copy(&file, &dest) {
            Ok(_) => {
                let is_active = active_file.as_ref() == Some(&file);
                // 非活跃文件复制后删除原文件；活跃文件保留（被占用）
                if !is_active {
                    if std::fs::remove_file(&file).is_ok() {
                        result.migrated_files.push(name);
                        result.migrated_bytes += bytes;
                    } else {
                        result.failed_files.push(format!("{name}: 复制成功但删除原文件失败"));
                    }
                } else {
                    result.migrated_files.push(name);
                    result.migrated_bytes += bytes;
                    result.active_file_deferred = true;
                }
            }
            Err(e) => result.failed_files.push(format!("{name}: {e}")),
        }
    }

    // 持久化新目录到配置
    let dir_value = trimmed.to_string();
    crate::config::update_config(|config| {
        config.logging.dir = Some(dir_value.clone());
    })?;

    // 违规记录文件夹与日志目录同层级：日志目录迁移时同步搬移，保持结构一致
    migrate_violations_dir(&old_dir, &target, &mut result);

    // 换绑活跃日志文件到新目录：全局句柄重新指向新路径并释放旧句柄，
    // 后续写入随即落入新目录。跨盘迁移时旧活跃文件曾因写句柄占用
    // 无法删除（copy + defer 兜底路径），句柄释放后在此补删。
    let _ = open_active_log_file();
    let old_active = old_dir.join("pyforge-ai.log");
    if old_active.exists() && std::fs::remove_file(&old_active).is_ok() {
        result.active_file_deferred = false;
    }

    info!(
        target: "pyforge_ai::logging",
        "日志目录迁移完成: {} -> {}, 成功 {} 个文件, 失败 {} 个, 共 {} 字节",
        result.from_dir,
        result.to_dir,
        result.migrated_files.len(),
        result.failed_files.len(),
        result.migrated_bytes
    );
    Ok(result)
}

/// 把与旧日志目录同级的违规记录文件夹整体搬移到新日志目录的同级位置。
///
/// - 旧目录不存在或新旧同级位置相同则跳过；
/// - 同盘优先整目录 rename（原子、快速）；跨盘 / rename 失败退化为逐文件复制 + 删除；
/// - 单文件失败不阻塞其余文件，结果追加进迁移报告。
fn migrate_violations_dir(old_log_dir: &PathBuf, new_log_dir: &PathBuf, result: &mut LogMigrationResult) {
    let old_violations = match old_log_dir.parent() {
        Some(p) => p.join(crate::write_guard::VIOLATIONS_DIR_NAME),
        None => return,
    };
    let new_violations = match new_log_dir.parent() {
        Some(p) => p.join(crate::write_guard::VIOLATIONS_DIR_NAME),
        None => return,
    };
    if old_violations == new_violations || !old_violations.is_dir() {
        return;
    }
    if let Err(e) = std::fs::create_dir_all(&new_violations) {
        result.failed_files.push(format!(
            "{}: 创建违规记录目录失败: {e}",
            new_violations.display()
        ));
        return;
    }

    let entries: Vec<PathBuf> = std::fs::read_dir(&old_violations)
        .map(|iter| iter.filter_map(|e| e.ok()).map(|e| e.path()).collect())
        .unwrap_or_default();

    for file in entries {
        if !file.is_file() {
            continue;
        }
        let name = file
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let dest = new_violations.join(&name);
        let bytes = std::fs::metadata(&file).map(|m| m.len()).unwrap_or(0);
        if std::fs::rename(&file, &dest).is_ok() {
            result.migrated_files.push(name);
            result.migrated_bytes += bytes;
            continue;
        }
        match std::fs::copy(&file, &dest) {
            Ok(_) => {
                if std::fs::remove_file(&file).is_ok() {
                    result.migrated_files.push(name);
                    result.migrated_bytes += bytes;
                } else {
                    result.failed_files.push(format!("{name}: 复制成功但删除原违规记录文件失败"));
                }
            }
            Err(e) => result.failed_files.push(format!("{name}: {e}")),
        }
    }

    // 原目录已搬空则移除，避免残留空壳
    let _ = std::fs::remove_dir(&old_violations);

    info!(
        target: "pyforge_ai::logging",
        "违规记录目录已随日志目录迁移: {} -> {}",
        old_violations.display(),
        new_violations.display()
    );
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
    fn log_dir_is_configurable_or_default() {
        // 未配置时应指向默认数据目录；配置后应指向自定义目录
        let dir = log_dir().unwrap();
        assert!(!dir.as_os_str().is_empty());
    }

    #[test]
    fn current_log_file_has_expected_name() {
        let file = current_log_file().unwrap();
        assert_eq!(file.file_name().unwrap(), "pyforge-ai.log");
    }

    #[test]
    fn local_timestamp_has_enterprise_shape() {
        // 形如 2026-10-14 08:30:45：年月日时分秒、本地时间
        let ts = local_timestamp_now();
        assert_eq!(ts.len(), 19, "unexpected length: {ts}");
        assert_eq!(&ts[4..5], "-");
        assert_eq!(&ts[7..8], "-");
        assert_eq!(&ts[10..11], " ");
        assert_eq!(&ts[13..14], ":");
        assert_eq!(&ts[16..17], ":");
        assert!(ts.chars().take(10).all(|c| c.is_ascii_digit() || c == '-'));
        assert!(ts.chars().skip(11).all(|c| c.is_ascii_digit() || c == ':'));
    }

    #[test]
    fn thread_label_is_readable_and_numbered() {
        let label = thread_label();
        assert!(label.starts_with("thread-"), "unexpected label: {label}");
        let num = label.trim_start_matches("thread-");
        assert!(!num.is_empty() && num.chars().all(|c| c.is_ascii_digit()));
    }

    #[test]
    fn format_log_line_has_standard_field_order() {
        let line = format_log_line(
            "2026-10-14 08:30:45",
            "INFO",
            "pyforge_ai::python",
            "thread-5",
            "0a1b2c3d-11111111-00001234-ffffffcc",
            "扫描完成",
            &[],
        );
        assert_eq!(
            line,
            "2026-10-14 08:30:45 [INFO] [pyforge_ai::python] [thread-5] [0a1b2c3d-11111111-00001234-ffffffcc] 扫描完成"
        );
    }

    #[test]
    fn format_log_line_appends_extra_fields() {
        let line = format_log_line(
            "2026-10-14 08:30:45",
            "WARN",
            "pyforge_ai::write_guard",
            "thread-1",
            "trace",
            "检测到系统盘写入",
            &["path=D:\\x".to_string(), "module=config".to_string()],
        );
        assert!(line.ends_with("检测到系统盘写入 path=D:\\x module=config"));
        assert_eq!(line.matches(" [").count(), 4, "时间后固定 4 个括号字段");
    }

    #[test]
    fn format_log_line_truncates_oversized_message() {
        let big = "R".repeat(100_000);
        let line = format_log_line(
            "2026-10-14 08:30:45",
            "INFO",
            "m",
            "thread-1",
            "t",
            &big,
            &[],
        );
        // 格式前缀 + 4096 字符正文 + 截断标记，单行长度必须有界
        assert!(line.len() < MAX_LOG_MESSAGE_CHARS * 4 + 200, "超长消息必须被截断");
        assert!(line.contains("…[已截断，全长 100000 字符]"), "必须携带截断标记");
        assert_eq!(line.matches('R').count(), MAX_LOG_MESSAGE_CHARS, "正文保留前 4096 字符");
    }

    #[test]
    fn format_log_line_keeps_short_message_intact() {
        let line = format_log_line("t", "INFO", "m", "thread-1", "trace", "短消息", &[]);
        assert!(line.ends_with(" 短消息"), "未超限消息不得改动");
    }

    #[test]
    fn truncate_chars_is_utf8_safe() {
        let chinese = "扫".repeat(10_000);
        let truncated = truncate_chars(&chinese, 100);
        assert_eq!(truncated.chars().count(), 100 + "…[已截断，全长 10000 字符]".chars().count());
        assert!(truncated.ends_with("…[已截断，全长 10000 字符]"));
        // 混合多字节内容不产生切割损坏（截断结果始终是合法字符串，无需校验即证明）
        let mixed = format!("{}中{}", "a".repeat(5000), "文".repeat(5000));
        assert!(truncate_chars(&mixed, 10).chars().count() < 40);
        assert_eq!(truncate_chars("短", 100), "短", "未超限原样返回");
    }

    #[test]
    fn trace_id_is_stable_and_well_formed() {
        let first = trace_id().to_string();
        let second = trace_id().to_string();
        assert_eq!(first, second, "同进程内 trace_id 必须稳定");
        assert_eq!(first.len(), 35, "4 组 8 位十六进制 + 3 个连字符");
        assert_eq!(first.matches('-').count(), 3);
        assert!(first.chars().all(|c| c.is_ascii_hexdigit() || c == '-'));
    }

    #[test]
    fn level_name_maps_standard_levels() {
        assert_eq!(level_name(&Level::DEBUG), "DEBUG");
        assert_eq!(level_name(&Level::INFO), "INFO");
        assert_eq!(level_name(&Level::WARN), "WARN");
        assert_eq!(level_name(&Level::ERROR), "ERROR");
    }

    #[test]
    fn level_ansi_codes_follow_industry_convention() {
        assert_eq!(level_ansi_code(&Level::DEBUG), "36"); // 青
        assert_eq!(level_ansi_code(&Level::INFO), "32"); // 绿
        assert_eq!(level_ansi_code(&Level::WARN), "33"); // 黄
        assert_eq!(level_ansi_code(&Level::ERROR), "1;31"); // 加粗红
        assert_eq!(level_ansi_code(&Level::TRACE), "2;35"); // 暗紫
    }

    #[test]
    fn ansi_wrap_closes_reset_sequence() {
        let s = ansi_wrap("32", "hello");
        assert!(s.starts_with("\x1b[32m"));
        assert!(s.ends_with("\x1b[0m"));
        assert_eq!(s.matches("\x1b[").count(), 2, "开码+复位码各一段");
        assert_eq!(s.matches("\x1b[0m").count(), 1, "完整复位，无颜色串扰");
    }

    #[test]
    fn file_formatter_defaults_to_plain_text() {
        // 文件层必须纯文本（无 ANSI 配色），控制台层显式开启配色
        assert!(!EnterpriseText::default().color);
        assert!(EnterpriseText { color: true }.color);
    }

    /// 建立轮转测试专用临时目录（进程内唯一，测试结束自动清理）。
    fn rotation_test_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "pyforge-rotation-test-{tag}-{}",
            thread_label()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn rotation_skips_file_below_threshold() {
        let dir = rotation_test_dir("below");
        let current = dir.join("pyforge-ai.log");
        std::fs::write(&current, "small log line\n").unwrap();

        let config = LoggingConfig {
            max_file_size_mb: 10,
            max_files: 3,
            ..Default::default()
        };
        rotate_logs_in(&dir, &config).unwrap();

        assert!(current.exists(), "未达阈值时活跃文件必须保持不变");
        assert!(!dir.join("pyforge-ai.log.1").exists(), "未达阈值不得产生归档");
        assert_eq!(std::fs::read_to_string(&current).unwrap(), "small log line\n");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rotation_archives_at_threshold_and_shifts_suffixes() {
        let dir = rotation_test_dir("shift");
        let current = dir.join("pyforge-ai.log");
        // 1MB 阈值 + 1 字节触发轮转
        let big = vec![b'x'; 1024 * 1024 + 1];
        std::fs::write(&current, &big).unwrap();
        std::fs::write(dir.join("pyforge-ai.log.1"), "archive-1").unwrap();
        std::fs::write(dir.join("pyforge-ai.log.2"), "archive-2").unwrap();

        let config = LoggingConfig {
            max_file_size_mb: 1,
            max_files: 5,
            ..Default::default()
        };
        rotate_logs_in(&dir, &config).unwrap();

        assert_eq!(
            std::fs::read_to_string(dir.join("pyforge-ai.log.1")).unwrap_or_default().len(),
            1024 * 1024 + 1,
            "超限活跃文件必须完整归档为 .1（字节数零丢失）"
        );
        assert_eq!(
            std::fs::read_to_string(dir.join("pyforge-ai.log.2")).unwrap(),
            "archive-1",
            "旧 .1 顺移为 .2"
        );
        assert_eq!(
            std::fs::read_to_string(dir.join("pyforge-ai.log.3")).unwrap(),
            "archive-2",
            "旧 .2 顺移为 .3"
        );
        let rebuilt = std::fs::metadata(&current).unwrap().len();
        assert_eq!(rebuilt, 0, "轮转后必须重建空活跃文件供写入线程续写");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rotation_drops_oldest_beyond_max_files() {
        let dir = rotation_test_dir("drop");
        let current = dir.join("pyforge-ai.log");
        let big = vec![b'y'; 1024 * 1024];
        std::fs::write(&current, &big).unwrap();
        std::fs::write(dir.join("pyforge-ai.log.1"), "archive-1").unwrap();
        std::fs::write(dir.join("pyforge-ai.log.3"), "archive-3-oldest").unwrap();

        let config = LoggingConfig {
            max_file_size_mb: 1,
            max_files: 3,
            ..Default::default()
        };
        rotate_logs_in(&dir, &config).unwrap();

        // max_files=3：轮转后保留 .1(新归档)/.2(旧.1)，旧 .3 超出保留数被删除
        assert_eq!(
            std::fs::read_to_string(dir.join("pyforge-ai.log.1")).unwrap().len(),
            1024 * 1024
        );
        assert_eq!(
            std::fs::read_to_string(dir.join("pyforge-ai.log.2")).unwrap(),
            "archive-1"
        );
        assert!(!dir.join("pyforge-ai.log.3").exists(), "最旧归档超出保留数量必须删除");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn violations_dir_migration_moves_all_files_intact() {
        let base = rotation_test_dir("viol-mig");
        let old_logs = base.join("old").join("logs");
        let new_logs = base.join("new").join("logs");
        std::fs::create_dir_all(&old_logs).unwrap();
        std::fs::create_dir_all(&new_logs).unwrap();
        let old_violations = old_logs.parent().unwrap().join(crate::write_guard::VIOLATIONS_DIR_NAME);
        std::fs::create_dir_all(&old_violations).unwrap();
        std::fs::write(old_violations.join("violations.jsonl"), "{\"k\":1}\n{\"k\":2}\n").unwrap();
        std::fs::write(old_violations.join("pyforge-violations.xlsx"), "PK\x03\x04fake").unwrap();
        std::fs::write(old_logs.join("pyforge-ai.log"), "keep-me").unwrap();

        let mut result = LogMigrationResult {
            from_dir: old_logs.to_string_lossy().to_string(),
            to_dir: new_logs.to_string_lossy().to_string(),
            migrated_files: Vec::new(),
            failed_files: Vec::new(),
            migrated_bytes: 0,
            active_file_deferred: false,
        };
        migrate_violations_dir(&old_logs, &new_logs, &mut result);

        let new_violations = new_logs.parent().unwrap().join(crate::write_guard::VIOLATIONS_DIR_NAME);
        assert_eq!(
            std::fs::read_to_string(new_violations.join("violations.jsonl")).unwrap(),
            "{\"k\":1}\n{\"k\":2}\n",
            "jsonl 内容必须逐字节完整迁移"
        );
        assert!(new_violations.join("pyforge-violations.xlsx").exists());
        assert!(!old_violations.exists(), "旧违规记录目录迁空后应移除");
        assert!(
            result.failed_files.is_empty(),
            "迁移不应有失败项: {:?}",
            result.failed_files
        );
        assert_eq!(result.migrated_files.len(), 2, "两个违规记录文件都应计入迁移结果");
        assert_eq!(
            std::fs::read_to_string(old_logs.join("pyforge-ai.log")).unwrap(),
            "keep-me",
            "日志目录本身的文件不受违规目录迁移影响"
        );
        let _ = std::fs::remove_dir_all(&base);
    }
}
