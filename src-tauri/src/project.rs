//! 项目管理模块
//!
//! 提供 Python 项目的扫描、识别、依赖文件解析、环境关联等功能。
//! 支持 requirements.txt、pyproject.toml、setup.py、Pipfile、environment.yml 等
//! 多种依赖描述格式的解析。

use crate::error::{AppError, AppResult, ErrorCode};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// 项目类型。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProjectType {
    /// 标准 Python 项目（requirements.txt）
    Standard,
    /// Poetry 项目（pyproject.toml + poetry）
    Poetry,
    /// PDM 项目（pyproject.toml + pdm）
    Pdm,
    /// Pipenv 项目（Pipfile）
    Pipenv,
    /// Conda 项目（environment.yml）
    Conda,
    /// Setuptools 项目（setup.py / setup.cfg）
    Setuptools,
    /// Flask 项目
    Flask,
    /// Django 项目
    Django,
    /// FastAPI 项目
    FastAPI,
    /// 数据科学项目
    DataScience,
    /// 未知类型
    Unknown,
}

impl ProjectType {
    pub fn display_name(&self) -> &'static str {
        match self {
            ProjectType::Standard => "标准 Python 项目",
            ProjectType::Poetry => "Poetry 项目",
            ProjectType::Pdm => "PDM 项目",
            ProjectType::Pipenv => "Pipenv 项目",
            ProjectType::Conda => "Conda 项目",
            ProjectType::Setuptools => "Setuptools 项目",
            ProjectType::Flask => "Flask 项目",
            ProjectType::Django => "Django 项目",
            ProjectType::FastAPI => "FastAPI 项目",
            ProjectType::DataScience => "数据科学项目",
            ProjectType::Unknown => "未知项目",
        }
    }
}

/// 依赖项。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectDependency {
    /// 包名
    pub name: String,
    /// 版本约束（如 ">=1.0,<2.0"）
    pub version_constraint: String,
    /// 是否为开发依赖
    pub is_dev: bool,
    /// 是否为可选依赖
    pub is_optional: bool,
    /// 来源文件
    pub source: String,
}

/// 项目信息。
#[derive(Debug, Clone, Serialize)]
pub struct ProjectInfo {
    /// 项目名称
    pub name: String,
    /// 项目路径
    pub path: String,
    /// 项目类型
    pub project_type: ProjectType,
    /// Python 版本要求
    pub python_version: Option<String>,
    /// 依赖列表
    pub dependencies: Vec<ProjectDependency>,
    /// 开发依赖列表
    pub dev_dependencies: Vec<ProjectDependency>,
    /// 检测到的依赖文件
    pub dependency_files: Vec<String>,
    /// 关联的虚拟环境路径
    pub associated_venv: Option<String>,
    /// 项目描述
    pub description: Option<String>,
    /// 项目版本
    pub version: Option<String>,
    /// 作者
    pub authors: Vec<String>,
    /// 入口点/脚本
    pub entry_points: Vec<String>,
    /// 是否包含测试
    pub has_tests: bool,
    /// 是否包含 Docker 配置
    pub has_docker: bool,
    /// 是否包含 CI/CD 配置
    pub has_ci: bool,
    /// README 文件路径
    pub readme: Option<String>,
    /// 最后修改时间
    pub last_modified: u64,
}

/// 项目扫描结果。
#[derive(Debug, Clone, Serialize)]
pub struct ProjectScanResult {
    /// 扫描的根目录
    pub root_path: String,
    /// 发现的项目列表
    pub projects: Vec<ProjectInfo>,
    /// 扫描的目录总数
    pub directories_scanned: usize,
    /// 扫描耗时（毫秒）
    pub scan_time_ms: u64,
}

// ============================================================================
// 项目扫描
// ============================================================================

