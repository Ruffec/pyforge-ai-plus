/**
 * 统一数据层：桌面端（Tauri IPC）与网页端（HTTP 桥接 RPC）共用同一套 API。
 *
 * - 桌面端：直接调用 Rust 后端命令（invoke）。
 * - 网页端：桌面应用启动时开启本机 HTTP 桥接服务（默认 127.0.0.1:21880），
 *   网页端通过 `POST /api/rpc` 调用完全相同的后端实现，`GET /api/events`
 *   （SSE）接收事件流，实现两端数据变更实时双向同步。
 *
 * 本文件不包含任何 mock / 模拟数据：两端均严格对接真实数据源。
 * 桥接服务不可达时抛出明确错误（配合全局连接横幅提示启动桌面应用）。
 */
import type { DependencyNode, VirtualEnvironment } from '@/types/environments';
import type { Package, PipMirror } from '@/types/packages';
import type { PythonOrgRelease, PythonVersion } from '@/types/python-versions';
import { invoke } from '@tauri-apps/api/core';

// ------------------------------------------------------------------
// 环境检测与桥接通道
// ------------------------------------------------------------------

declare global {
  interface Window {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  }
}

export function isTauri(): boolean {
  if (typeof window === 'undefined') return false;
  return !!(window.__TAURI__ || window.__TAURI_INTERNALS__);
}

/** 桥接服务地址：支持 `?bridge=<port>` 查询参数覆盖，默认 127.0.0.1:21880 */
export function getBridgeBase(): string {
  if (typeof window === 'undefined') return 'http://127.0.0.1:21880';
  const port = new URLSearchParams(window.location.search).get('bridge');
  const p = port && /^\d+$/.test(port) ? port : '21880';
  return `http://127.0.0.1:${p}`;
}

/** 结构化 API 错误（与后端 AppError 对齐） */
export class ApiError extends Error {
  code?: string;
  statusCode?: number;
  constructor(message: string, code?: string, statusCode?: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/** 将任意抛出值规范化为 Error（IPC 对象错误 {code,message} 等） */
export function normalizeError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (typeof err === 'string') return new Error(err);
  if (typeof err === 'object' && err !== null) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === 'string' && msg) return new Error(msg);
    try {
      return new Error(JSON.stringify(err));
    } catch {
      return new Error(String(err));
    }
  }
  return new Error(String(err));
}

// ------------------------------------------------------------------
// 桥接连接状态（网页端横幅提示用）
// ------------------------------------------------------------------

export type BridgeStatus = 'tauri' | 'connected' | 'disconnected';
type BridgeListener = (status: BridgeStatus) => void;

const bridgeListeners = new Set<BridgeListener>();
let bridgeStatus: BridgeStatus = isTauri() ? 'tauri' : 'disconnected';

export function getBridgeStatus(): BridgeStatus {
  return bridgeStatus;
}

export function onBridgeStatusChange(listener: BridgeListener): () => void {
  bridgeListeners.add(listener);
  return () => bridgeListeners.delete(listener);
}

function setBridgeStatus(status: BridgeStatus) {
  if (bridgeStatus === status) return;
  bridgeStatus = status;
  bridgeListeners.forEach((fn) => fn(status));
}

/** 探测桥接服务连通性（网页端启动时调用） */
export async function pingBridge(): Promise<boolean> {
  if (isTauri()) return true;
  try {
    const res = await fetch(`${getBridgeBase()}/api/health`);
    const ok = res.ok;
    setBridgeStatus(ok ? 'connected' : 'disconnected');
    return ok;
  } catch {
    setBridgeStatus('disconnected');
    return false;
  }
}

// ------------------------------------------------------------------
// 统一调用通道
// ------------------------------------------------------------------

/**
 * 统一命令调用：桌面端走 Tauri IPC，网页端走 HTTP 桥接 RPC。
 * 所有数据获取严格来自真实后端，无任何模拟回退。
 */
