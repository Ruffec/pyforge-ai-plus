//! 包与镜像源管理模块
//!
//! 提供 pip 包的安装、卸载、搜索、升级，以及镜像源管理功能。
//! 所有公共 API 均预留，供未来模块扩展使用。

#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use reqwest::StatusCode;
use serde::{Deserialize, Serialize};

use crate::security;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PipMirror {
    pub id: String,
    pub name: String,
    pub url: String,
    pub latency_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackageInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub latest_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledPackage {
    pub name: String,
    pub version: String,
    pub latest_version: String,
    pub size: u64,
}

pub struct PackageManager;

pub fn get_default_mirrors() -> Vec<PipMirror> {
    vec![
        PipMirror {
            id: "tsinghua".to_string(),
            name: "清华大学".to_string(),
            url: "https://pypi.tuna.tsinghua.edu.cn/simple".to_string(),
            latency_ms: 0,
        },
        PipMirror {
            id: "aliyun".to_string(),
            name: "阿里云".to_string(),
            url: "https://mirrors.aliyun.com/pypi/simple/".to_string(),
            latency_ms: 0,
        },
        PipMirror {
            id: "douban".to_string(),
            name: "豆瓣".to_string(),
            url: "https://pypi.doubanio.com/simple/".to_string(),
            latency_ms: 0,
        },
        PipMirror {
            id: "tencent".to_string(),
            name: "腾讯云".to_string(),
            url: "https://mirrors.cloud.tencent.com/pypi/simple/".to_string(),
            latency_ms: 0,
        },
        PipMirror {
            id: "pypi".to_string(),
            name: "PyPI 官方".to_string(),
            url: "https://pypi.org/simple/".to_string(),
            latency_ms: 0,
        },
    ]
}

fn pip_config_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Some(config_dir) = dirs::config_dir() {
        if std::env::consts::OS == "windows" {
            candidates.push(config_dir.join("pip").join("pip.ini"));
        } else {
            candidates.push(config_dir.join("pip").join("pip.conf"));
        }
    }

    if let Some(home_dir) = dirs::home_dir() {
        candidates.push(home_dir.join(".pip").join("pip.conf"));
        candidates.push(home_dir.join("pip").join("pip.ini"));
    }

    candidates
}

fn pip_config_path_for_write() -> Option<PathBuf> {
    let config_dir = dirs::config_dir()?;
    let path = if std::env::consts::OS == "windows" {
        config_dir.join("pip").join("pip.ini")
    } else {
        config_dir.join("pip").join("pip.conf")
    };
    Some(path)
}

fn parse_current_index_url(content: &str) -> Option<String> {
    let mut in_global = false;

    for line in content.lines() {
        let trimmed = line.trim();

        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            let section = trimmed[1..trimmed.len() - 1].trim().to_lowercase();
            in_global = section == "global";
            continue;
        }

        if in_global {
            if let Some((key, value)) = trimmed.split_once('=') {
                let key = key.trim().to_lowercase().replace('_', "-");
                if key == "index-url" {
                    return Some(
                        value
                            .trim()
                            .trim_matches('"')
                            .trim_matches('\'')
                            .to_string(),
                    );
                }
            }
        }
    }

    None
}

fn mirror_from_url(url: &str) -> PipMirror {
    let defaults = get_default_mirrors();
    if let Some(mirror) = defaults
        .iter()
        .find(|m| m.url.trim_end_matches('/') == url.trim_end_matches('/'))
    {
        return mirror.clone();
    }

    PipMirror {
        id: "custom".to_string(),
        name: "自定义镜像".to_string(),
        url: url.to_string(),
        latency_ms: 0,
    }
}

pub fn get_current_mirror() -> Option<PipMirror> {
    let path = pip_config_candidates().into_iter().find(|p| p.exists())?;
    let content = std::fs::read_to_string(path).ok()?;
    let url = parse_current_index_url(&content)?;
    Some(mirror_from_url(&url))
}