/// 扫描目录下的所有 Python 项目。
pub fn scan_projects(root_path: &Path, max_depth: usize) -> AppResult<ProjectScanResult> {
    let start = std::time::Instant::now();

    if !root_path.exists() || !root_path.is_dir() {
        return Err(AppError::new(
            ErrorCode::ProjectParseError,
            format!("扫描路径不存在或不是目录: {}", root_path.display()),
        ));
    }

    let mut projects = Vec::new();
    let mut dirs_scanned = 0usize;
    let mut visited = HashSet::new();

    scan_directory(root_path, max_depth, 0, &mut projects, &mut dirs_scanned, &mut visited)?;

    let scan_time_ms = start.elapsed().as_millis() as u64;

    Ok(ProjectScanResult {
        root_path: root_path.to_string_lossy().to_string(),
        projects,
        directories_scanned: dirs_scanned,
        scan_time_ms,
    })
}

fn scan_directory(
    path: &Path,
    max_depth: usize,
    current_depth: usize,
    projects: &mut Vec<ProjectInfo>,
    dirs_scanned: &mut usize,
    visited: &mut HashSet<PathBuf>,
) -> AppResult<()> {
    if current_depth > max_depth {
        return Ok(());
    }

    let canonical = match std::fs::canonicalize(path) {
        Ok(p) => p,
        Err(_) => return Ok(()),
    };

    if !visited.insert(canonical.clone()) {
        return Ok(());
    }

    *dirs_scanned += 1;

    // 检查当前目录是否是 Python 项目
    if let Some(project) = detect_project(path)? {
        projects.push(project);
        // 找到项目后不再深入扫描其子目录（避免重复）
        return Ok(());
    }

    // 递归扫描子目录
    if current_depth < max_depth {
        if let Ok(entries) = std::fs::read_dir(path) {
            for entry in entries.flatten() {
                let entry_path = entry.path();
                if entry_path.is_dir() {
                    // 跳过常见的非项目目录
                    let name = entry.file_name().to_string_lossy().to_lowercase();
                    if should_skip_dir(&name) {
                        continue;
                    }
                    scan_directory(
                        &entry_path,
                        max_depth,
                        current_depth + 1,
                        projects,
                        dirs_scanned,
                        visited,
                    )?;
                }
            }
        }
    }

    Ok(())
}

fn should_skip_dir(name: &str) -> bool {
    matches!(
        name,
        "node_modules"
            | ".git"
            | ".svn"
            | "__pycache__"
            | ".pytest_cache"
            | ".mypy_cache"
            | ".tox"
            | "venv"
            | ".venv"
            | "env"
            | ".env"
            | "dist"
            | "build"
            | "target"
            | ".idea"
            | ".vscode"
    )
}

