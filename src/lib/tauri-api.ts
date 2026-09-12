import { invoke } from '@tauri-apps/api/core';
import type { DependencyNode, VirtualEnvironment } from '@/types/environments';
import type { Package, PipMirror } from '@/types/packages';
import type { PythonVersion } from '@/types/python-versions';
import {
  aiDeployQuickActions,
  availablePythonVersions,
  defaultPaths,
  mockActivities,
  mockAppInfo,
  mockDeploymentPlan,
  mockEnvironments,
  mockInitialMessages,
  mockInstalledPackages,
  mockMirrors,
  mockProjectAnalysis,
  mockPythonVersions,
  mockQuickActions,
  mockRecommendations,
  mockSearchPackages,
  mockTerminalLines,
  mockVirtualEnvironments,
  pythonVersionOptions,
  quickPackages,
} from './mock-data';

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

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(cmd, args);
}

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
    latencyMs: resp.latency_ms,
    isActive: activeUrl ? resp.url === activeUrl : false,
  };
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
  if (!isTauri()) {
    const ua = navigator.userAgent ?? '';
    let osType: PlatformInfo['osType'] = 'linux';
    if (ua.includes('Windows')) osType = 'windows';
    else if (ua.includes('Mac')) osType = 'macos';

    return {
      osType,
      osVersion: 'Unknown',
      architecture: navigator.platform ?? 'unknown',
      shell: 'unknown',
    };
  }
  const resp = await tauriInvoke<PlatformInfoResponse>('get_platform_info');
  return mapPlatformInfo(resp);
}

export async function scanPythonVersions(): Promise<PythonVersion[]> {
  if (!isTauri()) {
    return Promise.resolve(mockPythonVersions);
  }
  const resp = await tauriInvoke<PythonInfoResponse[]>('scan_python_versions_command');
  return resp.map(mapPythonInfo);
}

export async function setDefaultPython(path: string): Promise<void> {
  if (!isTauri()) {
    await new Promise((resolve) => window.setTimeout(resolve, 600));
    return;
  }
  await tauriInvoke<void>('set_default_python_command', { path });
}

export async function getPythonDetails(path: string): Promise<PythonVersion> {
  if (!isTauri()) {
    const found = mockPythonVersions.find((v) => v.path === path) ?? mockPythonVersions[0];
    if (!found) throw new Error('未找到 Python 版本');
    return Promise.resolve(found);
  }
  const resp = await tauriInvoke<PythonInfoResponse>('get_python_details_command', { path });
  return mapPythonInfo(resp);
}

export async function listVenvs(): Promise<VirtualEnvironment[]> {
  if (!isTauri()) {
    return Promise.resolve(mockVirtualEnvironments);
  }
  const resp = await tauriInvoke<VirtualEnvironmentResponse[]>('list_venvs');
  return resp.map(mapVirtualEnvironment);
}

export async function createVenv(
  name: string,
  pythonPath: string,
  targetDir: string
): Promise<VirtualEnvironment> {
  if (!isTauri()) {
    await new Promise((resolve) => window.setTimeout(resolve, 800));
    const newEnv: VirtualEnvironment = {
      id: `env-${Date.now()}`,
      name,
      pythonVersion: pythonVersionOptions.find((v) => pythonPath.includes(v)) ?? '3.12.4',
      path: targetDir.trim() || `~/.pyforge/envs/${name}`,
      size: '0 MB / 5 GB',
      status: 'idle',
      packagesCount: 0,
      createdAt: new Date().toISOString().split('T')[0],
      isActive: false,
      usagePercent: 0,
      dependencyTree: [],
    };
    return newEnv;
  }
  const resp = await tauriInvoke<VirtualEnvironmentResponse>('create_venv', {
    name,
    pythonPath,
    targetDir,
  });
  return mapVirtualEnvironment(resp);
}

export async function removeVenv(path: string): Promise<void> {
  if (!isTauri()) {
    await new Promise((resolve) => window.setTimeout(resolve, 600));
    return;
  }
  await tauriInvoke<void>('remove_venv', { path });
}