pub fn set_mirror(mirror_url: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    security::validate_url_scheme(mirror_url, &["https"])
        .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> { e.to_string().into() })?;

    let path = pip_config_path_for_write().ok_or_else(
        || -> Box<dyn std::error::Error + Send + Sync> {
            "无法定位 pip 配置文件目录".into()
        },
    )?;

    let mut content = if path.exists() {
        std::fs::read_to_string(&path)?
    } else {
        String::new()
    };

    if content.trim().is_empty() {
        content = format!("[global]\nindex-url = {}\n", mirror_url);
    } else {
        let mut lines: Vec<String> = content.lines().map(String::from).collect();
        let mut global_section_idx = None;
        let mut index_url_idx = None;
        let mut in_global = false;

        for (i, line) in lines.iter().enumerate() {
            let trimmed = line.trim();

            if trimmed.starts_with('[') && trimmed.ends_with(']') {
                let section = trimmed[1..trimmed.len() - 1].trim().to_lowercase();
                in_global = section == "global";
                if in_global {
                    global_section_idx = Some(i);
                }
                continue;
            }

            if in_global {
                if let Some((key, _)) = trimmed.split_once('=') {
                    let key = key.trim().to_lowercase().replace('_', "-");
                    if key == "index-url" {
                        index_url_idx = Some(i);
                        break;
                    }
                }
            }
        }

        if let Some(idx) = index_url_idx {
            lines[idx] = format!("index-url = {}", mirror_url);
        } else if let Some(idx) = global_section_idx {
            lines.insert(idx + 1, format!("index-url = {}", mirror_url));
        } else {
            lines.push(String::new());
            lines.push("[global]".to_string());
            lines.push(format!("index-url = {}", mirror_url));
        }

        content = lines.join("\n");
        if !content.ends_with('\n') {
            content.push('\n');
        }
    }

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    std::fs::write(&path, content)?;
    Ok(())
}

pub async fn test_mirror_speed(mirror: &PipMirror) -> Result<u64, reqwest::Error> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()?;

    let start = Instant::now();
    let resp = client.head(&mirror.url).send().await?;
    resp.error_for_status_ref()?;

    Ok(start.elapsed().as_millis() as u64)
}

#[derive(Debug, Deserialize)]
struct PypiInfo {
    name: String,
    version: String,
    summary: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PypiResponse {
    info: PypiInfo,
}

pub async fn search_package(query: &str) -> Result<Vec<PackageInfo>, reqwest::Error> {
    let url = format!("https://pypi.org/pypi/{}/json", query);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()?;

    let resp = client.get(&url).send().await?;

    if resp.status() == StatusCode::NOT_FOUND {
        return Ok(Vec::new());
    }

    let data: PypiResponse = resp.error_for_status()?.json().await?;
    let version = data.info.version.clone();

    Ok(vec![PackageInfo {
        id: data.info.name.to_lowercase(),
        name: data.info.name,
        version: version.clone(),
        description: data.info.summary.unwrap_or_default(),
        latest_version: version,
    }])
}

#[derive(Debug, Deserialize)]
struct PipListEntry {
    name: String,
    version: String,
    latest_version: Option<String>,
}

pub async fn list_installed_packages(
    python_path: &Path,
) -> Result<Vec<InstalledPackage>, Box<dyn std::error::Error + Send + Sync>> {
    let output = tokio::process::Command::new(python_path)
        .args(["-m", "pip", "list", "--format=json", "--outdated"])
        .output()
        .await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("pip list 执行失败: {}", stderr).into());
    }

    let entries: Vec<PipListEntry> = serde_json::from_slice(&output.stdout)?;

    Ok(entries
        .into_iter()
        .map(|entry| InstalledPackage {
            name: entry.name,
            version: entry.version,
            latest_version: entry.latest_version.unwrap_or_default(),
            size: 0,
        })
        .collect())
}

