//! 应用配置管理模块
//!
//! 负责应用配置的加载、持久化、默认值管理，以及 AI 配置的安全存储。
//! 配置文件存储在系统配置目录下的 `pyforge-ai/config.json`。
//! 所有公共 API 均预留，供未来模块扩展使用。

#![allow(dead_code)]

use crate::error::{AppError, AppResult, ErrorCode};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::RwLock;
use once_cell::sync::Lazy;

/// 全局配置单例。
static CONFIG: Lazy<RwLock<Option<AppConfig>>> = Lazy::new(|| RwLock::new(None));

/// 应用全局配置。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    /// 应用版本
    #[serde(default = "default_version")]
    pub version: String,

    /// 通用设置
    #[serde(default)]
    pub general: GeneralConfig,

    /// Python 相关设置
    #[serde(default)]
    pub python: PythonConfig,

    /// 虚拟环境设置
    #[serde(default)]
    pub venv: VenvConfig,

    /// 包管理设置
    #[serde(default)]
    pub package: PackageConfig,

    /// AI 相关设置
    #[serde(default)]
    pub ai: AiConfig,

    /// 日志设置
    #[serde(default)]
    pub logging: LoggingConfig,

    /// UI 设置
    #[serde(default)]
    pub ui: UiConfig,
}

fn default_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// 通用设置。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneralConfig {
    /// 是否启动时自动检查更新
    #[serde(default = "default_true")]
    pub auto_check_updates: bool,

    /// 是否发送匿名使用统计
    #[serde(default = "default_false")]
    pub telemetry_enabled: bool,

    /// 语言设置
    #[serde(default = "default_language")]
    pub language: String,

    /// 最近打开的项目路径列表
    #[serde(default)]
    pub recent_projects: Vec<String>,
}

impl Default for GeneralConfig {
    fn default() -> Self {
        Self {
            auto_check_updates: true,
            telemetry_enabled: false,
            language: "zh-CN".to_string(),
            recent_projects: Vec::new(),
        }
    }
}

/// Python 相关设置。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PythonConfig {
    /// 默认 Python 版本偏好（如 "3.12"）
    #[serde(default)]
    pub preferred_version: Option<String>,

    /// 额外的 Python 搜索路径
    #[serde(default)]
    pub extra_search_paths: Vec<String>,

    /// 是否扫描系统 PATH 中的 Python
    #[serde(default = "default_true")]
    pub scan_system_path: bool,

    /// 是否扫描 pyenv 管理的 Python
    #[serde(default = "default_true")]
    pub scan_pyenv: bool,

    /// 扫描结果缓存有效期（秒）
    #[serde(default = "default_scan_cache_ttl")]
    pub scan_cache_ttl: u64,
}

impl Default for PythonConfig {
    fn default() -> Self {
        Self {
            preferred_version: None,
            extra_search_paths: Vec::new(),
            scan_system_path: true,
            scan_pyenv: true,
            scan_cache_ttl: 300,
        }
    }
}

fn default_scan_cache_ttl() -> u64 {
    300
}

/// 虚拟环境设置。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VenvConfig {
    /// 默认虚拟环境存储目录
    #[serde(default = "default_venv_root")]
    pub default_root: String,

    /// 创建环境时是否自动升级 pip
    #[serde(default = "default_true")]
    pub auto_upgrade_pip: bool,

    /// 创建环境时默认安装的包列表
    #[serde(default)]
    pub default_packages: Vec<String>,

    /// 是否在删除环境前要求确认
    #[serde(default = "default_true")]
    pub confirm_before_remove: bool,
}

impl Default for VenvConfig {
    fn default() -> Self {
        Self {
            default_root: default_venv_root(),
            auto_upgrade_pip: true,
            default_packages: vec!["pip".to_string(), "setuptools".to_string(), "wheel".to_string()],
            confirm_before_remove: true,
        }
    }
}

fn default_venv_root() -> String {
    if let Some(data_dir) = dirs::data_dir() {
        data_dir.join("pyforge-ai").join("venvs").to_string_lossy().to_string()
    } else {
        "~/.pyforge/venvs".to_string()
    }
}

/// 包管理设置。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackageConfig {
    /// 默认镜像源 ID
    #[serde(default = "default_mirror")]
    pub default_mirror: String,

    /// 安装包时是否使用缓存
    #[serde(default = "default_true")]
    pub use_cache: bool,

    /// 并发下载数
    #[serde(default = "default_concurrent")]
    pub concurrent_downloads: u32,

    /// 网络超时（秒）
    #[serde(default = "default_timeout")]
    pub network_timeout: u64,

    /// 是否在安装前检查依赖冲突
    #[serde(default = "default_true")]
    pub check_conflicts: bool,
}

