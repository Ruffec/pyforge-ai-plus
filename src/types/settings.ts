export type ThemeMode = 'light' | 'dark' | 'system';

export type Language = 'zh-CN' | 'en';

export type FontSize = 'small' | 'medium' | 'large';

export type AccentColor = 'teal' | 'blue' | 'amber' | 'red' | 'green';

/**
 * AI 提供商选项：覆盖当前市场主流官方服务商 + OpenAI 兼容端点 + 本地模型。
 * 与 CustomModelProvider 保持同一值域，便于智能体模式与全局配置互通。
 */
export type ApiProvider =
  | 'openai'
  | 'compatible'
  | 'deepseek'
  | 'qwen'
  | 'kimi'
  | 'zhipu'
  | 'local';

/**
 * AI 自定义模型的服务商选项：
 * 预置国内主流服务商 + OpenAI 兼容端点 + 本地模型。
 */
export type CustomModelProvider =
  | ApiProvider
  | 'deepseek'
  | 'qwen'
  | 'kimi'
  | 'zhipu'
  | 'local';

/** 模型能力标签（用于智能体模式下的能力声明与下游功能路由） */
export type ModelCapability =
  | 'chat'
  | 'code'
  | 'deploy'
  | 'analysis'
  | 'vision'
  | 'function-calling';

/** AI 自定义模型配置（设置模块维护，支持本地保存 / JSON 导入导出 / 实时生效） */
export interface CustomAiModel {
  id: string;
  /** 展示名称 */
  name: string;
  /** 服务商 */
  provider: CustomModelProvider;
  /** 模型标识（如 deepseek-chat、qwen-max） */
  model: string;
  /** OpenAI 兼容端点（local/compatible 必填，预置服务商可留空自动补全） */
  baseUrl?: string;
  /** API 密钥（仅本地保存） */
  apiKey?: string;
  /** 能力参数：最大输出 token */
  maxTokens: number;
  /** 能力参数：采样温度（0-2） */
  temperature: number;
  /** 能力参数：top_p 采样（0-1） */
  topP: number;
  /** 模型能力标签 */
  capabilities: ModelCapability[];
  /** 是否启用（全局唯一激活，实时注入 AI 功能） */
  enabled: boolean;
}

export interface GeneralSettings {
  language: Language;
  startupBehavior: boolean;
  defaultProjectPath: string;
  notifications: boolean;
}

export interface AppearanceSettings {
  theme: ThemeMode;
  accentColor: AccentColor;
  fontSize: FontSize;
  reduceMotion: boolean;
}

export interface PathSettings {
  pythonInstallationsPath: string;
  virtualEnvironmentsRoot: string;
  cacheDirectory: string;
}

export interface AISettings {
  provider: ApiProvider;
  apiKey: string;
  model: string;
  baseUrl?: string;
  useLocalLlm: boolean;
  /** 本地 LLM 服务端点（如 Ollama / LM Studio 的 OpenAI 兼容地址） */
  localLlmEndpoint?: string;
  temperature: number;
}

export interface SettingsState {
  general: GeneralSettings;
  appearance: AppearanceSettings;
  paths: PathSettings;
  ai: AISettings;
}
