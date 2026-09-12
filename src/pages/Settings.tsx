import React, { useContext, useState, useCallback, useEffect } from 'react';
import {
  Settings as SettingsIcon,
  Palette,
  FolderOpen,
  Brain,
  Info,
  ChevronDown,
  Folder,
  RotateCcw,
  Save,
  RefreshCw,
  ExternalLink,
  Sun,
  Moon,
  Monitor,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { Tabs, TabsContent, TabsContext } from '@/components/ui/Tabs';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import { Select, SelectItem } from '@/components/ui/Select';
import { useTheme } from '@/hooks/useTheme';
import { formatPlatform, getPlatformInfo, mockAppInfo, getConfig, updateConfig } from '@/lib/tauri-api';
import type { PlatformInfo } from '@/lib/tauri-api';
import { useErrorNotification, useSuccessNotification } from '@/store/useAppStore';
import type {
  AccentColor,
  ApiProvider,
  AppearanceSettings,
  AISettings,
  GeneralSettings,
  Language,
  PathSettings,
  SettingsState,
  ThemeMode,
} from '@/types/settings';

const TAB_ITEMS: Array<{ value: string; label: string; icon: React.ElementType }> = [
  { value: 'general', label: '通用', icon: SettingsIcon },
  { value: 'appearance', label: '外观', icon: Palette },
  { value: 'paths', label: '路径', icon: FolderOpen },
  { value: 'ai', label: 'AI 配置', icon: Brain },
  { value: 'about', label: '关于', icon: Info },
];

const DEFAULT_PATHS: PathSettings = {
  pythonInstallationsPath: '/usr/local/python',
  virtualEnvironmentsRoot: '~/.pyforge/envs',
  cacheDirectory: '~/.pyforge/cache',
};

function getPlatformDefaultPaths(platform: PlatformInfo['osType']): PathSettings {
  switch (platform) {
    case 'windows':
      return {
        pythonInstallationsPath: '%LOCALAPPDATA%\\Programs\\Python',
        virtualEnvironmentsRoot: '%APPDATA%\\PyForge\\envs',
        cacheDirectory: '%APPDATA%\\PyForge\\cache',
      };
    case 'macos':
      return {
        pythonInstallationsPath: '/usr/local/python',
        virtualEnvironmentsRoot: '~/Library/Application Support/PyForge/envs',
        cacheDirectory: '~/Library/Caches/PyForge',
      };
    case 'linux':
    default:
      return {
        pythonInstallationsPath: '/usr/local/python',
        virtualEnvironmentsRoot: '~/.config/PyForge/envs',
        cacheDirectory: '~/.cache/PyForge',
      };
  }
}

const ACCENT_COLORS: Array<{ value: AccentColor; label: string; className: string }> = [
  { value: 'teal', label: '青绿', className: 'bg-pf-primary' },
  { value: 'blue', label: '蓝色', className: 'bg-state-info' },
  { value: 'amber', label: '琥珀', className: 'bg-state-warning' },
  { value: 'red', label: '红色', className: 'bg-state-error' },
  { value: 'green', label: '绿色', className: 'bg-state-success' },
];

const FONT_SIZE_OPTIONS: Array<{ value: AppearanceSettings['fontSize']; label: string }> = [
  { value: 'small', label: '小' },
  { value: 'medium', label: '中' },
  { value: 'large', label: '大' },
];

interface SettingsRowProps {
  label: string;
  description?: string;
  children: React.ReactNode;
}

const SettingsRow: React.FC<SettingsRowProps> = ({ label, description, children }) => {
  return (
    <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-pf-foreground">{label}</span>
        {description && (
          <span className="text-xs text-pf-muted-foreground">{description}</span>
        )}
      </div>
      <div className="flex shrink-0 items-center justify-start sm:justify-end">{children}</div>
    </div>
  );
};

interface SectionCardProps {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
}

const SectionCard: React.FC<SectionCardProps> = ({ icon: Icon, title, children }) => {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-6">
        <div className="mb-2 flex items-center gap-2">
          <Icon className="h-4 w-4 text-pf-primary" />
          <h2 className="pf-text-heading text-base text-pf-foreground">{title}</h2>
        </div>
        <div className="divide-y divide-pf-border">{children}</div>
      </CardContent>
    </Card>
  );
};

