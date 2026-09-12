/**
 * PyForge AI 统一类型定义
 *
 * 包含所有后端命令的请求/响应类型，以及前端状态管理类型。
 */

// ============================================================================
// 通用类型
// ============================================================================

/** 统一错误响应 */
export interface AppError {
  code: string;
  message: string;
  status_code: number;
}

/** 任务状态 */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/** 任务信息 */
export interface TaskInfo {
  id: string;
  task_type: string;
  status: TaskStatus;
  progress: number;
  message: string;
  created_at: number;
  updated_at: number;
}

/** 任务进度事件 */
export interface TaskProgressEvent {
  task_id: string;
  task_type: string;
  status: TaskStatus;
  progress: number;
  message: string;
  data?: Record<string, unknown>;
  error?: string;
  timestamp: number;
}

/** 系统通知 */
export interface NotificationEvent {
  id: string;
  title: string;
  message: string;
  notification_type: 'success' | 'error' | 'warning' | 'info';
  timestamp: number;
}

// ============================================================================
// 应用配置类型
// ============================================================================

export interface AppConfig {
  version: string;
  general: GeneralConfig;
  python: PythonConfig;
  venv: VenvConfig;
  package: PackageConfig;
  ai: AiConfig;
  logging: LoggingConfig;
  ui: UiConfig;
}

export interface GeneralConfig {
  auto_check_updates: boolean;
  telemetry_enabled: boolean;
  language: string;
  recent_projects: string[];
}

export interface PythonConfig {
  preferred_version: string | null;
  extra_search_paths: string[];
  scan_system_path: boolean;
  scan_pyenv: boolean;
  scan_cache_ttl: number;
}

export interface VenvConfig {
  default_root: string;
  auto_upgrade_pip: boolean;
  default_packages: string[];
  confirm_before_remove: boolean;
}

export interface PackageConfig {
  default_mirror: string;
  use_cache: boolean;
  concurrent_downloads: number;
  network_timeout: number;
  check_conflicts: boolean;
}

export interface AiConfig {
  provider: string;
  api_key: string;
  model: string;
  base_url: string | null;
  temperature: number;
  max_tokens: number;
  use_local_llm: boolean;
  local_llm_endpoint: string | null;
  persist_chat_history: boolean;
  auto_execute_deployment: boolean;
}

export interface LoggingConfig {
  level: string;
  max_file_size_mb: number;
  max_files: number;
  console_output: boolean;
}

export interface UiConfig {
  theme: 'light' | 'dark' | 'system';
  accent_color: string;
  font_size: 'small' | 'medium' | 'large';
  sidebar_collapsed: boolean;
}

// ============================================================================
// Python 版本管理类型
// ============================================================================

export interface PythonVersionInfo {
  id: string;
  version: string;
  path: string;
  is_active: boolean;
  pip_version?: string;
  packages_count?: number;
  architecture?: string;
}

export interface PythonHealthCheck {
  path: string;
  is_executable: boolean;
  version_valid: boolean;
  pip_available: boolean;
  pip_version?: string;
  stdlib_working: boolean;
  site_packages_writable: boolean;
  healthy: boolean;
  issues: string[];
}

export interface PythonEnvInfo {
  python_path: string | null;
  python_home: string | null;
  virtual_env: string | null;
  path_python_entries: string[];
}

export interface CompatibilityCheck {
  package_name: string;
  required_version: string;
  current_version: string;
  compatible: boolean;
  reason: string;
}

// ============================================================================
// 虚拟环境管理类型
// ============================================================================

export interface VirtualEnvironment {
  id: string;
  name: string;
  python_version: string;
  path: string;
  size_bytes: number;
  packages_count: number;
  status: string;
  created_at: number;
}

export interface Dependency {
  name: string;
  version: string;
}

export interface DependencyNode {
  name: string;
  version: string;
  children: DependencyNode[];
}

export interface VenvValidationResult {
  path: string;
  valid: boolean;
  python_exists: boolean;
  pip_available: boolean;
  config_valid: boolean;
  site_packages_exists: boolean;
  issues: string[];
}

export interface VenvRepairResult {
  success: boolean;
  actions: string[];
  output: string;
  remaining_issues: string[];
}

export interface VenvSnapshot {
  id: string;
  venv_name: string;
  venv_path: string;
  python_version: string;
  created_at: number;
  requirements: string;
  packages_count: number;
  description?: string;
}

export interface VenvDiskUsage {
  total_bytes: number;
  total_mb: number;
  breakdown: Record<string, number>;
}

// ============================================================================
// 包与镜像源管理类型
// ============================================================================

export interface PipMirror {
  id: string;
  name: string;
  url: string;
  latency_ms: number;
}

export interface PackageInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  latest_version: string;
}

export interface InstalledPackage {
  name: string;
  version: string;
  latest_version: string;
  size: number;
}

// ============================================================================
// 项目管理类型
// ============================================================================

export type ProjectType =
  | 'standard'
  | 'poetry'
  | 'pdm'
  | 'pipenv'
  | 'conda'
  | 'setuptools'
  | 'flask'
  | 'django'
  | 'fastapi'
  | 'data_science'
  | 'unknown';

export interface ProjectDependency {
  name: string;
  version_constraint: string;
  is_dev: boolean;
  is_optional: boolean;
  source: string;
}

export interface ProjectInfo {
  name: string;
  path: string;
  project_type: ProjectType;
  python_version: string | null;
  dependencies: ProjectDependency[];
  dev_dependencies: ProjectDependency[];
  dependency_files: string[];
  associated_venv: string | null;
  description: string | null;
  version: string | null;
  authors: string[];
  entry_points: string[];
  has_tests: boolean;
  has_docker: boolean;
  has_ci: boolean;
  readme: string | null;
  last_modified: number;
}

export interface ProjectScanResult {
  root_path: string;
  projects: ProjectInfo[];
  directories_scanned: number;
  scan_time_ms: number;
}

// ============================================================================
// AI 部署类型
// ============================================================================

export interface DeploymentRequest {
  user_input: string;
  project_path?: string;
}

export interface DeploymentPlan {
  python_version: string;
  dependencies: DependencyRecommendation[];
  commands: string[];
  steps: DeploymentStep[];
  explanation: string;
}

export interface DependencyRecommendation {
  name: string;
  version_constraint: string;
  reason: string;
}

export interface DeploymentStep {
  title: string;
  status: string;
  output?: string;
}

export interface DependencyConflict {
  package_a: string;
  package_b: string;
  reason: string;
  suggestion: string;
}

export interface ChatMessage {
  role: string;
  content: string;
}

// ============================================================================
// 平台信息类型
// ============================================================================

export type OsType = 'windows' | 'macos' | 'linux';
export type ShellType = 'powershell' | 'cmd' | 'bash' | 'zsh' | 'fish';

export interface PlatformInfo {
  os_type: OsType;
  os_version: string;
  architecture: string;
  shell: ShellType;
}

// ============================================================================
// 应用信息类型
// ============================================================================

export interface AppInfo {
  name: string;
  version: string;
  description: string;
  authors: string;
}
