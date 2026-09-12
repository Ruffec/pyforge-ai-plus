//! 安全模块
//!
//! 提供路径校验、命令参数消毒、带超时的命令执行等安全功能。
//! 所有公共 API 均预留，供未来模块扩展使用。

#![allow(dead_code)]

use futures::stream::Stream;
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use thiserror::Error;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::process::Command;
use tokio::time::timeout;

#[derive(Debug, Error)]
pub enum SecurityError {
    #[error("Path traversal detected: {0}")]
    PathTraversal(PathBuf),
    #[error("Invalid path: {0}")]
    InvalidPath(PathBuf),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Command failed: {0}")]
    CommandFailed(String),
    #[error("Command timed out after {0:?}")]
    Timeout(Duration),
    #[error("Shell injection detected in argument: {0}")]
    ShellInjection(String),
    #[error("Invalid URL scheme: {0}")]
    InvalidUrlScheme(String),
}

pub type Result<T> = std::result::Result<T, SecurityError>;

/// Captured output from a finished subprocess.
#[derive(Debug, Clone)]
pub struct CommandOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
}

/// Validates that `path` contains no parent directory components and is
/// contained within at least one of `allowed_roots` when provided.
///
/// When `allowed_roots` is empty the function only rejects traversal patterns.
pub fn validate_path(path: &Path, allowed_roots: &[PathBuf]) -> Result<()> {
    let abs = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()?.join(path)
    };

    for component in abs.components() {
        if matches!(component, Component::ParentDir) {
            return Err(SecurityError::PathTraversal(abs));
        }
    }

    if allowed_roots.is_empty() {
        return Ok(());
    }

    for root in allowed_roots {
        let canonical_root = if root.exists() {
            std::fs::canonicalize(root)?
        } else {
            root.to_path_buf()
        };
        let canonical_path = if abs.exists() {
            std::fs::canonicalize(&abs)?
        } else {
            abs.clone()
        };

        if canonical_path.starts_with(&canonical_root) {
            return Ok(());
        }
    }

    Err(SecurityError::PathTraversal(abs))
}

/// Returns a sanitized copy of command arguments, stripping characters commonly
/// used for shell injection.
pub fn sanitize_command_args(args: &[String]) -> Vec<String> {
    args.iter()
        .map(|arg| {
            arg.chars()
                .filter(|&c| {
                    c != ';'
                        && c != '&'
                        && c != '|'
                        && c != '$'
                        && c != '`'
                        && c != '\n'
                        && c != '\r'
                })
                .collect()
        })
        .collect()
}

/// Runs a command with the given arguments, captures stdout/stderr, and enforces
/// a total execution timeout.
pub async fn run_command_with_timeout(
    program: &str,
    args: &[String],
    duration: Duration,
) -> Result<CommandOutput> {
    let args = sanitize_command_args(args);

    let mut child = Command::new(program)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");

    let stdout_handle = tokio::spawn(async move {
        let mut reader = BufReader::new(stdout);
        let mut buf = String::new();
        reader.read_to_string(&mut buf).await.map(|_| buf)
    });

    let stderr_handle = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr);
        let mut buf = String::new();
        reader.read_to_string(&mut buf).await.map(|_| buf)
    });

    let result = timeout(duration, child.wait()).await;
    let status = match result {
        Ok(Ok(status)) => status,
        Ok(Err(e)) => return Err(SecurityError::Io(e)),
        Err(_) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            return Err(SecurityError::Timeout(duration));
        }
    };

    let stdout = stdout_handle
        .await
        .map_err(|e| SecurityError::CommandFailed(format!("stdout reader panicked: {e}")))?
        .map_err(SecurityError::Io)?;
    let stderr = stderr_handle
        .await
        .map_err(|e| SecurityError::CommandFailed(format!("stderr reader panicked: {e}")))?
        .map_err(SecurityError::Io)?;

    Ok(CommandOutput {
        stdout,
        stderr,
        exit_code: status.code(),
    })
}

/// Streams stdout lines from a long-running command.
///
/// The returned stream yields each line as it is produced. If the process exits
/// with a non-zero status, the final item is an error containing the exit code.
pub async fn stream_command(
    program: &str,
    args: &[String],
) -> Result<impl Stream<Item = Result<String>> + Send> {
    let args = sanitize_command_args(args);

    let mut child = Command::new(program)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()?;

    let stdout = child.stdout.take().expect("piped stdout");
    let reader = BufReader::new(stdout).lines();

    let stream = futures::stream::unfold((reader, child), |(mut lines, mut child)| async move {
        match lines.next_line().await {
            Ok(Some(line)) => Some((Ok(line), (lines, child))),
            Ok(None) => match child.wait().await {
                Ok(status) if status.success() => None,
                Ok(status) => Some((
                    Err(SecurityError::CommandFailed(format!(
                        "process exited with code {:?}",
                        status.code()
                    ))),
                    (lines, child),
                )),
                Err(e) => Some((Err(SecurityError::Io(e)), (lines, child))),
            },
            Err(e) => Some((Err(SecurityError::Io(e)), (lines, child))),
        }
    });

    Ok(stream)
}