/// 检测指定目录是否为 Python 项目。
pub fn detect_project(path: &Path) -> AppResult<Option<ProjectInfo>> {
    if !path.is_dir() {
        return Ok(None);
    }

    let mut dependency_files = Vec::new();
    let mut project_type = ProjectType::Unknown;
    let mut python_version = None;
    let mut description = None;
    let mut version = None;
    let authors = Vec::new();
    let entry_points = Vec::new();
    let mut readme = None;
    let mut has_tests = false;
    let mut has_docker = false;
    let mut has_ci = false;

    // 检查常见项目文件
    let files: Vec<_> = match std::fs::read_dir(path) {
        Ok(entries) => entries
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect(),
        Err(_) => return Ok(None),
    };

    for file in &files {
        let lower = file.to_lowercase();
        match lower.as_str() {
            "requirements.txt" | "requirements-dev.txt" | "requirements-prod.txt" => {
                dependency_files.push(file.clone());
                if project_type == ProjectType::Unknown {
                    project_type = ProjectType::Standard;
                }
            }
            "pyproject.toml" => {
                dependency_files.push(file.clone());
                // 解析 pyproject.toml 确定具体类型
                if let Ok(content) = std::fs::read_to_string(path.join(file)) {
                    if content.contains("[tool.poetry]") {
                        project_type = ProjectType::Poetry;
                    } else if content.contains("[tool.pdm]") {
                        project_type = ProjectType::Pdm;
                    } else if project_type == ProjectType::Unknown {
                        project_type = ProjectType::Standard;
                    }

                    // 解析项目元数据
                    if let Some(name) = extract_toml_value(&content, "name") {
                        description = Some(name);
                    }
                    if let Some(v) = extract_toml_value(&content, "version") {
                        version = Some(v);
                    }
                    if let Some(pv) = extract_toml_value(&content, "requires-python") {
                        python_version = Some(pv);
                    }
                    if let Some(desc) = extract_toml_value(&content, "description") {
                        description = Some(desc);
                    }
                }
            }
            "pipfile" | "pipfile.lock" => {
                dependency_files.push(file.clone());
                project_type = ProjectType::Pipenv;
            }
            "environment.yml" | "environment.yaml" => {
                dependency_files.push(file.clone());
                project_type = ProjectType::Conda;
            }
            "setup.py" | "setup.cfg" => {
                dependency_files.push(file.clone());
                if project_type == ProjectType::Unknown {
                    project_type = ProjectType::Setuptools;
                }
            }
            "manage.py" => {
                project_type = ProjectType::Django;
            }
            "app.py" | "wsgi.py" => {
                if project_type == ProjectType::Unknown {
                    project_type = ProjectType::Flask;
                }
            }
            "main.py" => {
                if let Ok(content) = std::fs::read_to_string(path.join(file)) {
                    if content.contains("FastAPI") || content.contains("fastapi") {
                        project_type = ProjectType::FastAPI;
                    }
                }
            }
            "dockerfile" | "docker-compose.yml" | "docker-compose.yaml" => {
                has_docker = true;
            }
            "readme.md" | "readme.rst" | "readme.txt" => {
                readme = Some(file.clone());
            }
            _ => {}
        }
    }

    // 检查测试目录
    if path.join("tests").is_dir() || path.join("test").is_dir() {
        has_tests = true;
    }

    // 检查 CI 配置
    if path.join(".github").join("workflows").is_dir()
        || path.join(".gitlab-ci.yml").exists()
        || path.join("Jenkinsfile").exists()
        || path.join(".circleci").is_dir()
    {
        has_ci = true;
    }

    // 检查数据科学特征
    if project_type == ProjectType::Standard || project_type == ProjectType::Unknown {
        if let Ok(content) = std::fs::read_to_string(path.join("requirements.txt")) {
            if content.contains("numpy") || content.contains("pandas") || content.contains("scikit-learn")
            {
                project_type = ProjectType::DataScience;
            }
        }
    }

    // 如果没有找到任何 Python 项目特征，返回 None
    if dependency_files.is_empty() && project_type == ProjectType::Unknown {
        return Ok(None);
    }

    // 解析依赖
    let (dependencies, dev_dependencies) = parse_all_dependencies(path, &dependency_files)?;

    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    let last_modified = std::fs::metadata(path)
        .and_then(|m| m.modified())
        .map(|t| t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs())
        .unwrap_or(0);

    // 检查关联的虚拟环境
    let associated_venv = find_associated_venv(path);

    Ok(Some(ProjectInfo {
        name,
        path: path.to_string_lossy().to_string(),
        project_type,
        python_version,
        dependencies,
        dev_dependencies,
        dependency_files,
        associated_venv,
        description,
        version,
        authors,
        entry_points,
        has_tests,
        has_docker,
        has_ci,
        readme,
        last_modified,
    }))
}

