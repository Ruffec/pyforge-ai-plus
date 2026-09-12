//! macOS implementation of the platform abstraction layer.

use super::{OsType, PackageManager, PlatformAdapter, PlatformError, PlatformInfo, Shell};
use std::path::{Path, PathBuf};
use std::process::Command;

/// Platform adapter for Apple macOS.
#[derive(Debug, Default)]
pub struct MacAdapter;

impl MacAdapter {
    /// Create a new macOS adapter.
    pub fn new() -> Self {
        Self
    }

    /// Read the macOS product version using `sw_vers`.
    fn macos_version() -> String {
        match Command::new("sw_vers").arg("-productVersion").output() {
            Ok(output) if output.status.success() => {
                let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
                format!("macOS {}", version)
            }
            _ => "macOS".to_string(),
        }
    }

    /// Return the path to the user's home directory.
    fn home_dir() -> Option<PathBuf> {
        std::env::var("HOME").ok().map(PathBuf::from)
    }
}

impl PlatformAdapter for MacAdapter {
    fn detect(&self) -> PlatformInfo {
        PlatformInfo {
            os_type: OsType::MacOS,
            os_version: Self::macos_version(),
            architecture: std::env::consts::ARCH.to_string(),
            shell: Shell::Zsh,
        }
    }

    fn python_search_paths(&self) -> Vec<PathBuf> {
        let mut paths = Vec::new();

        // Homebrew on Apple Silicon.
        paths.push(PathBuf::from("/opt/homebrew/bin"));
        // Homebrew on Intel Macs.
        paths.push(PathBuf::from("/usr/local/bin"));
        // System Python.
        paths.push(PathBuf::from("/usr/bin"));
        // User site packages scripts.
        if let Some(home) = Self::home_dir() {
            paths.push(home.join("Library").join("Python").join("3.11").join("bin"));
            paths.push(home.join("Library").join("Python").join("3.12").join("bin"));
            paths.push(home.join("Library").join("Python").join("3.13").join("bin"));
            paths.push(home.join(".local").join("bin"));
        }

        paths
    }

    fn default_mirror(&self) -> &str {
        "https://pypi.tuna.tsinghua.edu.cn/simple"
    }

    fn shell_config_file(&self) -> Option<PathBuf> {
        Self::home_dir().map(|home| home.join(".zshrc"))
    }

    fn package_manager(&self) -> Option<PackageManager> {
        Some(PackageManager::Homebrew)
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
    use std::fs;

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