export async function getDependencies(path: string): Promise<DependencyNode[]> {
  if (!isTauri()) {
    const env = mockVirtualEnvironments.find((e) => e.path === path);
    return Promise.resolve(env?.dependencyTree ?? []);
  }
  const resp = await tauriInvoke<DependencyResponse[]>('get_dependencies', { path });
  return resp.map(mapDependency);
}

export async function getMirrors(): Promise<PipMirror[]> {
  if (!isTauri()) {
    return Promise.resolve(mockMirrors);
  }
  const resp = await tauriInvoke<PipMirrorResponse[]>('get_mirrors');
  const current = await getCurrentMirror();
  return resp.map((m) => mapPipMirror(m, current?.url));
}

export async function getCurrentMirror(): Promise<PipMirror | null> {
  if (!isTauri()) {
    return Promise.resolve(mockMirrors.find((m) => m.isActive) ?? null);
  }
  const resp = await tauriInvoke<PipMirrorResponse | null>('get_current_mirror');
  if (!resp) return null;
  return mapPipMirror(resp);
}

export async function setMirror(url: string): Promise<void> {
  if (!isTauri()) {
    await new Promise((resolve) => window.setTimeout(resolve, 400));
    return;
  }
  await tauriInvoke<void>('set_mirror', { url });
}

export async function testMirrorSpeed(url: string): Promise<number> {
  if (!isTauri()) {
    await new Promise((resolve) => window.setTimeout(resolve, 400));
    return Math.floor(Math.random() * 160) + 8;
  }
  return tauriInvoke<number>('test_mirror_speed', { url });
}

export async function searchPackage(query: string): Promise<Package[]> {
  if (!isTauri()) {
    const q = query.trim().toLowerCase();
    const results = q
      ? mockSearchPackages.filter((pkg) => pkg.name.toLowerCase().includes(q))
      : mockSearchPackages;
    return Promise.resolve(results);
  }
  const resp = await tauriInvoke<PackageInfoResponse[]>('search_package', { query });
  return resp.map(mapPackageInfo);
}

export async function listInstalledPackages(pythonPath: string): Promise<Package[]> {
  if (!isTauri()) {
    return Promise.resolve(mockInstalledPackages);
  }
  const resp = await tauriInvoke<InstalledPackageResponse[]>('list_installed_packages', {
    pythonPath,
  });
  return resp.map(mapInstalledPackage);
}

// ------------------------------------------------------------------
// ------------------------------------------------------------------
// 配置管理 API
// ------------------------------------------------------------------

export interface AppConfig {
  general?: {
    language?: string;
    auto_start?: boolean;
    notifications?: boolean;
    default_project_path?: string;
  };
  python?: {
    default_version?: string;
    search_paths?: string[];
    auto_check_updates?: boolean;
  };
  venv?: {
    root_path?: string;
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
  };
  logging?: {
    level?: string;
    file_enabled?: boolean;
    max_file_size_mb?: number;
    max_files?: number;
  };
  ui?: {
    theme?: string;
    accent_color?: string;
    font_size?: string;
  };
}

/** 获取完整应用配置 */
export async function getConfig(): Promise<AppConfig | null> {
  if (!isTauri()) {
    return Promise.resolve(null);
  }
  try {
    return await tauriInvoke<AppConfig>('get_config');
  } catch {
    return null;
  }
}

/** 部分更新配置 */
export async function updateConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
  if (!isTauri()) {
    return Promise.resolve(patch as AppConfig);
  }
  return tauriInvoke<AppConfig>('update_config', { patch });
}