impl Default for PackageConfig {
    fn default() -> Self {
        Self {
            default_mirror: "tsinghua".to_string(),
            use_cache: true,
            concurrent_downloads: 4,
            network_timeout: 30,
            check_conflicts: true,
        }
    }
}

fn default_mirror() -> String {
    "tsinghua".to_string()
}

fn default_concurrent() -> u32 {
    4
}

fn default_timeout() -> u64 {
    30
}

/// AI 相关设置。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiConfig {
    /// API 提供商（openai / azure / custom / local）
    #[serde(default = "default_ai_provider")]
    pub provider: String,

    /// API 密钥（加密存储）
    #[serde(default)]
    pub api_key: String,

    /// 使用的模型名称
    #[serde(default = "default_ai_model")]
    pub model: String,

    /// 自定义 API 基础 URL
    #[serde(default)]
    pub base_url: Option<String>,

    /// 生成温度
    #[serde(default = "default_temperature")]
    pub temperature: f32,

    /// 最大 token 数
    #[serde(default = "default_max_tokens")]
    pub max_tokens: u32,

    /// 是否使用本地 LLM
    #[serde(default = "default_false")]
    pub use_local_llm: bool,

    /// 本地 LLM 端点
    #[serde(default)]
    pub local_llm_endpoint: Option<String>,

    /// 对话历史是否持久化
    #[serde(default = "default_true")]
    pub persist_chat_history: bool,

    /// 部署方案是否自动执行
    #[serde(default = "default_false")]
    pub auto_execute_deployment: bool,
}

impl Default for AiConfig {
    fn default() -> Self {
        Self {
            provider: "openai".to_string(),
            api_key: String::new(),
            model: "gpt-4o-mini".to_string(),
            base_url: None,
            temperature: 0.7,
            max_tokens: 4096,
            use_local_llm: false,
            local_llm_endpoint: None,
            persist_chat_history: true,
            auto_execute_deployment: false,
        }
    }
}

fn default_ai_provider() -> String {
    "openai".to_string()
}

fn default_ai_model() -> String {
    "gpt-4o-mini".to_string()
}

fn default_temperature() -> f32 {
    0.7
}

fn default_max_tokens() -> u32 {
    4096
}

/// 日志设置。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoggingConfig {
    /// 日志级别（off / error / warn / info / debug / trace）
    #[serde(default = "default_log_level")]
    pub level: String,

    /// 日志文件最大大小（MB）
    #[serde(default = "default_log_max_size")]
    pub max_file_size_mb: u64,

    /// 日志文件保留数量
    #[serde(default = "default_log_max_files")]
    pub max_files: u32,

    /// 是否输出到控制台
    #[serde(default = "default_true")]
    pub console_output: bool,
}

impl Default for LoggingConfig {
    fn default() -> Self {
        Self {
            level: "info".to_string(),
            max_file_size_mb: 10,
            max_files: 5,
            console_output: true,
        }
    }
}

fn default_log_level() -> String {
    "info".to_string()
}

fn default_log_max_size() -> u64 {
    10
}

fn default_log_max_files() -> u32 {
    5
}

/// UI 设置。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UiConfig {
    /// 主题（light / dark / system）
    #[serde(default = "default_theme")]
    pub theme: String,

    /// 主色调
    #[serde(default = "default_accent_color")]
    pub accent_color: String,

    /// 字体大小（small / medium / large）
    #[serde(default = "default_font_size")]
    pub font_size: String,

    /// 侧边栏是否折叠
    #[serde(default = "default_false")]
    pub sidebar_collapsed: bool,
}

impl Default for UiConfig {
    fn default() -> Self {
        Self {
            theme: "system".to_string(),
            accent_color: "#3b82f6".to_string(),
            font_size: "medium".to_string(),
            sidebar_collapsed: false,
        }
    }
}

fn default_theme() -> String {
    "system".to_string()
}

fn default_accent_color() -> String {
    "#3b82f6".to_string()
}

fn default_font_size() -> String {
    "medium".to_string()
}

// 默认值辅助函数
fn default_true() -> bool {
    true
}

fn default_false() -> bool {
    false
}

fn default_language() -> String {
    "zh-CN".to_string()
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            version: default_version(),
            general: GeneralConfig::default(),
            python: PythonConfig::default(),
            venv: VenvConfig::default(),
            package: PackageConfig::default(),
            ai: AiConfig::default(),
            logging: LoggingConfig::default(),
            ui: UiConfig::default(),
        }
    }
}

impl AppConfig {
    /// 获取配置文件路径。
    pub fn config_path() -> AppResult<PathBuf> {
        let config_dir = dirs::config_dir()
            .ok_or_else(|| AppError::new(ErrorCode::ConfigError, "无法确定系统配置目录"))?;
        Ok(config_dir.join("pyforge-ai").join("config.json"))
    }