// ============================================================================
// 包安装/卸载/批量安装
// ============================================================================

/// 获取虚拟环境中的 Python 可执行文件路径。
fn venv_python_path(venv_path: &Path) -> PathBuf {
    if cfg!(target_os = "windows") {
        venv_path.join("Scripts").join("python.exe")
    } else {
        venv_path.join("bin").join("python")
    }
}

/// 在指定虚拟环境中安装单个包。
pub async fn install_package(
    venv_path: &Path,
    package_name: &str,
    version: Option<&str>,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let python = venv_python_path(venv_path);
    if !python.exists() {
        return Err(format!("虚拟环境中未找到 Python: {}", python.display()).into());
    }

    // 安全校验包名
    let sanitized_name = sanitize_package_name(package_name);
    if sanitized_name.is_empty() {
        return Err("包名无效".into());
    }

    let package_spec = match version {
        Some(v) if !v.is_empty() => format!("{}=={}", sanitized_name, v),
        _ => sanitized_name.clone(),
    };

    let mut args = vec!["-m", "pip", "install", "--upgrade", "--no-input"];

    // 从配置读取镜像源
    let mirror_url = if let Ok(config) = crate::config::get_config() {
        get_default_mirrors()
            .into_iter()
            .find(|m| m.id == config.package.default_mirror)
            .map(|m| m.url)
    } else {
        None
    };
    if let Some(ref url) = mirror_url {
        args.push("-i");
        args.push(url.as_str());
    }

    args.push(&package_spec);

    let output = tokio::process::Command::new(&python)
        .args(&args)
        .output()
        .await?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        return Err(format!("包安装失败: {}\n{}", stderr, stdout).into());
    }

    crate::app_info!(target: "pyforge_ai::package", "包安装成功: {}", package_spec);
    Ok(stdout)
}

/// 在指定虚拟环境中卸载包。
pub async fn uninstall_package(
    venv_path: &Path,
    package_name: &str,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let python = venv_python_path(venv_path);
    if !python.exists() {
        return Err(format!("虚拟环境中未找到 Python: {}", python.display()).into());
    }

    let sanitized_name = sanitize_package_name(package_name);
    if sanitized_name.is_empty() {
        return Err("包名无效".into());
    }

    let output = tokio::process::Command::new(&python)
        .args(["-m", "pip", "uninstall", "-y", &sanitized_name])
        .output()
        .await?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        return Err(format!("包卸载失败: {}\n{}", stderr, stdout).into());
    }

    crate::app_info!(target: "pyforge_ai::package", "包卸载成功: {}", sanitized_name);
    Ok(stdout)
}

/// 从 requirements.txt 内容批量安装包。
pub async fn install_from_requirements(
    venv_path: &Path,
    requirements: &str,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    use std::io::Write;

    let python = venv_python_path(venv_path);
    if !python.exists() {
        return Err(format!("虚拟环境中未找到 Python: {}", python.display()).into());
    }

    if requirements.trim().is_empty() {
        return Err("requirements 内容为空".into());
    }

    // 写入临时 requirements 文件
    let temp_dir = std::env::temp_dir();
    let req_file = temp_dir.join(format!("pyforge-requirements-{}.txt", std::process::id()));
    {
        let mut file = std::fs::File::create(&req_file)?;
        file.write_all(requirements.as_bytes())?;
    }

    let mut args = vec!["-m", "pip", "install", "-r"];
    args.push(req_file.to_str().unwrap_or("requirements.txt"));

    // 从配置读取镜像源
    let mirror_url = if let Ok(config) = crate::config::get_config() {
        get_default_mirrors()
            .into_iter()
            .find(|m| m.id == config.package.default_mirror)
            .map(|m| m.url)
    } else {
        None
    };
    if let Some(ref url) = mirror_url {
        args.push("-i");
        args.push(url.as_str());
    }

    let output = tokio::process::Command::new(&python)
        .args(&args)
        .output()
        .await?;

    // 清理临时文件
    let _ = std::fs::remove_file(&req_file);

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        return Err(format!("批量安装失败: {}\n{}", stderr, stdout).into());
    }

    crate::app_info!(target: "pyforge_ai::package", "批量安装完成，共 {} 行依赖", requirements.lines().count());
    Ok(stdout)
}