fn find_associated_venv(project_path: &Path) -> Option<String> {
    let candidates = [
        project_path.join(".venv"),
        project_path.join("venv"),
        project_path.join("env"),
        project_path.join(".env"),
    ];

    for candidate in &candidates {
        if candidate.is_dir() {
            let py_exec = if cfg!(target_os = "windows") {
                candidate.join("Scripts").join("python.exe")
            } else {
                candidate.join("bin").join("python")
            };
            if py_exec.exists() {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
    }
    None
}

// ============================================================================
// 依赖解析
// ============================================================================

fn parse_all_dependencies(
    path: &Path,
    files: &[String],
) -> AppResult<(Vec<ProjectDependency>, Vec<ProjectDependency>)> {
    let mut dependencies = Vec::new();
    let mut dev_dependencies = Vec::new();

    for file in files {
        let lower = file.to_lowercase();
        let file_path = path.join(file);

        match lower.as_str() {
            "requirements.txt" => {
                if let Ok(deps) = parse_requirements_txt(&file_path, false) {
                    dependencies.extend(deps);
                }
            }
            "requirements-dev.txt" | "requirements-test.txt" => {
                if let Ok(deps) = parse_requirements_txt(&file_path, true) {
                    dev_dependencies.extend(deps);
                }
            }
            "pyproject.toml" => {
                if let Ok(content) = std::fs::read_to_string(&file_path) {
                    let (deps, dev) = parse_pyproject_toml(&content, &file);
                    dependencies.extend(deps);
                    dev_dependencies.extend(dev);
                }
            }
            "pipfile" => {
                if let Ok(content) = std::fs::read_to_string(&file_path) {
                    let (deps, dev) = parse_pipfile(&content, &file);
                    dependencies.extend(deps);
                    dev_dependencies.extend(dev);
                }
            }
            _ => {}
        }
    }

    // 去重
    let mut seen = HashSet::new();
    dependencies.retain(|d| seen.insert(d.name.to_lowercase()));
    seen.clear();
    dev_dependencies.retain(|d| seen.insert(d.name.to_lowercase()));

    Ok((dependencies, dev_dependencies))
}

/// 解析 requirements.txt 文件。
pub fn parse_requirements_txt(path: &Path, is_dev: bool) -> AppResult<Vec<ProjectDependency>> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| AppError::new(ErrorCode::ProjectParseError, format!("读取 requirements.txt 失败: {e}")))?;

    let source = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("requirements.txt")
        .to_string();

    let mut deps = Vec::new();

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with('-') {
            continue;
        }

        // 解析包名和版本约束
        let (name, constraint) = parse_package_spec(line);
        if !name.is_empty() {
            deps.push(ProjectDependency {
                name,
                version_constraint: constraint,
                is_dev,
                is_optional: false,
                source: source.clone(),
            });
        }
    }

    Ok(deps)
}

fn parse_package_spec(spec: &str) -> (String, String) {
    let spec = spec.trim();
    // 处理常见的版本约束符
    let operators = ["==", ">=", "<=", "!=", "~=", ">", "<"];

    for op in &operators {
        if let Some(idx) = spec.find(op) {
            let name = spec[..idx].trim().to_string();
            let constraint = spec[idx..].trim().to_string();
            return (name, constraint);
        }
    }

    (spec.to_string(), String::new())
}

fn parse_pyproject_toml(content: &str, source: &str) -> (Vec<ProjectDependency>, Vec<ProjectDependency>) {
    let mut dependencies = Vec::new();
    let mut dev_dependencies = Vec::new();

    // 简单解析 [project] dependencies
    if let Some(deps_section) = extract_toml_array(content, "dependencies") {
        for dep in deps_section {
            let (name, constraint) = parse_package_spec(&dep);
            if !name.is_empty() {
                dependencies.push(ProjectDependency {
                    name,
                    version_constraint: constraint,
                    is_dev: false,
                    is_optional: false,
                    source: source.to_string(),
                });
            }
        }
    }

    // 解析 [tool.poetry.dev-dependencies] 或 [project.optional-dependencies]
    if let Some(dev_section) = extract_toml_table(content, "dev-dependencies") {
        for (name, constraint) in dev_section {
            dev_dependencies.push(ProjectDependency {
                name,
                version_constraint: constraint,
                is_dev: true,
                is_optional: false,
                source: source.to_string(),
            });
        }
    }

    (dependencies, dev_dependencies)
}