export async function invokeCommand<T>(
  cmd: string,
  args?: Record<string, unknown>
): Promise<T> {
  if (isTauri()) {
    try {
      return await invoke<T>(cmd, args);
    } catch (err) {
      throw normalizeError(err);
    }
  }

  let res: Response;
  try {
    res = await fetch(`${getBridgeBase()}/api/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: cmd, args: args ?? {} }),
    });
  } catch {
    setBridgeStatus('disconnected');
    throw new ApiError(
      `无法连接 PyForge 桌面服务（${getBridgeBase()}），请先启动桌面应用后重试`
    );
  }

  let json: { ok?: boolean; data?: T; error?: { code?: string; message?: string; status_code?: number } } | null =
    null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  if (!res.ok || !json || json.ok === false) {
    const err = json?.error;
    throw new ApiError(
      err?.message ?? `请求失败（HTTP ${res.status}）`,
      err?.code,
      err?.status_code ?? res.status
    );
  }

  setBridgeStatus('connected');
  return json.data as T;
}

// ------------------------------------------------------------------
// 统一事件订阅（跨端实时同步）
// ------------------------------------------------------------------

/** 后端事件通道常量（与 Rust events.rs 对齐） */
export const CHANNELS = {
  taskProgress: 'pyforge://task/progress',
  log: 'pyforge://log',
  notification: 'pyforge://notification',
  pythonScanned: 'pyforge://python/scanned',
  pythonDefaultChanged: 'pyforge://python/default_changed',
  venvChanged: 'pyforge://venv/changed',
  packageProgress: 'pyforge://package/progress',
  packageChanged: 'pyforge://package/changed',
  mirrorChanged: 'pyforge://mirror/changed',
  configChanged: 'pyforge://config/changed',
  aiStream: 'pyforge://ai/stream',
} as const;

type EventPayload = { channel: string; payload: unknown };

/** 网页端共享 EventSource（引用计数，多页面共用一条 SSE 连接） */
let sharedEventSource: EventSource | null = null;
const eventSourceRefs = new Map<
  EventSource,
  { count: number; listeners: Map<string, Set<(payload: unknown) => void>> }
>();

function acquireEventSource(): EventSource {
  if (sharedEventSource) {
    const rec = eventSourceRefs.get(sharedEventSource);
    if (rec) rec.count += 1;
    return sharedEventSource;
  }
  const es = new EventSource(`${getBridgeBase()}/api/events`);
  eventSourceRefs.set(es, { count: 1, listeners: new Map() });
  es.onmessage = (ev: MessageEvent<string>) => {
    try {
      const data = JSON.parse(ev.data) as EventPayload;
      const rec = eventSourceRefs.get(es);
      rec?.listeners.get(data.channel)?.forEach((fn) => fn(data.payload));
    } catch {
      // 忽略非 JSON 心跳/杂项消息
    }
  };
  es.onerror = () => setBridgeStatus('disconnected');
  es.onopen = () => setBridgeStatus('connected');
  sharedEventSource = es;
  return es;
}

function releaseEventSource(es: EventSource) {
  const rec = eventSourceRefs.get(es);
  if (!rec) return;
  rec.count -= 1;
  if (rec.count <= 0) {
    es.close();
    eventSourceRefs.delete(es);
    if (sharedEventSource === es) sharedEventSource = null;
  }
}

/**
 * 订阅后端事件：桌面端走 Tauri listen，网页端走 SSE。
 * 返回取消订阅函数。
 */
export async function subscribeEvent<T>(
  channel: string,
  handler: (payload: T) => void
): Promise<() => void> {
  if (isTauri()) {
    const { listen } = await import('@tauri-apps/api/event');
    return listen<T>(channel, (event) => handler(event.payload));
  }
  const es = acquireEventSource();
  const rec = eventSourceRefs.get(es);
  if (!rec) return () => {};
  let set = rec.listeners.get(channel);
  if (!set) {
    set = new Set();
    rec.listeners.set(channel, set);
  }
  const fn = handler as (payload: unknown) => void;
  set.add(fn);
  return () => {
    set?.delete(fn);
    releaseEventSource(es);
  };
}

// ------------------------------------------------------------------
// Backend response types (serde default snake_case)
// ------------------------------------------------------------------

interface PlatformInfoResponse {
  os_type: 'windows' | 'macos' | 'linux';
  os_version: string;
  architecture: string;
  shell: string;
}

interface PythonInfoResponse {
  id: string;
  version: string;
  path: string;
  is_active: boolean;
  pip_version?: string;
  packages_count?: number;
  architecture?: string;
}

interface VirtualEnvironmentResponse {
  id: string;
  name: string;
  python_version: string;
  path: string;
  size_bytes: number;
  packages_count: number;
  status: string;
  created_at: number;
}

interface DependencyResponse {
  name: string;
  version: string;
}

interface PipMirrorResponse {
  id: string;
  name: string;
  url: string;
  latency_ms: number;
}

interface PackageInfoResponse {
  id: string;
  name: string;
  version: string;
  description: string;
  latest_version: string;
}

interface InstalledPackageResponse {
  name: string;
  version: string;
  latest_version: string;
  size: number;
}

// ------------------------------------------------------------------
// Frontend return types
// ------------------------------------------------------------------

export interface PlatformInfo {
  osType: 'windows' | 'macos' | 'linux';
  osVersion: string;
  architecture: string;
  shell: string;
}

export function formatPlatform(info: PlatformInfo): string {
  const osLabels: Record<PlatformInfo['osType'], string> = {
    windows: 'Windows',
    macos: 'macOS',
    linux: 'Linux',
  };
  return `${osLabels[info.osType] ?? info.osType} ${info.osVersion} · ${info.architecture}`;
}

/** 后端任务信息（真实操作记录，用于最近活动与统计） */
export interface TaskInfo {
  id: string;
  task_type: string;
  status: string;
  progress: number;
  message: string;
  created_at: number;
  updated_at: number;
}

/** 后端应用信息 */
export interface AppInfoResponse {
  name: string;
  version: string;
  description: string;
  authors: string;
}

/** 项目信息（后端 project 模块） */
export interface ProjectInfoResponse {
  name: string;
  path: string;
  project_type: string;
  python_version?: string | null;
  dependencies: Array<{
    name: string;
    version_constraint: string;
    is_dev: boolean;
    is_optional: boolean;
    source: string;
  }>;
  dev_dependencies: Array<{
    name: string;
    version_constraint: string;
    is_dev: boolean;
    is_optional: boolean;
    source: string;
  }>;
  dependency_files: string[];
  [key: string]: unknown;
}

// ------------------------------------------------------------------
// Mappers
// ------------------------------------------------------------------

function mapPlatformInfo(resp: PlatformInfoResponse): PlatformInfo {
  return {
    osType: resp.os_type,
    osVersion: resp.os_version,
    architecture: resp.architecture,
    shell: resp.shell,
  };
}

function mapPythonInfo(resp: PythonInfoResponse): PythonVersion {
  return {
    id: resp.id,
    version: resp.version,
    path: resp.path,
    isActive: resp.is_active,
    pipVersion: resp.pip_version,
    packagesCount: resp.packages_count,
    architecture: resp.architecture,
    lastUsed: '-',
    releaseDate: '-',
    size: '-',
  };
}

function toEnvironmentStatus(status: string): VirtualEnvironment['status'] {
  switch (status) {
    case 'active':
      return 'active';
    case 'broken':
      return 'corrupted';
    default:
      return 'idle';
  }
}

function mapVirtualEnvironment(resp: VirtualEnvironmentResponse): VirtualEnvironment {
  return {
    id: resp.id,
    name: resp.name,
    pythonVersion: resp.python_version,
    path: resp.path,
    size: `${formatBytes(resp.size_bytes)} / 5 GB`,
    status: toEnvironmentStatus(resp.status),
    packagesCount: resp.packages_count,
    createdAt: formatCreatedAt(resp.created_at),
    isActive: false,
    usagePercent: Math.min(100, Math.round((resp.size_bytes / (5 * 1024 * 1024 * 1024)) * 100)),
    dependencyTree: [],
  };
}

function mapPipMirror(resp: PipMirrorResponse, activeUrl?: string): PipMirror {
  return {
    id: resp.id,
    name: resp.name,
    url: resp.url,
    latencyMs: resp.latency_ms === u64Max() ? undefined : resp.latency_ms,
    isActive: activeUrl ? resp.url === activeUrl : false,
  };
}

function u64Max(): number {
  return Number.MAX_SAFE_INTEGER;
}

function mapPackageInfo(resp: PackageInfoResponse): Package {
  return {
    id: resp.id,
    name: resp.name,
    version: resp.version,
    description: resp.description,
    latestVersion: resp.latest_version,
  };
}

function mapInstalledPackage(resp: InstalledPackageResponse): Package {
  return {
    id: `${resp.name}-${resp.version}`,
    name: resp.name,
    version: resp.version,
    latestVersion: resp.latest_version || undefined,
    size: formatBytes(Number(resp.size)),
  };
}

function mapDependency(resp: DependencyResponse): DependencyNode {
  return {
    name: resp.name,
    version: resp.version,
  };
}

// ------------------------------------------------------------------
// API functions
// ------------------------------------------------------------------

export async function getPlatformInfo(): Promise<PlatformInfo> {
  const resp = await invokeCommand<PlatformInfoResponse>('get_platform_info');
  return mapPlatformInfo(resp);
}

/** 获取应用信息（名称/版本/描述/作者，来自后端 Cargo 元数据） */
export async function getAppInfo(): Promise<AppInfoResponse> {
  return invokeCommand<AppInfoResponse>('get_app_info');
}

export async function scanPythonVersions(forceRefresh = false): Promise<PythonVersion[]> {
  const resp = await invokeCommand<PythonInfoResponse[]>('scan_python_versions_command', {
    forceRefresh,
  });
  return resp.map(mapPythonInfo);
}

interface PythonOrgReleaseResponse {
  version: string;
  release_date: string;
  release_page_url: string;
  is_latest: boolean;
}

/**
 * 从 python.org 官方 API 获取 Python 3 稳定版本列表。
 * 后端已过滤预发布版本并按版本号倒序排列。
 */
export async function fetchPythonReleases(): Promise<PythonOrgRelease[]> {
  const resp = await invokeCommand<PythonOrgReleaseResponse[]>('fetch_python_org_releases_command');
  return resp.map((r) => ({
    version: r.version,
    releaseDate: r.release_date,
    releasePageUrl: r.release_page_url,
    isLatest: r.is_latest,
  }));
}

export async function setDefaultPython(path: string): Promise<void> {
  await invokeCommand<void>('set_default_python_command', { path });
}

// ------------------------------------------------------------------
// Python 一键安装 / 彻底卸载
// ------------------------------------------------------------------

/** 一键安装参数 */
export interface InstallPythonOptions {
  version: string;
  /** Windows 安装包架构："64"（默认）| "32" | "arm64" */
  arch?: '64' | '32' | 'arm64';
  /** 自定义安装目录（空则使用官方默认目录） */
  installDir?: string;
  /** 全机器安装（需管理员授权；默认每用户安装） */
  allUsers?: boolean;
  /** 是否写入 PATH（默认 true） */
  prependPath?: boolean;
}

/** 一键安装结果 */
export interface InstallPythonResult {
  success: boolean;
  version: string;
  task_id: string;
  message: string;
  installed_path?: string;
  reboot_required: boolean;
  warnings: string[];
}

/** 彻底卸载参数 */
export interface UninstallPythonOptions {
  /** python.exe 完整路径 */
  path: string;
  /** 清理环境变量（默认 true） */
  removeEnv?: boolean;
  /** 清理注册表（默认 true） */
  removeRegistry?: boolean;
  /** 强制卸载（存在依赖虚拟环境/默认版本冲突时） */
  force?: boolean;
}

/** 彻底卸载报告 */
export interface UninstallReport {
  success: boolean;
  version?: string;
  official_uninstaller_used: boolean;
  removed_paths: string[];
  removed_registry_keys: string[];
  removed_env_entries: string[];
  /** MSI/Burn 安装器注册残留清理明细（UserData Products / UpgradeCodes / Components / Package Cache） */
  msi_residue_removed?: string[];
  /** 清理后仍未安装干净的 MSI 产品（非空表示有残留） */
  msi_products_remaining?: string[];
  warnings: string[];
  dependent_venvs: string[];
  duration_ms: number;
}

/** 安装目录校验结果 */
export interface DirValidation {
  valid: boolean;
  writable: boolean;
  reason?: string;
}

/**
 * 一键安装 Python：官方源直下直装（命令阻塞至安装完成，
 * 过程中经 task/progress 事件推送下载与安装阶段进度）。
 */
export async function installPython(options: InstallPythonOptions): Promise<InstallPythonResult> {
  return invokeCommand<InstallPythonResult>('install_python_command', {
    version: options.version,
    arch: options.arch ?? undefined,
    installDir: options.installDir || undefined,
    allUsers: options.allUsers ?? undefined,
    prependPath: options.prependPath ?? undefined,
  });
}

/** 彻底卸载 Python：官方卸载器优先 + 文件/注册表/环境变量全清理 */
export async function uninstallPythonVersion(
  options: UninstallPythonOptions
): Promise<UninstallReport> {
  return invokeCommand<UninstallReport>('uninstall_python_version_command', {
    path: options.path,
    removeEnv: options.removeEnv ?? undefined,
    removeRegistry: options.removeRegistry ?? undefined,
    force: options.force ?? undefined,
  });
}

/** 校验自定义安装目录（合法性 / 可写性 / 危险区域拒绝） */
export async function validateInstallDir(path: string): Promise<DirValidation> {
  return invokeCommand<DirValidation>('validate_install_dir_command', { path });
}

export async function getPythonDetails(path: string): Promise<PythonVersion> {
  const resp = await invokeCommand<PythonInfoResponse>('get_python_details_command', { path });
  return mapPythonInfo(resp);
}

export async function listVenvs(): Promise<VirtualEnvironment[]> {
  const resp = await invokeCommand<VirtualEnvironmentResponse[]>('list_venvs');
  return resp.map(mapVirtualEnvironment);
}

export async function createVenv(
  name: string,
  pythonPath: string,
  targetDir: string
): Promise<VirtualEnvironment> {
  const resp = await invokeCommand<VirtualEnvironmentResponse>('create_venv_command', {
    name,
    pythonPath,
    targetDir,
  });
  return mapVirtualEnvironment(resp);
}

export async function removeVenv(path: string): Promise<void> {
  await invokeCommand<void>('remove_venv_command', { path });
}

export async function getDependencies(path: string): Promise<DependencyNode[]> {
  const resp = await invokeCommand<DependencyResponse[]>('get_dependencies_command', { path });
  return resp.map(mapDependency);
}

export async function cloneVenv(source: string, target: string): Promise<VirtualEnvironment> {
  const resp = await invokeCommand<VirtualEnvironmentResponse>('clone_venv_command', {
    source,
    target,
  });
  return mapVirtualEnvironment(resp);
}

/** 导出虚拟环境依赖为 requirements.txt 内容 */
export async function exportVenv(path: string): Promise<string> {
  return invokeCommand<string>('export_venv_command', { path });
}

export async function getMirrors(): Promise<PipMirror[]> {
  const resp = await invokeCommand<PipMirrorResponse[]>('get_mirrors');
  const current = await getCurrentMirror();
  return resp.map((m) => mapPipMirror(m, current?.url));
}

export async function getCurrentMirror(): Promise<PipMirror | null> {
  const resp = await invokeCommand<PipMirrorResponse | null>('get_current_mirror');
  if (!resp) return null;
  return mapPipMirror(resp);
}

export async function setMirror(url: string): Promise<void> {
  await invokeCommand<void>('set_mirror_command', { url });
}

export async function testMirrorSpeed(url: string): Promise<number> {
  return invokeCommand<number>('test_mirror_speed_command', { url });
}

export async function searchPackage(query: string): Promise<Package[]> {
  const resp = await invokeCommand<PackageInfoResponse[]>('search_package_command', { query });
  return resp.map(mapPackageInfo);
}

export async function listInstalledPackages(pythonPath: string): Promise<Package[]> {
  const resp = await invokeCommand<InstalledPackageResponse[]>('list_installed_packages_command', {
    pythonPath,
  });
  return resp.map(mapInstalledPackage);
}

/** 在指定虚拟环境中安装包 */
export async function installPackage(
  venvPath: string,
  packageName: string,
  version?: string
): Promise<string> {
  return invokeCommand<string>('install_package_command', {
    venvPath,
    packageName,
    version: version || undefined,
  });
}

/** 在指定虚拟环境中卸载包 */
export async function uninstallPackage(venvPath: string, packageName: string): Promise<string> {
  return invokeCommand<string>('uninstall_package_command', { venvPath, packageName });
}

/** 批量安装（requirements.txt 内容） */
export async function installFromRequirements(
  venvPath: string,
  requirements: string
): Promise<string> {
  return invokeCommand<string>('install_from_requirements_command', {
    venvPath,
    requirements,
  });
}

/** 升级虚拟环境中所有过时的包 */
export async function upgradeAllPackages(venvPath: string): Promise<string> {
  return invokeCommand<string>('upgrade_all_packages_command', { venvPath });
}

/** 升级指定 Python 环境（可执行文件路径或虚拟环境目录）中的 pip 自身 */
export async function upgradePip(pythonPath: string): Promise<string> {
  return invokeCommand<string>('upgrade_pip_command', { pythonPath });
}

// ------------------------------------------------------------------
// 配置管理 API
// ------------------------------------------------------------------

export interface AppConfig {
  general?: {
    language?: string;
    auto_start?: boolean;
    notifications?: boolean;
    default_project_path?: string;
    recent_projects?: string[];
  };
  python?: {
    default_version?: string;
    search_paths?: string[];
    auto_check_updates?: boolean;
    uninstall_max_retries?: number;
    uninstall_retry_interval_ms?: number;
  };
  venv?: {
    root_path?: string;
    default_root?: string;
    auto_upgrade_pip?: boolean;
    default_packages?: string[];
  };
  package?: {
    default_mirror?: string;
    concurrent_downloads?: number;
    timeout?: number;
  };
  ai?: {
    provider?: string;
    api_key?: string;
    model?: string;
    base_url?: string;
    temperature?: number;
    use_local_llm?: boolean;
    local_llm_endpoint?: string;
    max_tokens?: number;
    top_p?: number;
  };
  logging?: {
    level?: string;
    file_enabled?: boolean;
    max_file_size_mb?: number;
    max_files?: number;
    dir?: string;
  };
  paths?: {
    python_installations_path?: string;
    venv_root?: string;
    cache_dir?: string;
  };
  ui?: {
    theme?: string;
    accent_color?: string;
    font_size?: string;
  };
}

/** 平台默认路径规则（非系统盘优先，由后端 paths 模块按当前平台计算） */
export interface PlatformPaths {
  python_installations_path: string;
  venv_root: string;
  cache_dir: string;
  log_dir: string;
  platform: string;
  storage_root: string;
}

/** 日志目录迁移结果（后端逐文件迁移统计，用于前端进度与失败提示） */
export interface LogMigrationResult {
  from_dir: string;
  to_dir: string;
  migrated_files: string[];
  failed_files: string[];
  migrated_bytes: number;
  active_file_deferred: boolean;
}

/** 获取完整应用配置（真实持久化配置） */
export async function getConfig(): Promise<AppConfig | null> {
  try {
    return await invokeCommand<AppConfig>('get_app_config');
  } catch {
    return null;
  }
}

/** 部分更新配置（后端持久化并广播变更事件） */
export async function updateConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
  return invokeCommand<AppConfig>('update_app_config', { patch });
}

/** 重置配置为默认值 */
export async function resetConfig(): Promise<AppConfig> {
  return invokeCommand<AppConfig>('reset_app_config');
}

// ------------------------------------------------------------------
// 平台路径与日志目录 API 封装
// ------------------------------------------------------------------

/** 获取当前平台默认路径规则（非系统盘优先） */
export async function getPlatformDefaultPaths(): Promise<PlatformPaths | null> {
  try {
    return await invokeCommand<PlatformPaths>('get_platform_default_paths');
  } catch {
    return null;
  }
}

/** 设置日志目录并自动迁移旧日志文件 */
export async function setLogDir(newDir: string): Promise<LogMigrationResult> {
  return invokeCommand<LogMigrationResult>('set_log_dir', { newDir });
}

/** 获取当前日志文件路径 */
export async function getLogFilePath(): Promise<string | null> {
  try {
    return await invokeCommand<string>('get_log_file_path');
  } catch {
    return null;
  }
}

/** 读取最近日志 */
export async function readRecentLogs(maxLines = 200): Promise<string[]> {
  return invokeCommand<string[]>('read_recent_logs', { maxLines });
}

// ------------------------------------------------------------------
// 系统盘写入违规记录 API 封装
// ------------------------------------------------------------------

/** 一条系统盘写入违规记录 */
export interface ViolationRecord {
  file_path: string;
  written_at: string;
  first_seen: string;
  file_type: string;
  module: string;
  occurrences: number;
  detail: string;
}

/** 获取系统盘写入违规记录列表 */
export async function getViolations(): Promise<ViolationRecord[]> {
  try {
    return await invokeCommand<ViolationRecord[]>('get_violations');
  } catch {
    return [];
  }
}

/** 导出违规记录为标准 Excel 文档，返回文件完整路径 */
export async function exportViolationsExcel(): Promise<string> {
  return invokeCommand<string>('export_violations_excel');
}

/** 获取违规记录文件夹路径（与日志目录同层级） */
export async function getViolationsDir(): Promise<string | null> {
  try {
    return await invokeCommand<string>('get_violations_dir');
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------
// 任务记录（真实操作历史：最近活动/统计的数据源）
// ------------------------------------------------------------------

export async function listTasks(): Promise<TaskInfo[]> {
  return invokeCommand<TaskInfo[]>('list_tasks_command');
}

export async function cleanupTasks(keepRecent = 50): Promise<number> {
  return invokeCommand<number>('cleanup_tasks_command', { keepRecent });
}

// ------------------------------------------------------------------
// 项目 API
// ------------------------------------------------------------------

export async function detectProject(path: string): Promise<ProjectInfoResponse | null> {
  return invokeCommand<ProjectInfoResponse | null>('detect_project_command', { path });
}

export async function parseRequirements(
  path: string,
  isDev = false
): Promise<ProjectInfoResponse['dependencies']> {
  return invokeCommand<ProjectInfoResponse['dependencies']>('parse_requirements_command', {
    path,
    isDev,
  });
}

export async function scanProjects(
  rootPath: string,
  maxDepth = 3
): Promise<{ root_path: string; projects: ProjectInfoResponse[]; directories_scanned: number; scan_time_ms: number }> {
  return invokeCommand('scan_projects_command', { rootPath, maxDepth });
}

// ------------------------------------------------------------------
// AI API 封装
// ------------------------------------------------------------------

export interface AiConfig {
  api_provider: string;
  api_key: string;
  model: string;
  base_url?: string;
  temperature: number;
  /** 最大输出 token（自定义模型能力参数） */
  max_tokens?: number;
  /** top_p 采样（自定义模型能力参数） */
  top_p?: number;
  use_local_llm: boolean;
}

export interface ChatMessage {
  role: string;
  content: string;
}

export interface DeploymentRequest {
  user_input: string;
  project_path?: string;
}

export interface DeploymentPlan {
  python_version: string;
  dependencies: Array<{ name: string; version_constraint: string; reason: string }>;
  commands: string[];
  steps: Array<{ title: string; status: string; output?: string }>;
  explanation: string;
}

export interface DependencyConflict {
  package_a: string;
  package_b: string;
  reason: string;
  suggestion: string;
}

/** 生成部署方案（真实 AI 服务调用） */
export async function generateDeploymentPlan(
  request: DeploymentRequest,
  config: AiConfig
): Promise<DeploymentPlan> {
  return invokeCommand<DeploymentPlan>('generate_deployment_plan', { request, config });
}

/** 非流式对话（真实 AI 服务调用） */
export async function chatMessage(messages: ChatMessage[], config: AiConfig): Promise<string> {
  return invokeCommand<string>('chat_message', { messages, config });
}

/** 流式聊天事件类型 */
export interface StreamChatEvent {
  type: 'start' | 'chunk' | 'done' | 'error';
  task_id: string;
  content: string;
}

/** 流式聊天回调 */
export interface StreamChatCallbacks {
  onStart?: (taskId: string) => void;
  onChunk?: (chunk: string, taskId: string) => void;
  onDone?: (fullContent: string, taskId: string) => void;
  onError?: (error: string, taskId: string) => void;
}

/**
 * 流式聊天：通过统一事件订阅接收 token（桌面端 Tauri 事件 / 网页端 SSE）。
 * 返回一个取消函数，调用后停止监听事件。
 */
export async function streamChat(
  messages: ChatMessage[],
  config: AiConfig,
  callbacks: StreamChatCallbacks
): Promise<() => void> {
  // 开始监听事件
  const unlisten = await subscribeEvent<StreamChatEvent>(CHANNELS.aiStream, (payload) => {
    switch (payload.type) {
      case 'start':
        callbacks.onStart?.(payload.task_id);
        break;
      case 'chunk':
        callbacks.onChunk?.(payload.content, payload.task_id);
        break;
      case 'done':
        callbacks.onDone?.(payload.content, payload.task_id);
        break;
      case 'error':
        callbacks.onError?.(payload.content, payload.task_id);
        break;
    }
  });

  // 触发后端流式命令
  invokeCommand<string>('stream_chat_command', { messages, config }).catch((err) => {
    callbacks.onError?.(normalizeError(err).message, '');
  });

  return unlisten;
}

/** 分析依赖冲突 */
export async function analyzeDependencies(
  requirementsContent: string,
  config: AiConfig
): Promise<DependencyConflict[]> {
  return invokeCommand<DependencyConflict[]>('analyze_dependencies_command', {
    requirementsContent,
    config,
  });
}

// ------------------------------------------------------------------
// 格式化辅助（内部使用）
// ------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 MB';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = parseFloat((bytes / Math.pow(k, i)).toFixed(1));
  return `${value} ${units[i] ?? 'B'}`;
}

function formatCreatedAt(seconds: number): string {
  try {
    return new Date(seconds * 1000).toISOString().split('T')[0];
  } catch {
    return '-';
  }
}
