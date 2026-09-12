//! Linux implementation of the platform abstraction layer.

use super::{OsType, PackageManager, PlatformAdapter, PlatformError, PlatformInfo, Shell};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Platform adapter for Linux distributions.
#[derive(Debug, Default)]
pub struct LinuxAdapter;

impl LinuxAdapter {
    /// Create a new Linux adapter.
    pub fn new() -> Self {
        Self
    }

    /// Build a human-readable Linux version string from `/etc/os-release`.
    fn linux_version() -> String {
        if let Ok(contents) = fs::read_to_string("/etc/os-release") {
            let mut name = None;
            let mut version = None;
            for line in contents.lines() {
                if let Some((key, value)) = line.split_once('=') {
                    let value = value.trim().trim_matches('"').to_string();
                    match key {
                        "PRETTY_NAME" => return value,
                        "NAME" => name = Some(value),
                        "VERSION_ID" => version = Some(value),
                        _ => {}
                    }
                }
            }
            if let Some(name) = name {
                if let Some(version) = version {
                    return format!("{} {}", name, version);
                }
                return name;
            }
        }

        // Fallback to `uname -r`.
        match Command::new("uname").arg("-r").output() {
            Ok(output) if output.status.success() => {
                let release = String::from_utf8_lossy(&output.stdout).trim().to_string();
                format!("Linux {}", release)
            }
            _ => "Linux".to_string(),
        }
    }

    /// Detect the dominant package manager from `/etc/os-release`.
    fn detect_package_manager() -> Option<PackageManager> {
        let id = fs::read_to_string("/etc/os-release")
            .unwrap_or_default()
            .lines()
            .find_map(|line| {
                line.strip_prefix("ID=")
                    .map(|s| s.trim().trim_matches('"').to_lowercase())
            });

        match id.as_deref() {
            Some("debian") | Some("ubuntu") | Some("linuxmint") | Some("pop") => {
                Some(PackageManager::Apt)
            }
            Some("fedora") | Some("rhel") | Some("centos") | Some("rocky") | Some("almalinux") => {
                Some(PackageManager::Dnf)
            }
            Some("arch") | Some("manjaro") | Some("endeavouros") => Some(PackageManager::Pacman),
            Some("opensuse") | Some("opensuse-tumbleweed") | Some("sles") => {
                Some(PackageManager::Zypper)
            }
            _ => None,
        }
    }

    /// Return the path to the user's home directory.
    fn home_dir() -> Option<PathBuf> {
        std::env::var("HOME").ok().map(PathBuf::from)
    }
}

impl PlatformAdapter for LinuxAdapter {
    fn detect(&self) -> PlatformInfo {
        PlatformInfo {
            os_type: OsType::Linux,
            os_version: Self::linux_version(),
            architecture: std::env::consts::ARCH.to_string(),
            shell: Shell::Bash,
        }
    }

    fn python_search_paths(&self) -> Vec<PathBuf> {
        let mut paths = Vec::new();

        // System-wide interpreters.
        paths.push(PathBuf::from("/usr/bin"));
        paths.push(PathBuf::from("/usr/local/bin"));
        paths.push(PathBuf::from("/opt/python/bin"));
        // pyenv shims.
        if let Some(home) = Self::home_dir() {
            paths.push(home.join(".pyenv").join("shims"));
            paths.push(home.join(".pyenv").join("bin"));
            paths.push(home.join(".local").join("bin"));
        }

        paths
    }

    fn default_mirror(&self) -> &str {
        "https://pypi.tuna.tsinghua.edu.cn/simple"
    }

    fn shell_config_file(&self) -> Option<PathBuf> {
        Self::home_dir().map(|home| home.join(".bashrc"))
    }

    fn package_manager(&self) -> Option<PackageManager> {
        Self::detect_package_manager()
    }

    fn venv_activation_script(&self, venv_path: &Path) -> String {
        format!(
            "source {}",
            venv_path.join("bin").join("activate").to_string_lossy()
        )
    }

    fn set_default_python(&self, python_path: &Path) -> Result<(), PlatformError> {
        let Some(bin_dir) = python_path.parent().map(Path::to_path_buf) else {
            return Err(PlatformError::Unsupported(
                "python path has no parent directory".to_string(),
            ));
        };

        let Some(config_file) = self.shell_config_file() else {
            return Err(PlatformError::Unsupported(
                "shell configuration file not found".to_string(),
            ));
        };

        let bin_str = bin_dir.to_string_lossy().to_string();
        let export_line = format!(r#"export PATH="{}:$PATH""#, bin_str);

        prepend_to_shell_config(&config_file, &bin_str, &export_line)
    }
}

/// Append (or update) a PATH export at the end of `config_file`.
fn prepend_to_shell_config(
    config_file: &Path,
    bin_dir: &str,
    export_line: &str,
) -> Result<(), PlatformError> {
    if !config_file.exists() {
        fs::write(config_file, format!("{}\n", export_line))?;
        return Ok(());
    }

    let contents = fs::read_to_string(config_file)?;
    if contents.contains(bin_dir) {
        return Ok(());
    }

    fs::write(config_file, format!("{}\n{}", export_line, contents))?;
    Ok(())
}
