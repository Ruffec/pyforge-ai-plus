export type ThemeMode = 'light' | 'dark' | 'system';

export type Language = 'zh-CN' | 'en';

export type FontSize = 'small' | 'medium' | 'large';

export type AccentColor = 'teal' | 'blue' | 'amber' | 'red' | 'green';

export type ApiProvider = 'openai' | 'compatible';

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
  temperature: number;
}

export interface AppInfo {
  name: string;
  version: string;
  copyright: string;
  platform: string;
}

export interface SettingsState {
  general: GeneralSettings;
  appearance: AppearanceSettings;
  paths: PathSettings;
  ai: AISettings;
  info: AppInfo;
}