const VerticalTabNav: React.FC = () => {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error('VerticalTabNav must be used within Tabs');
  }

  return (
    <nav className="flex flex-col gap-1">
      {TAB_ITEMS.map((item) => {
        const Icon = item.icon;
        const active = context.value === item.value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => context.onValueChange(item.value)}
            className={`flex items-center gap-2.5 rounded-lg px-4 py-2.5 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-pf-ring ${
              active
                ? 'bg-pf-primary/10 font-semibold text-pf-primary'
                : 'text-pf-muted-foreground hover:bg-pf-muted hover:text-pf-foreground'
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
};

export const Settings: React.FC = () => {
  const { theme, setTheme } = useTheme();
  const showError = useErrorNotification();
  const showSuccess = useSuccessNotification();

  const [settings, setSettings] = useState<SettingsState>({
    general: {
      language: 'zh-CN',
      startupBehavior: true,
      defaultProjectPath: '',
      notifications: true,
    },
    appearance: {
      theme,
      accentColor: 'teal',
      fontSize: 'medium',
      reduceMotion: false,
    },
    paths: { ...DEFAULT_PATHS },
    ai: {
      provider: 'openai',
      apiKey: '',
      model: 'gpt-4o-mini',
      baseUrl: '',
      useLocalLlm: false,
      temperature: 0.7,
    },
    info: { ...mockAppInfo },
  });
  const [platformInfo, setPlatformInfo] = useState<PlatformInfo | null>(null);
  const [platformLoading, setPlatformLoading] = useState(true);
  const [platformError, setPlatformError] = useState<string | null>(null);
  const [pathsTouched, setPathsTouched] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);

  const updateGeneral = useCallback((patch: Partial<GeneralSettings>) => {
    setSettings((prev) => ({ ...prev, general: { ...prev.general, ...patch } }));
  }, []);

  const updateAppearance = useCallback((patch: Partial<AppearanceSettings>) => {
    setSettings((prev) => ({ ...prev, appearance: { ...prev.appearance, ...patch } }));
  }, []);

  const updatePaths = useCallback((patch: Partial<PathSettings>) => {
    setPathsTouched(true);
    setSettings((prev) => ({ ...prev, paths: { ...prev.paths, ...patch } }));
  }, []);

  const updateAI = useCallback((patch: Partial<AISettings>) => {
    setSettings((prev) => ({ ...prev, ai: { ...prev.ai, ...patch } }));
  }, []);

  useEffect(() => {
    updateAppearance({ theme });
  }, [theme, updateAppearance]);

  // 从后端加载配置
  useEffect(() => {
    let mounted = true;
    async function loadConfig() {
      try {
        setIsLoadingConfig(true);
        const config = await getConfig();
        if (!mounted || !config) return;

        setSettings((prev) => ({
          ...prev,
          ai: {
            provider: (config.ai?.provider ?? prev.ai.provider) as ApiProvider,
            apiKey: config.ai?.api_key ?? prev.ai.apiKey,
            model: config.ai?.model ?? prev.ai.model,
            baseUrl: config.ai?.base_url ?? '',
            useLocalLlm: config.ai?.use_local_llm ?? prev.ai.useLocalLlm,
            temperature: config.ai?.temperature ?? prev.ai.temperature,
          },
          general: {
            ...prev.general,
            language: (config.general?.language ?? prev.general.language) as Language,
            startupBehavior: config.general?.auto_start ?? prev.general.startupBehavior,
            notifications: config.general?.notifications ?? prev.general.notifications,
          },
        }));
      } catch (err) {
        // 配置加载失败时使用默认值，不阻塞 UI
        console.warn('加载配置失败，使用默认值:', err);
      } finally {
        if (mounted) {
          setIsLoadingConfig(false);
        }
      }
    }
    loadConfig();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    async function loadPlatform() {
      try {
        setPlatformLoading(true);
        setPlatformError(null);
        const info = await getPlatformInfo();
        if (!mounted) return;
        setPlatformInfo(info);
        setSettings((prev) => ({
          ...prev,
          info: { ...prev.info, platform: formatPlatform(info) },
          paths: pathsTouched ? prev.paths : getPlatformDefaultPaths(info.osType),
        }));
      } catch (err) {
        if (mounted) {
          setPlatformError(err instanceof Error ? err.message : '加载平台信息失败');
        }
      } finally {
        if (mounted) {
          setPlatformLoading(false);
        }
      }
    }
    loadPlatform();
    return () => {
      mounted = false;
    };
  }, [pathsTouched]);

  const handleThemeChange = useCallback(
    (next: ThemeMode) => {
      setTheme(next);
      updateAppearance({ theme: next });
    },
    [setTheme, updateAppearance]
  );

  const handleResetPaths = useCallback(() => {
    const defaults = platformInfo ? getPlatformDefaultPaths(platformInfo.osType) : DEFAULT_PATHS;
    updatePaths({ ...defaults });
  }, [platformInfo, updatePaths]);

  const handleSave = useCallback(async () => {
    try {
      setIsSaving(true);
      const configPatch = {
        ai: {
          provider: settings.ai.provider,
          api_key: settings.ai.apiKey,
          model: settings.ai.model,
          base_url: settings.ai.baseUrl || undefined,
          use_local_llm: settings.ai.useLocalLlm,
          temperature: settings.ai.temperature,
        },
        general: {
          language: settings.general.language,
          auto_start: settings.general.startupBehavior,
          notifications: settings.general.notifications,
        },
      };
      await updateConfig(configPatch);
      showSuccess('设置已保存', '配置已更新并持久化到本地');
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      showError('保存失败', errorMsg);
    } finally {
      setIsSaving(false);
    }
  }, [settings, showError, showSuccess]);

  const handleCheckForUpdates = useCallback(() => {
    // Placeholder for Tauri updater integration.
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h2 className="pf-text-display text-2xl text-pf-foreground">设置</h2>
        <p className="text-sm text-pf-muted-foreground">应用偏好、外观与系统配置</p>
      </div>

      <Tabs defaultValue="general">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          {/* Left vertical tab navigation */}
          <aside className="w-full shrink-0 lg:w-52">
            <Card className="p-3">
              <VerticalTabNav />
            </Card>
          </aside>

          {/* Right tab content */}
          <div className="min-w-0 flex-1 space-y-6">
            <TabsContent value="general" className="!mt-0 space-y-6">
              <SectionCard icon={SettingsIcon} title="基本设置">
                <SettingsRow label="语言" description="界面显示语言">
                  <div className="relative">
                    <Select
                      value={settings.general.language}
                      onChange={(e) =>
                        updateGeneral({ language: e.target.value as GeneralSettings['language'] })
                      }
                      className="min-w-[140px] appearance-none pr-8"
                    >
                      <SelectItem value="zh-CN">简体中文</SelectItem>
                      <SelectItem value="en">English</SelectItem>
                    </Select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-pf-muted-foreground" />
                  </div>
                </SettingsRow>

                <SettingsRow
                  label="启动时打开"
                  description="应用启动时自动打开控制台"
                >
                  <Switch
                    checked={settings.general.startupBehavior}
                    onCheckedChange={(checked) => updateGeneral({ startupBehavior: checked })}
                  />
                </SettingsRow>

                <SettingsRow label="通知" description="启用应用内通知">
                  <Switch
                    checked={settings.general.notifications}
                    onCheckedChange={(checked) => updateGeneral({ notifications: checked })}
                  />
                </SettingsRow>

                <SettingsRow
                  label="默认项目路径"
                  description="新建项目的默认保存位置"
                >
                  <div className="flex items-center gap-2">
                    <Input
                      type="text"
                      placeholder="~/PyForgeProjects"
                      value={settings.general.defaultProjectPath}
                      onChange={(e) => updateGeneral({ defaultProjectPath: e.target.value })}
                      className="min-w-[200px]"
                    />
                    <Button variant="outline" size="icon" aria-label="选择目录">
                      <Folder className="h-4 w-4" />
                    </Button>
                  </div>
                </SettingsRow>
              </SectionCard>
            </TabsContent>

            <TabsContent value="appearance" className="!mt-0 space-y-6">
              <SectionCard icon={Palette} title="外观">
                <SettingsRow label="主题" description="选择界面主题">
                  <div className="flex items-center gap-2 rounded-lg border border-pf-border bg-pf-muted p-1">
                    <Button
                      type="button"
                      variant={theme === 'light' ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => handleThemeChange('light')}
                      className="gap-1.5"
                    >
                      <Sun className="h-3.5 w-3.5" />
                      浅色
                    </Button>
                    <Button
                      type="button"
                      variant={theme === 'dark' ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => handleThemeChange('dark')}
                      className="gap-1.5"
                    >
                      <Moon className="h-3.5 w-3.5" />
                      深色
                    </Button>
                    <Button
                      type="button"
                      variant={theme === 'system' ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => handleThemeChange('system')}
                      className="gap-1.5"
                    >
                      <Monitor className="h-3.5 w-3.5" />
                      系统
                    </Button>
                  </div>
                </SettingsRow>

                <SettingsRow label="强调色" description="界面高亮与交互颜色">
                  <div className="flex flex-wrap items-center gap-4">
                    {ACCENT_COLORS.map((color) => {
                      const active = settings.appearance.accentColor === color.value;
                      return (
                        <button
                          key={color.value}
                          type="button"
                          onClick={() => updateAppearance({ accentColor: color.value })}
                          className="flex flex-col items-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-pf-ring rounded-lg p-1"
                        >
                          <span
                            className={`h-7 w-7 rounded-full ${color.className} ring-2 ring-offset-2 ring-offset-pf-background transition-transform hover:scale-105 ${
                              active ? 'ring-pf-primary' : 'ring-transparent'
                            }`}
                          />
                          <span
                            className={`text-xs ${
                              active ? 'font-medium text-pf-primary' : 'text-pf-muted-foreground'
                            }`}
                          >
                            {color.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </SettingsRow>

                <SettingsRow label="字体大小" description="界面字体缩放">
                  <div className="relative">
                    <Select
                      value={settings.appearance.fontSize}
                      onChange={(e) =>
                        updateAppearance({
                          fontSize: e.target.value as AppearanceSettings['fontSize'],
                        })
                      }
                      className="min-w-[120px] appearance-none pr-8"
                    >
                      {FONT_SIZE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </Select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-pf-muted-foreground" />
                  </div>
                </SettingsRow>

                <SettingsRow label="减少动画" description="降低界面过渡动画">
                  <Switch
                    checked={settings.appearance.reduceMotion}
                    onCheckedChange={(checked) => updateAppearance({ reduceMotion: checked })}
                  />
                </SettingsRow>
              </SectionCard>
            </TabsContent>

            <TabsContent value="paths" className="!mt-0 space-y-6">
              <SectionCard icon={FolderOpen} title="路径配置">
                {platformInfo && (
                  <div className="rounded-lg border border-pf-primary/20 bg-pf-primary/5 p-3 text-xs leading-relaxed text-pf-foreground">
                    <span className="font-semibold text-pf-primary">平台默认路径：</span>
                    {platformInfo.osType === 'windows' ? (
                      <>
                        当前平台为 Windows，默认使用 <code>%APPDATA%</code> 与{' '}
                        <code>%LOCALAPPDATA%</code> 下的 PyForge 目录。
                      </>
                    ) : platformInfo.osType === 'macos' ? (
                      <>
                        当前平台为 macOS，默认使用 <code>~/Library/Application Support</code> 与{' '}
                        <code>~/Library/Caches</code> 下的 PyForge 目录。
                      </>
                    ) : (
                      <>
                        当前平台为 Linux，默认使用 <code>~/.config</code> 与{' '}
                        <code>~/.cache</code> 下的 PyForge 目录。
                      </>
                    )}
                  </div>
                )}

                <SettingsRow
                  label="Python 安装目录"
                  description="已安装 Python 解释器的根目录"
                >
                  <div className="flex items-center gap-2">
                    <Input
                      type="text"
                      value={settings.paths.pythonInstallationsPath}
                      onChange={(e) => updatePaths({ pythonInstallationsPath: e.target.value })}
                      className="min-w-[220px] font-mono text-xs"
                    />
                    <Button variant="outline" size="icon" aria-label="选择目录">
                      <Folder className="h-4 w-4" />
                    </Button>
                  </div>
                </SettingsRow>

                <SettingsRow
                  label="虚拟环境根目录"
                  description="所有虚拟环境的默认存放位置"
                >
                  <div className="flex items-center gap-2">
                    <Input
                      type="text"
                      value={settings.paths.virtualEnvironmentsRoot}
                      onChange={(e) => updatePaths({ virtualEnvironmentsRoot: e.target.value })}
                      className="min-w-[220px] font-mono text-xs"
                    />
                    <Button variant="outline" size="icon" aria-label="选择目录">
                      <Folder className="h-4 w-4" />
                    </Button>
                  </div>
                </SettingsRow>

                <SettingsRow
                  label="缓存目录"
                  description="包缓存与临时文件存储位置"
                >
                  <div className="flex items-center gap-2">
                    <Input
                      type="text"
                      value={settings.paths.cacheDirectory}
                      onChange={(e) => updatePaths({ cacheDirectory: e.target.value })}
                      className="min-w-[220px] font-mono text-xs"
                    />
                    <Button variant="outline" size="icon" aria-label="选择目录">
                      <Folder className="h-4 w-4" />
                    </Button>
                  </div>
                </SettingsRow>

                <div className="flex items-center justify-end gap-2 pt-4">
                  <Button variant="ghost" onClick={handleResetPaths}>
                    <RotateCcw className="mr-1.5 h-4 w-4" />
                    恢复默认路径
                  </Button>
                </div>
              </SectionCard>
            </TabsContent>

            <TabsContent value="ai" className="!mt-0 space-y-6">
              <SectionCard icon={Brain} title="AI 模型">
                <SettingsRow label="API 提供商" description="选择 LLM 服务提供商">
                  <div className="relative">
                    <Select
                      value={settings.ai.provider}
                      onChange={(e) =>
                        updateAI({ provider: e.target.value as AISettings['provider'] })
                      }
                      className="min-w-[140px] appearance-none pr-8"
                    >
                      <SelectItem value="openai">OpenAI</SelectItem>
                      <SelectItem value="compatible">OpenAI 兼容</SelectItem>
                    </Select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-pf-muted-foreground" />
                  </div>
                </SettingsRow>

                <SettingsRow label="API 密钥" description="加密存储，不会上传到服务端">
                  <Input
                    type="password"
                    placeholder="sk-..."
                    value={settings.ai.apiKey}
                    onChange={(e) => updateAI({ apiKey: e.target.value })}
                    className="min-w-[240px]"
                  />
                </SettingsRow>

                {settings.ai.provider === 'compatible' && (
                  <SettingsRow label="API 地址" description="OpenAI 兼容服务的 Base URL">
                    <Input
                      type="url"
                      placeholder="https://api.example.com/v1"
                      value={settings.ai.baseUrl ?? ''}
                      onChange={(e) => updateAI({ baseUrl: e.target.value })}
                      className="min-w-[280px]"
                    />
                  </SettingsRow>
                )}

                <SettingsRow label="模型" description="用于代码生成与部署的模型">
                  <div className="relative">
                    <Select
                      value={settings.ai.model}
                      onChange={(e) => updateAI({ model: e.target.value })}
                      className="min-w-[160px] appearance-none pr-8"
                    >
                      <SelectItem value="gpt-4o">GPT-4o</SelectItem>
                      <SelectItem value="gpt-4o-mini">GPT-4o mini</SelectItem>
                      <SelectItem value="claude-3-5-sonnet">Claude 3.5 Sonnet</SelectItem>
                      <SelectItem value="qwen2.5-coder">Qwen2.5 Coder</SelectItem>
                    </Select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-pf-muted-foreground" />
                  </div>
                </SettingsRow>

                <SettingsRow label="本地 LLM" description="使用本地部署的模型服务">
                  <Switch
                    checked={settings.ai.useLocalLlm}
                    onCheckedChange={(checked) => updateAI({ useLocalLlm: checked })}
                  />
                </SettingsRow>

                <SettingsRow label="温度" description="生成结果的随机性（0-2）">
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={0}
                      max={2}
                      step={0.1}
                      value={settings.ai.temperature}
                      onChange={(e) => updateAI({ temperature: parseFloat(e.target.value) })}
                      className="h-2 w-40 cursor-pointer appearance-none rounded-lg bg-pf-muted accent-pf-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-pf-ring"
                    />
                    <span className="min-w-[3ch] text-right text-sm font-medium text-pf-foreground">
                      {settings.ai.temperature.toFixed(1)}
                    </span>
                  </div>
                </SettingsRow>
              </SectionCard>
            </TabsContent>

            <TabsContent value="about" className="!mt-0 space-y-6">
              <SectionCard icon={Info} title="关于">
                <div className="flex flex-col gap-4 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-pf-primary text-pf-primary-foreground">
                      <span className="pf-text-heading text-lg">PF</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-base font-semibold text-pf-foreground">
                        {settings.info.name}
                      </span>
                      <span className="text-sm text-pf-muted-foreground">
                        版本 {settings.info.version}
                      </span>
                    </div>
                  </div>

                  {platformError && (
                    <div className="flex items-center gap-2 rounded-lg border border-state-error/50 bg-state-error/10 p-3 text-xs text-state-error">
                      <AlertCircle className="h-4 w-4" />
                      {platformError}
                    </div>
                  )}

                  <div className="grid gap-2 text-sm">
                    <div className="flex justify-between gap-4 border-b border-pf-border pb-2">
                      <span className="text-pf-muted-foreground">平台</span>
                      <span className="text-right text-pf-foreground">
                        {platformLoading ? (
                          <span className="inline-flex items-center gap-2 text-pf-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            检测中...
                          </span>
                        ) : (
                          settings.info.platform
                        )}
                      </span>
                    </div>
                    {platformInfo && (
                      <>
                        <div className="flex justify-between gap-4 border-b border-pf-border pb-2">
                          <span className="text-pf-muted-foreground">操作系统版本</span>
                          <span className="text-right text-pf-foreground">{platformInfo.osVersion}</span>
                        </div>
                        <div className="flex justify-between gap-4 border-b border-pf-border pb-2">
                          <span className="text-pf-muted-foreground">架构</span>
                          <span className="text-right font-mono text-pf-foreground">
                            {platformInfo.architecture}
                          </span>
                        </div>
                        <div className="flex justify-between gap-4 border-b border-pf-border pb-2">
                          <span className="text-pf-muted-foreground">Shell</span>
                          <span className="text-right font-mono text-pf-foreground">
                            {platformInfo.shell}
                          </span>
                        </div>
                      </>
                    )}
                    <div className="flex justify-between gap-4 border-b border-pf-border pb-2">
                      <span className="text-pf-muted-foreground">版权</span>
                      <span className="text-right text-pf-foreground">
                        {settings.info.copyright}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 pt-2">
                    <Button onClick={handleCheckForUpdates}>
                      <RefreshCw className="mr-1.5 h-4 w-4" />
                      检查更新
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        // Placeholder for licenses modal.
                      }}
                    >
                      <ExternalLink className="mr-1.5 h-4 w-4" />
                      开源许可证
                    </Button>
                  </div>
                </div>
              </SectionCard>
            </TabsContent>

            {/* Bottom action bar */}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Button onClick={handleSave} disabled={isSaving || isLoadingConfig}>
                {isSaving ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-1.5 h-4 w-4" />
                )}
                {isSaving ? '保存中...' : '保存设置'}
              </Button>
              <Button variant="ghost">
                <RotateCcw className="mr-1.5 h-4 w-4" />
                恢复默认
              </Button>
              <Button variant="outline" className="ml-auto">
                <RefreshCw className="mr-1.5 h-4 w-4" />
                应用并重启
              </Button>
            </div>
          </div>
        </div>
      </Tabs>
    </div>
  );
};