/** 重置配置为默认值 */
export async function resetConfig(): Promise<AppConfig> {
  if (!isTauri()) {
    return Promise.resolve({});
  }
  return tauriInvoke<AppConfig>('reset_config');
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

/** 生成部署方案 */
export async function generateDeploymentPlan(
  request: DeploymentRequest,
  config: AiConfig
): Promise<DeploymentPlan> {
  if (!isTauri()) {
    return Promise.resolve(mockDeploymentPlan as unknown as DeploymentPlan);
  }
  return tauriInvoke<DeploymentPlan>('generate_deployment_plan', { request, config });
}

/** 非流式对话 */
export async function chatMessage(messages: ChatMessage[], config: AiConfig): Promise<string> {
  if (!isTauri()) {
    return Promise.resolve('这是一个模拟回复。在 Tauri 环境中将调用真实 AI API。');
  }
  return tauriInvoke<string>('chat_message', { messages, config });
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
 * 流式聊天，通过 Tauri 事件接收 token。
 * 返回一个取消函数，调用后停止监听事件。
 */
export async function streamChat(
  messages: ChatMessage[],
  config: AiConfig,
  callbacks: StreamChatCallbacks
): Promise<() => void> {
  if (!isTauri()) {
    // Mock 流式输出
    const mockText = '这是一个模拟的流式回复。在 Tauri 环境中，将通过事件逐个推送 token。';
    let index = 0;
    const taskId = `mock-${Date.now()}`;
    callbacks.onStart?.(taskId);

    const interval = setInterval(() => {
      if (index < mockText.length) {
        const chunk = mockText.slice(index, index + 3);
        index += 3;
        callbacks.onChunk?.(chunk, taskId);
      } else {
        clearInterval(interval);
        callbacks.onDone?.(mockText, taskId);
      }
    }, 50);

    return () => clearInterval(interval);
  }

  const { listen } = await import('@tauri-apps/api/event');

  // 开始监听事件
  const unlisten = await listen<StreamChatEvent>('pyforge://ai/stream', (event) => {
    const payload = event.payload;
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
  tauriInvoke<string>('stream_chat_command', { messages, config }).catch((err) => {
    callbacks.onError?.(String(err), '');
  });

  return unlisten;
}

/** 分析依赖冲突 */
export async function analyzeDependencies(
  requirementsContent: string,
  config: AiConfig
): Promise<DependencyConflict[]> {
  if (!isTauri()) {
    return Promise.resolve([]);
  }
  return tauriInvoke<DependencyConflict[]>('analyze_dependencies_command', {
    requirementsContent,
    config,
  });
}

// ------------------------------------------------------------------
// AI Deploy stubs for future streaming integration
// ------------------------------------------------------------------

export interface AiDeployProjectInput {
  projectPath?: string;
  dependencyFile?: string;
}

export interface AiDeployStreamCallbacks {
  onMessage: (chunk: string) => void;
  onError: (error: string) => void;
  onDone: () => void;
}

export async function analyzeProjectForDeploy(_input: AiDeployProjectInput): Promise<{
  analysis: typeof mockProjectAnalysis;
  plan: typeof mockDeploymentPlan;
  recommendations: typeof mockRecommendations;
}> {
  // Placeholder: replace with real Tauri streaming command when ready.
  return {
    analysis: mockProjectAnalysis,
    plan: mockDeploymentPlan,
    recommendations: mockRecommendations,
  };
}

export async function startAiDeployStream(
  _input: AiDeployProjectInput,
  _callbacks: AiDeployStreamCallbacks
): Promise<void> {
  // Placeholder: replace with real Tauri event stream when ready.
  await new Promise((resolve) => window.setTimeout(resolve, 100));
}

// ------------------------------------------------------------------
// Re-exports for convenience
// ------------------------------------------------------------------

export {
  aiDeployQuickActions,
  availablePythonVersions,
  defaultPaths,
  mockActivities,
  mockAppInfo,
  mockDeploymentPlan,
  mockEnvironments,
  mockInitialMessages,
  mockInstalledPackages,
  mockMirrors,
  mockProjectAnalysis,
  mockPythonVersions,
  mockQuickActions,
  mockRecommendations,
  mockSearchPackages,
  mockTerminalLines,
  mockVirtualEnvironments,
  pythonVersionOptions,
  quickPackages,
};