/// 升级指定虚拟环境中的所有过时包。
pub async fn upgrade_all_packages(
    venv_path: &Path,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let python = venv_python_path(venv_path);
    if !python.exists() {
        return Err(format!("虚拟环境中未找到 Python: {}", python.display()).into());
    }

    // 先获取过时包列表
    let outdated_output = tokio::process::Command::new(&python)
        .args(["-m", "pip", "list", "--outdated", "--format=json"])
        .output()
        .await?;

    let outdated: Vec<PipListEntry> = serde_json::from_slice(&outdated_output.stdout)?;
    if outdated.is_empty() {
        return Ok("所有包已是最新版本".to_string());
    }

    let package_names: Vec<&str> = outdated.iter().map(|p| p.name.as_str()).collect();

    let mut args = vec!["-m", "pip", "install", "--upgrade"];
    args.extend(package_names.iter().copied());

    let output = tokio::process::Command::new(&python)
        .args(&args)
        .output()
        .await?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        return Err(format!("批量升级失败: {}\n{}", stderr, stdout).into());
    }

    crate::app_info!(target: "pyforge_ai::package", "批量升级完成，共 {} 个包", outdated.len());
    Ok(stdout)
}

/// 校验并清理包名，防止注入。
fn sanitize_package_name(name: &str) -> String {
    name.chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_' || *c == '.' || *c == '[' || *c == ']')
        .collect()
}

/// 检查包是否已安装。
pub async fn is_package_installed(
    venv_path: &Path,
    package_name: &str,
) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
    let python = venv_python_path(venv_path);
    if !python.exists() {
        return Err(format!("虚拟环境中未找到 Python: {}", python.display()).into());
    }

    let output = tokio::process::Command::new(&python)
        .args(["-m", "pip", "show", package_name])
        .output()
        .await?;

    Ok(output.status.success())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pip_mirror_serializes_required_fields() {
        let mirror = PipMirror {
            id: "tsinghua".to_string(),
            name: "清华大学".to_string(),
            url: "https://pypi.tuna.tsinghua.edu.cn/simple".to_string(),
            latency_ms: 42,
        };
        let json = serde_json::to_string(&mirror).unwrap();
        assert!(json.contains("\"id\":\"tsinghua\""));
        assert!(json.contains("\"name\":\"清华大学\""));
        assert!(json.contains("\"url\":\"https://pypi.tuna.tsinghua.edu.cn/simple\""));
        assert!(json.contains("\"latency_ms\":42"));
    }

    #[test]
    fn get_default_mirrors_returns_non_empty_list() {
        let mirrors = get_default_mirrors();
        assert!(!mirrors.is_empty());
    }

    #[test]
    fn get_default_mirrors_returns_expected_ids() {
        let mirrors = get_default_mirrors();
        let ids: Vec<_> = mirrors.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(ids, vec!["tsinghua", "aliyun", "douban", "tencent", "pypi"]);
        for mirror in &mirrors {
            assert!(mirror.url.starts_with("https://"));
        }
    }

    #[test]
    fn pip_config_candidates_are_non_empty() {
        let candidates = pip_config_candidates();
        assert!(!candidates.is_empty());

        let expected_filename = if std::env::consts::OS == "windows" {
            "pip.ini"
        } else {
            "pip.conf"
        };
        let first = &candidates[0];
        assert_eq!(first.file_name().unwrap(), expected_filename);
    }

    #[test]
    fn pip_config_path_for_write_matches_first_candidate() {
        let path = pip_config_path_for_write().unwrap();
        let candidates = pip_config_candidates();
        assert_eq!(candidates[0], path);
    }
}