fn parse_pipfile(content: &str, source: &str) -> (Vec<ProjectDependency>, Vec<ProjectDependency>) {
    let mut dependencies = Vec::new();
    let mut dev_dependencies = Vec::new();

    // 简单解析 [packages] 和 [dev-packages]
    if let Some(packages) = extract_toml_table(content, "packages") {
        for (name, constraint) in packages {
            let constraint = if constraint == "*" { String::new() } else { constraint };
            dependencies.push(ProjectDependency {
                name,
                version_constraint: constraint,
                is_dev: false,
                is_optional: false,
                source: source.to_string(),
            });
        }
    }

    if let Some(dev_packages) = extract_toml_table(content, "dev-packages") {
        for (name, constraint) in dev_packages {
            let constraint = if constraint == "*" { String::new() } else { constraint };
            dev_dependencies.push(ProjectDependency {
                name,
                version_constraint: constraint,
                is_dev: true,
                is_optional: false,
                source: source.to_string(),
            });
        }
    }

    (dependencies, dev_dependencies)
}

// ============================================================================
// TOML 简易解析辅助函数
// ============================================================================

fn extract_toml_value(content: &str, key: &str) -> Option<String> {
    for line in content.lines() {
        let line = line.trim();
        if let Some(idx) = line.find('=') {
            let k = line[..idx].trim();
            if k == key {
                let v = line[idx + 1..].trim().trim_matches('"').trim_matches('\'');
                return Some(v.to_string());
            }
        }
    }
    None
}

fn extract_toml_array(content: &str, key: &str) -> Option<Vec<String>> {
    let mut in_array = false;
    let mut values = Vec::new();
    let mut current = String::new();

    for line in content.lines() {
        let line = line.trim();
        if !in_array {
            if line.starts_with(&format!("{} = [", key)) {
                in_array = true;
                let rest = line.trim_start_matches(&format!("{} = [", key));
                current.push_str(rest);
                if current.contains(']') {
                    // 单行数组
                    let content_str = current.trim_end_matches(']');
                    for item in content_str.split(',') {
                        let item = item.trim().trim_matches('"').trim_matches('\'');
                        if !item.is_empty() {
                            values.push(item.to_string());
                        }
                    }
                    return Some(values);
                }
            }
        } else {
            current.push_str(line);
            if line.contains(']') {
                let content_str = current.trim_end_matches(']');
                for item in content_str.split(',') {
                    let item = item.trim().trim_matches('"').trim_matches('\'');
                    if !item.is_empty() {
                        values.push(item.to_string());
                    }
                }
                return Some(values);
            }
        }
    }

    if values.is_empty() {
        None
    } else {
        Some(values)
    }
}

fn extract_toml_table(content: &str, table_name: &str) -> Option<Vec<(String, String)>> {
    let mut in_table = false;
    let mut entries = Vec::new();

    for line in content.lines() {
        let line = line.trim();
        if line.starts_with('[') && line.ends_with(']') {
            let table = line[1..line.len() - 1].trim();
            in_table = table.ends_with(&format!(".{}", table_name)) || table == table_name;
            continue;
        }

        if in_table {
            if let Some(idx) = line.find('=') {
                let key = line[..idx].trim().to_string();
                let value = line[idx + 1..].trim().trim_matches('"').trim_matches('\'').to_string();
                entries.push((key, value));
            }
        }
    }

    if entries.is_empty() {
        None
    } else {
        Some(entries)
    }
}

// ============================================================================
// 项目操作
// ============================================================================

/// 为项目创建关联的虚拟环境。
pub fn create_project_venv(
    project_path: &Path,
    python_path: &Path,
    venv_name: Option<&str>,
) -> AppResult<crate::venv::VirtualEnvironment> {
    let name = venv_name.unwrap_or(".venv");
    let target = project_path.to_path_buf();

    crate::venv::create_venv(name, python_path, &target)
        .map_err(|e| AppError::new(ErrorCode::VenvAlreadyExists, e.to_string()))
}

