import type {
  CustomAiModel,
  CustomModelProvider,
  ModelCapability,
} from '@/types/settings';

/**
 * AI 自定义模型配置存取层（模块化、低耦合）：
 * - localStorage 本地持久化（密钥不上传服务端）；
 * - 标准化 JSON 导入 / 导出（带版本号与结构校验）；
 * - 变更即时写入 zustand 全局 store（useCustomModelsStore），AI 功能实时读取生效。
 */

const MODELS_STORAGE_KEY = 'pyforge-custom-ai-models';

/** 导出文件格式版本：后续演进时用于迁移 */
export const CUSTOM_MODELS_SCHEMA_VERSION = 1;

export interface CustomModelsExportFile {
  schemaVersion: number;
  exportedAt: string;
  models: CustomAiModel[];
}

/** 预置服务商默认端点（与后端 base_url 自动补全规则一致） */
export const PROVIDER_DEFAULT_BASE_URL: Record<CustomModelProvider, string | undefined> = {
  openai: undefined,
  compatible: undefined,
  deepseek: 'https://api.deepseek.com/v1',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  kimi: 'https://api.moonshot.cn/v1',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  local: 'http://localhost:11434/v1',
};

export const PROVIDER_LABELS: Record<CustomModelProvider, string> = {
  openai: 'OpenAI',
  compatible: 'OpenAI 兼容',
  deepseek: 'DeepSeek',
  qwen: '通义千问',
  kimi: 'Kimi',
  zhipu: '智谱 AI',
  local: '本地模型',
};

export const CAPABILITY_LABELS: Record<ModelCapability, string> = {
  chat: '对话',
  code: '代码生成',
  deploy: '智能部署',
  analysis: '项目分析',
  vision: '图像理解',
  'function-calling': '函数调用',
};

export const ALL_CAPABILITIES: ModelCapability[] = [
  'chat',
  'code',
  'deploy',
  'analysis',
  'vision',
  'function-calling',
];

/**
 * 服务商 → 官方模型列表注册表（设置页 AI 配置与自定义模型共用）。
 * 双向联动规则：切换服务商自动加载该列表并选中首个默认模型，
 * 同时补全对应默认端点；`undefined` 表示该服务商使用官方地址无需填写。
 * 新增服务商：扩展 PROVIDER_LABELS / PROVIDER_DEFAULT_BASE_URL /
 * PROVIDER_MODEL_OPTIONS 三处即可获得一致的联动行为。
 */
export const PROVIDER_MODEL_OPTIONS: Record<CustomModelProvider, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'o3-mini'],
  compatible: [],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  qwen: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen2.5-coder-32b-instruct'],
  kimi: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k', 'kimi-k2-0711-preview'],
  zhipu: ['glm-4-plus', 'glm-4-air', 'glm-4-flash', 'glm-4v-plus'],
  local: [],
};

/** 是否为需要手填端点的服务商（OpenAI 官方地址免填） */
export function providerNeedsBaseUrl(provider: CustomModelProvider): boolean {
  return provider !== 'openai';
}

/** 是否为本地模型服务商（本地 LLM 面板联动） */
export function providerIsLocal(provider: CustomModelProvider): boolean {
  return provider === 'local';
}

/** 创建空白自定义模型（用于新增表单） */
export function createEmptyModel(): CustomAiModel {
  return {
    id: `model-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: '新模型',
    provider: 'compatible',
    model: '',
    baseUrl: '',
    apiKey: '',
    maxTokens: 4096,
    temperature: 0.7,
    topP: 0.9,
    capabilities: ['chat'],
    enabled: false,
  };
}

function asFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isValidProvider(value: unknown): value is CustomModelProvider {
  return (
    value === 'openai' ||
    value === 'compatible' ||
    value === 'deepseek' ||
    value === 'qwen' ||
    value === 'kimi' ||
    value === 'zhipu' ||
    value === 'local'
  );
}

const VALID_CAPABILITIES = new Set<string>(ALL_CAPABILITIES);

/** 结构校验：导入与读取共用，非法条目将被规范化为安全默认值 */
export function sanitizeModel(input: unknown): CustomAiModel {
  const raw = (input ?? {}) as Record<string, unknown>;
  const capabilities: ModelCapability[] = Array.isArray(raw.capabilities)
    ? (raw.capabilities.filter(
        (c): c is ModelCapability => typeof c === 'string' && VALID_CAPABILITIES.has(c)
      ) as ModelCapability[])
    : ['chat'];

  const provider: CustomModelProvider = isValidProvider(raw.provider)
    ? raw.provider
    : 'compatible';

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `model-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : '未命名模型',
    provider,
    model: typeof raw.model === 'string' ? raw.model : '',
    baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl : undefined,
    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : undefined,
    maxTokens: Math.min(1_000_000, Math.max(1, Math.round(asFiniteNumber(raw.maxTokens, 4096)))),
    temperature: Math.min(2, Math.max(0, asFiniteNumber(raw.temperature, 0.7))),
    topP: Math.min(1, Math.max(0, asFiniteNumber(raw.topP, 0.9))),
    capabilities: capabilities.length > 0 ? capabilities : ['chat'],
    enabled: raw.enabled === true,
  };
}

/** 从 localStorage 读取模型列表（损坏数据自动规范化） */
export function loadCustomModels(): CustomAiModel[] {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(MODELS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitizeModel);
  } catch {
    return [];
  }
}

/** 写入 localStorage 本地保存 */
export function saveCustomModels(models: CustomAiModel[]): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(MODELS_STORAGE_KEY, JSON.stringify(models));
  } catch {
    // localStorage 不可用时仅内存生效
  }
}

/** 导出为标准 JSON 字符串（含格式版本与时间戳） */
export function exportModelsToJson(models: CustomAiModel[]): string {
  const payload: CustomModelsExportFile = {
    schemaVersion: CUSTOM_MODELS_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    models,
  };
  return JSON.stringify(payload, null, 2);
}

/** 解析导入的 JSON 文本，返回合法模型列表；结构非法时抛错 */
export function parseModelsFromJson(text: string): CustomAiModel[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('不是合法的 JSON 文件');
  }

  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as CustomModelsExportFile)?.models)
      ? (parsed as CustomModelsExportFile).models
      : null;

  if (!list || list.length === 0) {
    throw new Error('JSON 中未找到模型配置（models 数组）');
  }

  return list.map(sanitizeModel);
}

/** 触发浏览器下载导出文件（浏览器模式）；返回导出文件名 */
export function downloadModelsJson(models: CustomAiModel[]): string {
  const fileName = `pyforge-ai-models-${new Date().toISOString().slice(0, 10)}.json`;
  const blob = new Blob([exportModelsToJson(models)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
  return fileName;
}
