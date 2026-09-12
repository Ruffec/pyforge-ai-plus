//! Platform abstraction layer for cross-platform Python environment management.
//!
//! This module exposes a [`PlatformAdapter`] trait plus per-OS implementations
//! that hide the differences between Windows, macOS, and Linux when detecting
//! Python installations, shell configuration, package managers, and virtual
//! environment activation.
//!
//! All public APIs are reserved for future module expansion.

#![allow(dead_code)]

use serde::Serialize;
use std::path::{Path, PathBuf};
use thiserror::Error;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

/// Errors that can occur while interacting with platform-specific services.
#[derive(Debug, Error)]
pub enum PlatformError {
    /// A generic I/O operation failed.
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    /// An environment variable could not be read.
    #[error("environment variable error: {0}")]
    EnvVar(#[from] std::env::VarError),

    /// A shell command returned a non-zero exit code or could not be executed.
    #[error("command execution error: {0}")]
    Command(String),

    /// A Windows registry operation failed.
    #[cfg(target_os = "windows")]
    #[error("registry error: {0}")]
    Registry(String),

    /// The requested operation is not supported on the current platform.
    #[error("unsupported operation: {0}")]
    Unsupported(String),
}

/// Identifies the operating system family.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum OsType {
    Windows,
    MacOS,
    Linux,
}

/// Identifies a system-level package manager that can install Python itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PackageManager {
    /// Homebrew (macOS and Linux).
    Homebrew,
    /// APT / Debian-based distributions.
    Apt,
    /// DNF / Fedora / RHEL.
    Dnf,
    /// Pacman / Arch Linux.
    Pacman,
    /// Zypper / openSUSE.
    Zypper,
    /// Chocolatey (Windows).
    Chocolatey,
    /// Scoop (Windows).
    Scoop,
    /// Windows Package Manager (winget).
    Winget,
}

/// Identifies the user's preferred shell for config-file modifications.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Shell {
    PowerShell,
    Cmd,
    Bash,
    Zsh,
    Fish,
}

/// Immutable snapshot of the current platform.
#[derive(Debug, Clone, Serialize)]
pub struct PlatformInfo {
    pub os_type: OsType,
    pub os_version: String,
    pub architecture: String,
    pub shell: Shell,
}

/// Cross-platform adapter interface used by the rest of the application.
///
/// All implementations must be thread-safe because the adapter is typically
/// stored as a singleton inside the Tauri application state.
pub trait PlatformAdapter: Send + Sync {
    /// Detect and return a snapshot of the current platform.
    fn detect(&self) -> PlatformInfo;

    /// Return the list of filesystem locations that should be searched for
    /// Python executables, ordered from most-specific to least-specific.
    fn python_search_paths(&self) -> Vec<PathBuf>;

    /// Return the default PyPI-compatible index URL for this platform.
    fn default_mirror(&self) -> &str;

    /// Return the path to the user's shell configuration file, if one can be
    /// determined. `None` means the app should ask the user explicitly.
    fn shell_config_file(&self) -> Option<PathBuf>;

    /// Return the most likely system package manager for installing Python,
    /// or `None` if there is no reliable default.
    fn package_manager(&self) -> Option<PackageManager>;

    /// Return the platform-specific command used to activate a virtual
    /// environment located at `venv_path`.
    fn venv_activation_script(&self, venv_path: &Path) -> String;

    /// Attempt to make `python_path` the default Python interpreter for the
    /// current user (e.g. by modifying PATH in the registry or shell config).
    fn set_default_python(&self, python_path: &Path) -> Result<(), PlatformError>;

    /// Return the concrete adapter type name for diagnostics and tests.
    fn adapter_type_name(&self) -> &'static str {
        std::any::type_name_of_val(self)
    }
}

/// Return the [`PlatformAdapter`] for the current target OS.
///
/// This function uses conditional compilation to select the correct adapter,
/// so only the platform being built is compiled in.
pub fn get_adapter() -> Box<dyn PlatformAdapter> {
    #[cfg(target_os = "windows")]
    {
        Box::new(windows::WindowsAdapter::new())
    }
    #[cfg(target_os = "macos")]
    {
        Box::new(macos::MacAdapter::new())
    }
    #[cfg(target_os = "linux")]
    {
        Box::new(linux::LinuxAdapter::new())
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        compile_error!("unsupported target OS")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn platform_info_serializes_to_lowercase() {
        let info = PlatformInfo {
            os_type: OsType::Linux,
            os_version: "24.04".to_string(),
            architecture: "x86_64".to_string(),
            shell: Shell::Zsh,
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("\"os_type\":\"linux\""));
        assert!(json.contains("\"os_version\":\"24.04\""));
        assert!(json.contains("\"architecture\":\"x86_64\""));
        assert!(json.contains("\"shell\":\"zsh\""));
    }

    #[test]
    fn platform_info_roundtrips_snapshot() {
        let info = PlatformInfo {
            os_type: OsType::Windows,
            os_version: "11".to_string(),
            architecture: "aarch64".to_string(),
            shell: Shell::PowerShell,
        };
        let json = serde_json::to_string(&info).unwrap();
        let expected = r#"{"os_type":"windows","os_version":"11","architecture":"aarch64","shell":"powershell"}"#;
        assert_eq!(json, expected);
    }

    #[cfg(target_os = "windows")]
    mod windows_tests {
        use super::super::windows::WindowsAdapter;
        use super::*;

        #[test]
        fn windows_adapter_default_mirror_contains_tsinghua() {
            let adapter = WindowsAdapter::new();
            let mirror = adapter.default_mirror();
            assert!(mirror.contains("pypi.tuna.tsinghua.edu.cn"));
        }
    }

    #[cfg(target_os = "linux")]
    mod linux_tests {
        use super::super::linux::LinuxAdapter;
        use super::*;

        #[test]
        fn linux_adapter_shell_config_file_ends_with_bashrc_or_zshrc() {
            let adapter = LinuxAdapter::new();
            let config = adapter
                .shell_config_file()
                .expect("shell config file should be determinable");
            let file_name = config
                .file_name()
                .expect("config path should have a file name")
                .to_str()
                .expect("file name should be valid UTF-8");
            assert!(file_name.ends_with(".bashrc") || file_name.ends_with(".zshrc"));
        }
    }

    #[cfg(target_os = "macos")]
    mod macos_tests {
        use super::super::macos::MacAdapter;
        use super::*;

        #[test]
        fn macos_adapter_shell_config_file_ends_with_zshrc() {
            let adapter = MacAdapter::new();
            let config = adapter
                .shell_config_file()
                .expect("shell config file should be determinable");
            let file_name = config
                .file_name()
                .expect("config path should have a file name")
                .to_str()
                .expect("file name should be valid UTF-8");
            assert!(file_name.ends_with(".zshrc"));
        }
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn get_adapter_returns_windows_adapter() {
        let adapter = get_adapter();
        assert!(adapter.adapter_type_name().contains("WindowsAdapter"));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn get_adapter_returns_linux_adapter() {
        let adapter = get_adapter();
        assert!(adapter.adapter_type_name().contains("LinuxAdapter"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn get_adapter_returns_macos_adapter() {
        let adapter = get_adapter();
        assert!(adapter.adapter_type_name().contains("MacAdapter"));
    }
}