/// 为项目安装依赖（从项目的依赖文件）。
pub async fn install_project_dependencies(
    project_path: &Path,
    venv_path: &Path,
) -> AppResult<String> {
    let project = detect_project(project_path)?
        .ok_or_else(|| AppError::new(ErrorCode::ProjectParseError, "未检测到 Python 项目"))?;

    if project.dependency_files.is_empty() {
        return Err(AppError::new(
            ErrorCode::ProjectParseError,
            "项目未找到依赖文件",
        ));
    }

    // 优先使用 requirements.txt
    let req_file = project
        .dependency_files
        .iter()
        .find(|f| f.to_lowercase() == "requirements.txt")
        .or_else(|| project.dependency_files.first())
        .ok_or_else(|| AppError::new(ErrorCode::ProjectParseError, "未找到可用的依赖文件"))?;

    let req_path = project_path.join(req_file);
    let requirements = std::fs::read_to_string(&req_path)
        .map_err(|e| AppError::new(ErrorCode::IoError, format!("读取依赖文件失败: {e}")))?;

    crate::package::install_from_requirements(venv_path, &requirements)
        .await
        .map_err(|e| AppError::new(ErrorCode::PackageInstallFailed, e.to_string()))
}

/// 导出项目的依赖为 requirements.txt 格式。
pub fn export_project_requirements(project_path: &Path) -> AppResult<String> {
    let project = detect_project(project_path)?
        .ok_or_else(|| AppError::new(ErrorCode::ProjectParseError, "未检测到 Python 项目"))?;

    let mut output = String::new();
    output.push_str(&format!("# 项目: {}\n", project.name));
    output.push_str(&format!("# 类型: {}\n", project.project_type.display_name()));
    if let Some(pv) = &project.python_version {
        output.push_str(&format!("# Python 版本要求: {}\n", pv));
    }
    output.push_str("# 由 PyForge AI 自动生成\n\n");

    output.push_str("# === 生产依赖 ===\n");
    for dep in &project.dependencies {
        if dep.version_constraint.is_empty() {
            output.push_str(&format!("{}\n", dep.name));
        } else {
            output.push_str(&format!("{}{}\n", dep.name, dep.version_constraint));
        }
    }

    if !project.dev_dependencies.is_empty() {
        output.push_str("\n# === 开发依赖 ===\n");
        for dep in &project.dev_dependencies {
            if dep.version_constraint.is_empty() {
                output.push_str(&format!("# {}\n", dep.name));
            } else {
                output.push_str(&format!("# {}{}\n", dep.name, dep.version_constraint));
            }
        }
    }

    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_package_spec_with_equality() {
        let (name, constraint) = parse_package_spec("requests==2.28.0");
        assert_eq!(name, "requests");
        assert_eq!(constraint, "==2.28.0");
    }

    #[test]
    fn parse_package_spec_with_range() {
        let (name, constraint) = parse_package_spec("django>=3.2,<4.0");
        assert_eq!(name, "django");
        assert_eq!(constraint, ">=3.2,<4.0");
    }

    #[test]
    fn parse_package_spec_without_version() {
        let (name, constraint) = parse_package_spec("flask");
        assert_eq!(name, "flask");
        assert!(constraint.is_empty());
    }

    #[test]
    fn project_type_display_names_are_chinese() {
        assert_eq!(ProjectType::Standard.display_name(), "标准 Python 项目");
        assert_eq!(ProjectType::Poetry.display_name(), "Poetry 项目");
        assert_eq!(ProjectType::Django.display_name(), "Django 项目");
        assert_eq!(ProjectType::Unknown.display_name(), "未知项目");
    }

    #[test]
    fn should_skip_dir_skips_common_dirs() {
        assert!(should_skip_dir("node_modules"));
        assert!(should_skip_dir(".git"));
        assert!(should_skip_dir("__pycache__"));
        assert!(should_skip_dir("venv"));
        assert!(!should_skip_dir("src"));
        assert!(!should_skip_dir("myproject"));
    }

    #[test]
    fn extract_toml_value_finds_simple_key() {
        let content = r#"
[project]
name = "my-project"
version = "1.0.0"
description = "A test project"
"#;
        assert_eq!(extract_toml_value(content, "name"), Some("my-project".to_string()));
        assert_eq!(extract_toml_value(content, "version"), Some("1.0.0".to_string()));
        assert_eq!(extract_toml_value(content, "nonexistent"), None);
    }
}