    /// 从磁盘加载配置，不存在则返回默认配置。
    pub fn load() -> AppResult<Self> {
        let path = Self::config_path()?;
        if !path.exists() {
            return Ok(Self::default());
        }

        let content = std::fs::read_to_string(&path)
            .map_err(|e| AppError::new(ErrorCode::ConfigError, format!("读取配置文件失败: {e}")))?;

        let config: Self = serde_json::from_str(&content)
            .map_err(|e| AppError::new(ErrorCode::ConfigError, format!("配置文件解析失败: {e}")))?;

        Ok(config)
    }

    /// 保存配置到磁盘。
    pub fn save(&self) -> AppResult<()> {
        let path = Self::config_path()?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| AppError::new(ErrorCode::ConfigError, format!("创建配置目录失败: {e}")))?;
        }

        let content = serde_json::to_string_pretty(self)
            .map_err(|e| AppError::new(ErrorCode::ConfigError, format!("序列化配置失败: {e}")))?;

        std::fs::write(&path, content)
            .map_err(|e| AppError::new(ErrorCode::ConfigError, format!("写入配置文件失败: {e}")))?;

        Ok(())
    }

    /// 验证配置的有效性。
    pub fn validate(&self) -> AppResult<()> {
        if self.ai.temperature < 0.0 || self.ai.temperature > 2.0 {
            return Err(AppError::new(
                ErrorCode::AiConfigInvalid,
                format!("AI 温度必须在 0.0-2.0 之间，当前为 {}", self.ai.temperature),
            ));
        }
        if self.package.network_timeout == 0 {
            return Err(AppError::new(
                ErrorCode::ConfigError,
                "网络超时不能为 0",
            ));
        }
        Ok(())
    }
}

/// 初始化全局配置（从磁盘加载）。
pub fn init_config() -> AppResult<()> {
    let config = AppConfig::load()?;
    config.validate()?;
    let mut guard = CONFIG.write().map_err(|_| {
        AppError::new(ErrorCode::ConfigError, "配置锁获取失败（可能已中毒）")
    })?;
    *guard = Some(config);
    Ok(())
}

/// 获取全局配置的克隆。
pub fn get_config() -> AppResult<AppConfig> {
    let guard = CONFIG.read().map_err(|_| {
        AppError::new(ErrorCode::ConfigError, "配置锁获取失败（可能已中毒）")
    })?;
    match guard.as_ref() {
        Some(config) => Ok(config.clone()),
        None => Ok(AppConfig::default()),
    }
}

/// 更新全局配置并持久化。
pub fn update_config<F>(updater: F) -> AppResult<AppConfig>
where
    F: FnOnce(&mut AppConfig),
{
    let mut guard = CONFIG.write().map_err(|_| {
        AppError::new(ErrorCode::ConfigError, "配置锁获取失败（可能已中毒）")
    })?;

    let mut config = guard.clone().unwrap_or_default();
    updater(&mut config);
    config.validate()?;
    config.save()?;
    *guard = Some(config.clone());
    Ok(config)
}

/// 重置配置为默认值。
pub fn reset_config() -> AppResult<AppConfig> {
    let config = AppConfig::default();
    config.save()?;
    let mut guard = CONFIG.write().map_err(|_| {
        AppError::new(ErrorCode::ConfigError, "配置锁获取失败（可能已中毒）")
    })?;
    *guard = Some(config.clone());
    Ok(config)
}

/// 获取配置文件所在目录。
pub fn config_dir() -> AppResult<PathBuf> {
    let path = AppConfig::config_path()?;
    path.parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| AppError::new(ErrorCode::ConfigError, "配置目录无效"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_has_expected_version() {
        let config = AppConfig::default();
        assert_eq!(config.version, env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn default_config_validates() {
        let config = AppConfig::default();
        assert!(config.validate().is_ok());
    }

    #[test]
    fn invalid_temperature_fails_validation() {
        let mut config = AppConfig::default();
        config.ai.temperature = 3.0;
        assert!(config.validate().is_err());
    }

    #[test]
    fn zero_timeout_fails_validation() {
        let mut config = AppConfig::default();
        config.package.network_timeout = 0;
        assert!(config.validate().is_err());
    }

    #[test]
    fn config_serializes_and_deserializes() {
        let config = AppConfig::default();
        let json = serde_json::to_string(&config).unwrap();
        let restored: AppConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.version, config.version);
        assert_eq!(restored.ai.model, config.ai.model);
        assert_eq!(restored.general.language, config.general.language);
    }

    #[test]
    fn default_venv_root_is_under_data_dir() {
        let config = VenvConfig::default();
        assert!(config.default_root.contains("pyforge-ai"));
        assert!(config.default_root.contains("venvs"));
    }
}
