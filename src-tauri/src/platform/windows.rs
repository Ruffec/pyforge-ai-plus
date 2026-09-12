//! Windows implementation of the platform abstraction layer.
//!
//! All public APIs are reserved for future module expansion.

#![allow(dead_code)]

use super::{OsType, PackageManager, PlatformAdapter, PlatformError, PlatformInfo, Shell};
use std::path::{Path, PathBuf};
use winreg::enums::{KEY_READ, KEY_WRITE};
use winreg::RegKey;

/// Platform adapter for Microsoft Windows.
#[derive(Debug, Default)]
pub struct WindowsAdapter;

impl WindowsAdapter {
    /// Create a new Windows adapter.
    pub fn new() -> Self {
        Self
    }

    /// Read the Windows display/version string from the registry.
    fn windows_version() -> String {
        let hklm = RegKey::predef(winreg::enums::HKEY_LOCAL_MACHINE);
        let key = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion";
        let Ok(subkey) = hklm.open_subkey_with_flags(key, KEY_READ) else {
            return "Windows".to_string();
        };

        // Prefer DisplayVersion (e.g. "22H2"), fall back to ReleaseId, then
        // the major/minor build numbers.
        if let Ok(display_version) = subkey.get_value::<String, _>("DisplayVersion") {
            if !display_version.is_empty() {
                return format!("Windows {}", display_version);
            }
        }
        if let Ok(release_id) = subkey.get_value::<String, _>("ReleaseId") {
            if !release_id.is_empty() {
                return format!("Windows {}", release_id);
            }
        }

        let major: u32 = subkey.get_value("CurrentMajorVersionNumber").unwrap_or(0);
        let minor: u32 = subkey.get_value("CurrentMinorVersionNumber").unwrap_or(0);
        let build: String = subkey.get_value("CurrentBuildNumber").unwrap_or_default();

        if major > 0 {
            format!("Windows {}.{}.{}", major, minor, build)
        } else {
            "Windows".to_string()
        }
    }

    /// Return the path to the user's PowerShell profile directory.
    fn powershell_profile_dir() -> Option<PathBuf> {
        // Prefer PowerShell 7+ location; fall back to Windows PowerShell 5.
        let user_profile = std::env::var("USERPROFILE").ok()?;
        let docs = PathBuf::from(user_profile).join("Documents");
        let ps7 = docs.join("PowerShell");
        if ps7.exists() {
            return Some(ps7);
        }
        Some(docs.join("WindowsPowerShell"))
    }
}

impl PlatformAdapter for WindowsAdapter {
    fn detect(&self) -> PlatformInfo {
        PlatformInfo {
            os_type: OsType::Windows,
            os_version: Self::windows_version(),
            architecture: std::env::consts::ARCH.to_string(),
            shell: Shell::PowerShell,
        }
    }

    fn python_search_paths(&self) -> Vec<PathBuf> {
        let mut paths = Vec::new();

        // Per-user Python.org installers.
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            paths.push(
                PathBuf::from(local_app_data)
                    .join("Programs")
                    .join("Python"),
            );
        }

        // System-wide C:\Python* directories.
        paths.push(PathBuf::from("C:\\Python310"));
        paths.push(PathBuf::from("C:\\Python311"));
        paths.push(PathBuf::from("C:\\Python312"));
        paths.push(PathBuf::from("C:\\Python313"));
        paths.push(PathBuf::from("C:\\Python39"));

        // Registry-based Python.org installations.
        let hives = [
            (
                winreg::enums::HKEY_LOCAL_MACHINE,
                r"SOFTWARE\Python\PythonCore",
            ),
            (
                winreg::enums::HKEY_LOCAL_MACHINE,
                r"SOFTWARE\WOW6432Node\Python\PythonCore",
            ),
            (
                winreg::enums::HKEY_CURRENT_USER,
                r"SOFTWARE\Python\PythonCore",
            ),
        ];

        for (hive, key_path) in hives {
            let hive_key = RegKey::predef(hive);
            if let Ok(core) = hive_key.open_subkey_with_flags(key_path, KEY_READ) {
                for version_key_name in core.enum_keys().filter_map(|r| r.ok()) {
                    let install_path_key =
                        format!("{}\\{}\\InstallPath", key_path, version_key_name);
                    if let Ok(install_key) =
                        hive_key.open_subkey_with_flags(&install_path_key, KEY_READ)
                    {
                        if let Ok(path) = install_key.get_value::<String, _>("") {
                            if !path.is_empty() {
                                paths.push(PathBuf::from(path));
                            }
                        }
                    }
                }
            }
        }

        paths
    }

    fn default_mirror(&self) -> &str {
        "https://pypi.tuna.tsinghua.edu.cn/simple"
    }

    fn shell_config_file(&self) -> Option<PathBuf> {
        Self::powershell_profile_dir().map(|dir| dir.join("Microsoft.PowerShell_profile.ps1"))
    }

    fn package_manager(&self) -> Option<PackageManager> {
        // No universally-preinstalled Windows package manager; leave it to the user.
        None
    }

    fn venv_activation_script(&self, venv_path: &Path) -> String {
        venv_path
            .join("Scripts")
            .join("Activate.ps1")
            .to_string_lossy()
            .to_string()
    }

    fn set_default_python(&self, python_path: &Path) -> Result<(), PlatformError> {
        let Some(bin_dir) = python_path.parent().map(Path::to_path_buf) else {
            return Err(PlatformError::Unsupported(
                "python path has no parent directory".to_string(),
            ));
        };

        let hkcu = RegKey::predef(winreg::enums::HKEY_CURRENT_USER);
        let env = hkcu
            .open_subkey_with_flags("Environment", KEY_READ | KEY_WRITE)
            .map_err(|e| PlatformError::Registry(e.to_string()))?;

        let current_path: String = env
            .get_value("Path")
            .map_err(|e| PlatformError::Registry(e.to_string()))?;

        let bin_str = bin_dir.to_string_lossy().to_string();

        // Avoid duplicates.
        let segments: Vec<&str> = current_path.split(';').collect();
        if segments.iter().any(|s| s.eq_ignore_ascii_case(&bin_str)) {
            return Ok(());
        }

        let new_path = format!("{};{}", bin_str, current_path);
        env.set_value("Path", &new_path)
            .map_err(|e| PlatformError::Registry(e.to_string()))?;

        Ok(())
    }
}