/// Validates that `url` uses an allowed scheme.
pub fn validate_url_scheme(url: &str, allowed_schemes: &[&str]) -> Result<()> {
    let scheme = url.split_once("://").map(|(s, _)| s.to_lowercase());
    match scheme {
        Some(s) if allowed_schemes.iter().any(|&a| a.eq_ignore_ascii_case(&s)) => Ok(()),
        Some(s) => Err(SecurityError::InvalidUrlScheme(s)),
        None => Err(SecurityError::InvalidUrlScheme("missing".to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn validate_path_accepts_safe_relative() {
        assert!(validate_path(Path::new("src/main.rs"), &[]).is_ok());
        assert!(validate_path(Path::new("foo/bar/baz.txt"), &[]).is_ok());
    }

    #[test]
    fn validate_path_rejects_traversal() {
        assert!(matches!(
            validate_path(Path::new("../foo"), &[]),
            Err(SecurityError::PathTraversal(_))
        ));
        assert!(matches!(
            validate_path(Path::new("foo/../../bar"), &[]),
            Err(SecurityError::PathTraversal(_))
        ));
    }

    #[test]
    fn validate_path_accepts_allowed_root() {
        let root = std::env::current_dir().unwrap();
        assert!(validate_path(&root.join("src"), &[root.clone()]).is_ok());
    }

    #[test]
    fn validate_path_rejects_outside_allowed_root() {
        let root = std::env::current_dir().unwrap();
        let outside = root.parent().unwrap_or(&root);
        assert!(validate_path(outside, &[root]).is_err());
    }

    #[test]
    fn sanitize_command_args_strips_injection_chars() {
        let args = vec![
            "pip".to_string(),
            "install".to_string(),
            "requests; rm -rf /".to_string(),
            "pkg && echo pwned".to_string(),
            "pkg`whoami`".to_string(),
            "pkg$HOME".to_string(),
            "pkg|cat /etc/passwd".to_string(),
        ];
        let sanitized = sanitize_command_args(&args);
        assert_eq!(sanitized[0], "pip");
        assert_eq!(sanitized[2], "requests rm -rf /");
        assert_eq!(sanitized[3], "pkg  echo pwned");
        assert_eq!(sanitized[4], "pkgwhoami");
        assert_eq!(sanitized[5], "pkgHOME");
        assert_eq!(sanitized[6], "pkgcat /etc/passwd");
    }

    #[test]
    fn validate_url_scheme_accepts_allowed() {
        assert!(validate_url_scheme("https://example.com", &["https"]).is_ok());
        assert!(validate_url_scheme("HTTPS://example.com", &["https", "http"]).is_ok());
        assert!(validate_url_scheme("http://example.com", &["http"]).is_ok());
    }

    #[test]
    fn validate_url_scheme_rejects_invalid() {
        assert!(matches!(
            validate_url_scheme("ftp://example.com", &["https", "http"]),
            Err(SecurityError::InvalidUrlScheme(s)) if s == "ftp"
        ));
        assert!(matches!(
            validate_url_scheme("javascript:alert(1)", &["https"]),
            Err(SecurityError::InvalidUrlScheme(s)) if s == "javascript"
        ));
        assert!(matches!(
            validate_url_scheme("file:///etc/passwd", &["https"]),
            Err(SecurityError::InvalidUrlScheme(s)) if s == "file"
        ));
        assert!(matches!(
            validate_url_scheme("not-a-url", &["https"]),
            Err(SecurityError::InvalidUrlScheme(s)) if s == "missing"
        ));
    }

    #[test]
    fn validate_path_accepts_valid_paths_under_allowed_roots() {
        let root = std::env::current_dir().unwrap();
        let child = root.join("src");
        assert!(validate_path(&child, &[root.clone()]).is_ok());
        assert!(validate_path(Path::new("src/main.rs"), &[root.clone()]).is_ok());
    }

    #[test]
    fn validate_path_rejects_parent_directory_references() {
        assert!(matches!(
            validate_path(Path::new("../foo"), &[]),
            Err(SecurityError::PathTraversal(_))
        ));
        assert!(matches!(
            validate_path(Path::new("foo/../../bar"), &[]),
            Err(SecurityError::PathTraversal(_))
        ));
        assert!(matches!(
            validate_path(Path::new("foo/../bar"), &[]),
            Err(SecurityError::PathTraversal(_))
        ));
    }

    #[test]
    fn sanitize_command_args_filters_shell_metacharacters() {
        let args = vec![
            "pip".to_string(),
            "install".to_string(),
            "requests; rm -rf /".to_string(),
            "pkg && echo pwned".to_string(),
            "pkg`whoami`".to_string(),
            "pkg$HOME".to_string(),
            "pkg|cat /etc/passwd".to_string(),
        ];
        let sanitized = sanitize_command_args(&args);
        assert_eq!(sanitized[0], "pip");
        assert_eq!(sanitized[2], "requests rm -rf /");
        assert_eq!(sanitized[3], "pkg  echo pwned");
        assert_eq!(sanitized[4], "pkgwhoami");
        assert_eq!(sanitized[5], "pkgHOME");
        assert_eq!(sanitized[6], "pkgcat /etc/passwd");
    }

    #[test]
    fn validate_url_scheme_allows_https_and_rejects_file_and_javascript() {
        assert!(validate_url_scheme("https://example.com", &["https"]).is_ok());
        assert!(matches!(
            validate_url_scheme("file:///etc/passwd", &["https"]),
            Err(SecurityError::InvalidUrlScheme(s)) if s == "file"
        ));
        assert!(matches!(
            validate_url_scheme("javascript:alert(1)", &["https"]),
            Err(SecurityError::InvalidUrlScheme(s)) if s == "javascript"
        ));
    }
}
