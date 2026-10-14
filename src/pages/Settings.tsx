import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select, SelectItem } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { Tabs, TabsContent, TabsContext } from '@/components/ui/Tabs';
import { CustomModelsCard } from '@/components/settings/CustomModelsCard';
import { TemperatureSlider } from '@/components/settings/TemperatureSlider';
import { formatBytes, useAppUpdate } from '@/hooks/useAppUpdate';
import { useTheme } from '@/hooks/useTheme';
import {
  PROVIDER_DEFAULT_BASE_URL,
  PROVIDER_LABELS,
  PROVIDER_MODEL_OPTIONS,
  providerNeedsBaseUrl,
} from '@/lib/custom-models';
import { ALLOWED_PAGE_SIZES, useErrorNotification, usePrefsStore, useSuccessNotification } from '@/store/useAppStore';
import { logUserAction, logUserError } from '@/lib/user-log';
import type { AppInfoResponse, LogMigrationResult, PlatformInfo, PlatformPaths, ViolationRecord } from '@/lib/tauri-api';
import {
  CHANNELS,
  exportViolationsExcel,
  formatPlatform,
  getAppInfo,
  getConfig,
  getPlatformDefaultPaths,
  getPlatformInfo,
  getViolations,
  getViolationsDir,
  isTauri,
  resetConfig,
  setLogDir,
  subscribeEvent,
  updateConfig,
} from '@/lib/tauri-api';
import { open as shellOpen } from '@tauri-apps/plugin-shell';
import type {
  AccentColor,
  AISettings,
  ApiProvider,
  AppearanceSettings,
  CustomModelProvider,
  GeneralSettings,
  Language,
  PathSettings,
  SettingsState,
  ThemeMode,
} from '@/types/settings';
import {
  AlertCircle,
  Brain,
  CheckCircle2,
  ChevronDown,
  Download,
  ExternalLink,
  Folder,
  FolderOpen,
  Info,
  Loader2,
  Monitor,
  Moon,
  Palette,
  RefreshCw,
  RotateCcw,
  Save,
  Settings as SettingsIcon,
  Sun,
} from 'lucide-react';
import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

const TAB_ITEMS: Array<{ value: string; label: string; icon: React.ElementType }> = [
  { value: 'general', label: '通用', icon: SettingsIcon },
  { value: 'appearance', label: '外观', icon: Palette },
  { value: 'paths', label: '路径', icon: FolderOpen },
  { value: 'ai', label: 'AI 配置', icon: Brain },
  { value: 'about', label: '关于', icon: Info },
];

/** 路径有效性校验：非空 + 非法字符检查，返回错误信息或 null */
function validatePathValue(value: string): string | null {
  const v = value.trim();
  if (!v) {
    return '路径不能为空';
  }
  if (/[<>"|?*]/.test(v)) {
    return '路径包含非法字符 < > " | ? *';
  }
  for (let i = 0; i < v.length; i++) {
    if (v.charCodeAt(i) < 0x20) {
      return '路径包含不可见控制字符';
    }
  }
  return null;
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

/** 设置页标签导航：横排展示（全局文字横排规范），窄屏可横向滚动 */
const SettingsTabNav: React.FC = () => {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error('SettingsTabNav must be used within Tabs');
  }

  return (
    <nav className="flex flex-row gap-1 overflow-x-auto pb-0.5">
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
            className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2.5 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-pf-ring ${
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
  const pageSize = usePrefsStore((s) => s.pageSize);
  const setPageSize = usePrefsStore((s) => s.setPageSize);
  const [searchParams, setSearchParams] = useSearchParams();

  // 支持 /settings?tab=ai 深链定位（非法值回退 general）
  const queryTab = searchParams.get('tab');
  const initialTab = TAB_ITEMS.some((t) => t.value === queryTab) ? (queryTab as string) : 'general';

  const handleTabChange = useCallback(
    (value: string) => {
      setSearchParams(value === 'general' ? {} : { tab: value }, { replace: true });
    },
    [setSearchParams]
  );

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
    paths: { pythonInstallationsPath: '', virtualEnvironmentsRoot: '', cacheDirectory: '' },
    ai: {
      provider: 'openai',
      apiKey: '',
      model: 'gpt-4o-mini',
      baseUrl: '',
      useLocalLlm: false,
      localLlmEndpoint: '',
      temperature: 0.7,
    },
  });
  /** 应用信息（名称/版本/作者，来自后端 Cargo 元数据的真实数据） */
  const [appInfo, setAppInfo] = useState<AppInfoResponse | null>(null);
  const [platformInfo, setPlatformInfo] = useState<PlatformInfo | null>(null);
  const [platformLoading, setPlatformLoading] = useState(true);
  const [platformError, setPlatformError] = useState<string | null>(null);
  const [pathsTouched, setPathsTouched] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  // 保存期间跳过跨端配置同步刷新，避免远端事件覆盖正在编辑的表单
  const savingRef = useRef(false);
  // 异步回调的卸载守卫
  const mountedRef = useRef(true);
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  // 平台默认路径（后端权威值；浏览器模式为 null 走本地回退）
  const [platformDefaults, setPlatformDefaults] = useState<PathSettings | null>(null);
  const [platformStorageRoot, setPlatformStorageRoot] = useState<string | null>(null);
  // AI 服务商切换联动加载态（≤300ms 的轻量过渡提示）
  const [providerSwitching, setProviderSwitching] = useState(false);
  // 日志目录配置与迁移
  const [logDirInput, setLogDirInput] = useState('');
  const [logDirSaved, setLogDirSaved] = useState('');
  const [logDirDefault, setLogDirDefault] = useState<string | null>(null);
  const [logMigrating, setLogMigrating] = useState(false);
  const [logMigrationResult, setLogMigrationResult] = useState<LogMigrationResult | null>(null);
  const [logMigrationError, setLogMigrationError] = useState<string | null>(null);
  // 系统盘写入违规记录（监控数据 + Excel 导出状态）
  const [violations, setViolations] = useState<ViolationRecord[]>([]);
  const [violationsDir, setViolationsDir] = useState<string | null>(null);
  const [exportingViolations, setExportingViolations] = useState(false);
  // 路径逐项校验错误（key: PathSettings 字段名）
  const [pathErrors, setPathErrors] = useState<Partial<Record<keyof PathSettings, string>>>({});

  const updateGeneral = useCallback((patch: Partial<GeneralSettings>) => {
    setSettings((prev) => ({ ...prev, general: { ...prev.general, ...patch } }));
  }, []);

  const updateAppearance = useCallback((patch: Partial<AppearanceSettings>) => {
    setSettings((prev) => ({ ...prev, appearance: { ...prev.appearance, ...patch } }));
  }, []);

  const updatePaths = useCallback((patch: Partial<PathSettings>) => {
    setPathsTouched(true);
    setSettings((prev) => ({ ...prev, paths: { ...prev.paths, ...patch } }));
    // 逐字段实时校验，清空已修复项的错误
    setPathErrors((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(patch) as Array<keyof PathSettings>) {
        const err = validatePathValue(patch[key] ?? '');
        if (err) {
          next[key] = err;
        } else {
          delete next[key];
        }
      }
      return next;
    });
  }, []);

  const updateAI = useCallback((patch: Partial<AISettings>) => {
    setSettings((prev) => ({ ...prev, ai: { ...prev.ai, ...patch } }));
  }, []);

  useEffect(() => {
    updateAppearance({ theme });
  }, [theme, updateAppearance]);

  // 组件卸载标记（异步回调安全守卫）
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 从后端加载配置（真实持久化配置；无任何本地假数据兜底）
  const loadConfig = useCallback(async () => {
    try {
      setIsLoadingConfig(true);
      const config = await getConfig();
      if (!mountedRef.current || !config) return;

      setSettings((prev) => ({
        ...prev,
        ai: {
          provider: (config.ai?.provider ?? prev.ai.provider) as ApiProvider,
          apiKey: config.ai?.api_key ?? prev.ai.apiKey,
          model: config.ai?.model ?? prev.ai.model,
          baseUrl: config.ai?.base_url ?? '',
          useLocalLlm: config.ai?.use_local_llm ?? prev.ai.useLocalLlm,
          localLlmEndpoint: config.ai?.local_llm_endpoint ?? prev.ai.localLlmEndpoint,
          temperature: config.ai?.temperature ?? prev.ai.temperature,
        },
        general: {
          ...prev.general,
          language: (config.general?.language ?? prev.general.language) as Language,
          startupBehavior: config.general?.auto_start ?? prev.general.startupBehavior,
          notifications: config.general?.notifications ?? prev.general.notifications,
        },
        paths: {
          pythonInstallationsPath:
            config.paths?.python_installations_path?.trim() || prev.paths.pythonInstallationsPath,
          virtualEnvironmentsRoot: config.paths?.venv_root?.trim() || prev.paths.virtualEnvironmentsRoot,
          cacheDirectory: config.paths?.cache_dir?.trim() || prev.paths.cacheDirectory,
        },
      }));
      // 日志目录：已保存值回显；后端未配置时展示平台默认值
      const savedLogDir = config.logging?.dir?.trim() ?? '';
      setLogDirSaved(savedLogDir);
      setLogDirInput(savedLogDir);
    } catch (err) {
      // 配置加载失败时保留空表单并提示，不注入假数据
      console.warn('加载配置失败:', err);
    } finally {
      if (mountedRef.current) {
        setIsLoadingConfig(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  // 跨端实时同步：任一端保存配置后（后端广播 config_changed），本端非保存状态下自动刷新
  useEffect(() => {
    const off = subscribeEvent(CHANNELS.configChanged, () => {
      if (!savingRef.current) void loadConfig();
    });
    return () => {
      void off.then((fn) => fn());
    };
  }, [loadConfig]);

  // 应用信息（名称/版本/作者，来自后端 Cargo 元数据）
  useEffect(() => {
    getAppInfo()
      .then((info) => {
        if (mountedRef.current) setAppInfo(info);
      })
      .catch(() => {});
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
        // 平台默认路径：后端权威计算（非系统盘优先）；不可达时保持空值不注入假数据
        const backendPaths: PlatformPaths | null = await getPlatformDefaultPaths();
        if (!mounted || !backendPaths) return;
        const defaults: PathSettings = {
          pythonInstallationsPath: backendPaths.python_installations_path,
          virtualEnvironmentsRoot: backendPaths.venv_root,
          cacheDirectory: backendPaths.cache_dir,
        };
        setPlatformDefaults(defaults);
        setPlatformStorageRoot(backendPaths.storage_root ?? null);
        setLogDirDefault(backendPaths.log_dir ?? null);
        setSettings((prev) => ({
          ...prev,
          paths: pathsTouched ? prev.paths : defaults,
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
    if (!platformDefaults) return;
    updatePaths({ ...platformDefaults });
    setPathErrors({});
  }, [platformDefaults, updatePaths]);

  /** AI 服务商双向联动：切换后自动加载专属模型列表与默认端点，隐藏无关字段 */
  const handleProviderChange = useCallback(
    (provider: ApiProvider) => {
      const p = provider as CustomModelProvider;
      const models = PROVIDER_MODEL_OPTIONS[p];
      updateAI({
        provider,
        // 有官方模型列表则选中首个默认模型；否则（兼容/本地）清空供手填
        model: models.length > 0 ? models[0] : '',
        baseUrl: PROVIDER_DEFAULT_BASE_URL[p] ?? '',
        ...(p === 'local' ? { useLocalLlm: true } : {}),
      });
      // 轻量加载态提示（250ms ≤ 300ms 规范）；未知 provider 由注册表 fallback 兜底
      setProviderSwitching(true);
      window.setTimeout(() => setProviderSwitching(false), 250);
    },
    [updateAI]
  );

  /** 日志目录变更：保存配置并自动迁移旧日志（进度提示 + 失败异常处理） */
  const handleMigrateLogs = useCallback(async () => {
    const target = logDirInput.trim();
    const invalid = validatePathValue(target);
    if (invalid) {
      setLogMigrationError(invalid);
      return;
    }
    if (target === logDirSaved) {
      setLogMigrationError(null);
      showSuccess('日志目录未变化', '新目录与当前目录一致，无需迁移');
      return;
    }
    try {
      setLogMigrating(true);
      setLogMigrationError(null);
      setLogMigrationResult(null);
      const result = await setLogDir(target);
      setLogDirSaved(target);
      setLogMigrationResult(result);
      if (result.failed_files.length > 0) {
        showError(
          '日志迁移部分失败',
          `${result.migrated_files.length} 个文件已迁移，${result.failed_files.length} 个文件被占用迁移失败（保留在原目录，重启后可重试）`
        );
      } else {
        showSuccess(
          '日志迁移完成',
          `已迁移 ${result.migrated_files.length} 个日志文件到新目录${result.active_file_deferred ? '（活跃日志文件将在重启后切换）' : ''}`
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLogMigrationError(msg);
      showError('日志迁移失败', msg);
    } finally {
      setLogMigrating(false);
    }
  }, [logDirInput, logDirSaved, showError, showSuccess]);

  /** 系统盘写入违规记录：加载监控数据与记录目录 */
  useEffect(() => {
    if (!isTauri) return;
    void getViolations()
      .then(setViolations)
      .catch(() => setViolations([]));
    void getViolationsDir()
      .then(setViolationsDir)
      .catch(() => setViolationsDir(null));
  }, []);

  /** 导出违规记录为标准 Excel 文档（独立文件夹，与日志目录同层级） */
  const handleExportViolations = useCallback(async () => {
    setExportingViolations(true);
    try {
      const path = await exportViolationsExcel();
      showSuccess(
        '违规记录已导出',
        `Excel 文件：${path}（所在文件夹与日志目录同层级）`
      );
      logUserAction(`导出违规记录 Excel: 成功，共 ${violations.length} 条记录`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showError('违规记录导出失败', msg);
      logUserError(`导出违规记录 Excel: 失败 - ${msg}`);
    } finally {
      setExportingViolations(false);
    }
  }, [violations.length, showError, showSuccess]);

  const handleSave = useCallback(async () => {
    // 路径校验失败时阻止保存并提示
    const currentErrors: Partial<Record<keyof PathSettings, string>> = {};
    for (const key of ['pythonInstallationsPath', 'virtualEnvironmentsRoot', 'cacheDirectory'] as const) {
      const err = validatePathValue(settings.paths[key]);
      if (err) currentErrors[key] = err;
    }
    if (Object.keys(currentErrors).length > 0) {
      setPathErrors((prev) => ({ ...prev, ...currentErrors }));
      showError('路径校验失败', '请先修正路径配置中的错误项');
      return;
    }

    try {
      setIsSaving(true);
      savingRef.current = true;
      logUserAction(
        `保存设置: AI服务商=${settings.ai.provider}, 模型=${settings.ai.model}, 语言=${settings.general.language}, 路径校验=通过`
      );
      // 先取当前完整配置做合并：AI 节整体替换，若不回填 max_tokens/top_p 等
      // 未在表单中展示的字段，会被后端重置为默认值
      const current = await getConfig();
      const configPatch = {
        ai: {
          provider: settings.ai.provider,
          api_key: settings.ai.apiKey,
          model: settings.ai.model,
          base_url: settings.ai.baseUrl || current?.ai?.base_url || undefined,
          use_local_llm: settings.ai.useLocalLlm,
          local_llm_endpoint: settings.ai.localLlmEndpoint || current?.ai?.local_llm_endpoint || undefined,
          temperature: settings.ai.temperature,
          max_tokens: current?.ai?.max_tokens,
          top_p: current?.ai?.top_p,
        },
        general: {
          language: settings.general.language,
          auto_start: settings.general.startupBehavior,
          notifications: settings.general.notifications,
        },
        paths: {
          python_installations_path: settings.paths.pythonInstallationsPath,
          venv_root: settings.paths.virtualEnvironmentsRoot,
          cache_dir: settings.paths.cacheDirectory,
        },
        logging: {
          level: current?.logging?.level,
          file_enabled: current?.logging?.file_enabled,
          max_file_size_mb: current?.logging?.max_file_size_mb,
          max_files: current?.logging?.max_files,
          // 日志目录以「保存并迁移」按钮的落盘结果为准，此处仅同步未单独迁移过的输入
          dir: (logDirSaved || logDirInput.trim()) || undefined,
        },
      };
      await updateConfig(configPatch);
      logUserAction('保存设置: 成功，配置已持久化');
      showSuccess('设置已保存', '配置已更新并持久化到本地');
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logUserError(`保存设置: 失败 - ${errorMsg}`);
      showError('保存失败', errorMsg);
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  }, [settings, logDirSaved, logDirInput, showError, showSuccess]);

  const {
    status: updateStatus,
    info: updateInfo,
    progress: updateProgress,
    downloadedBytes: updateDownloaded,
    totalBytes: updateTotal,
    error: updateError,
    checkForUpdate,
    installUpdate,
  } = useAppUpdate();

  const updateInProgress =
    updateStatus === 'checking' || updateStatus === 'downloading' || updateStatus === 'installing';

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h2 className="pf-text-display text-2xl text-pf-foreground">设置</h2>
        <p className="text-sm text-pf-muted-foreground">应用偏好、外观与系统配置</p>
      </div>

      <Tabs defaultValue={initialTab} value={undefined} onValueChange={handleTabChange}>
        <div className="flex flex-col gap-6">
          {/* 顶部横排标签导航（原竖排导航已改横排，符合全局横排文字规范） */}
          <aside className="w-full">
            <Card className="p-2">
              <SettingsTabNav />
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
                  label="列表每页条数"
                  description="版本列表、包列表等分页展示的数据条数（默认 10）"
                >
                  <div className="relative">
                    <Select
                      value={String(pageSize)}
                      onChange={(e) => setPageSize(Number(e.target.value))}
                      className="min-w-[110px] appearance-none pr-8"
                    >
                      {ALLOWED_PAGE_SIZES.map((size) => (
                        <SelectItem key={size} value={String(size)}>
                          {size} 条 / 页
                        </SelectItem>
                      ))}
                    </Select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-pf-muted-foreground" />
                  </div>
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
                    <span className="font-semibold text-pf-primary">平台存储规则：</span>
                    {platformInfo.osType === 'windows' ? (
                      <>
                        已自动选择非系统盘分区（如 <code>D:\PyForge</code>）；系统盘运行时数据默认避开 C 盘。
                        {platformStorageRoot && (
                          <>
                            {' '}当前存储根目录：<code className="font-mono">{platformStorageRoot}</code>
                          </>
                        )}
                      </>
                    ) : platformInfo.osType === 'macos' ? (
                      <>默认使用用户主目录下的 <code>~/PyForge</code>（非系统关键分区），缓存与环境数据均存放于此。</>
                    ) : (
                      <>默认使用用户主目录下的 <code>~/PyForge</code>（非系统关键分区），缓存与环境数据均存放于此。</>
                    )}
                  </div>
                )}

                {(
                  [
                    {
                      key: 'pythonInstallationsPath' as const,
                      label: 'Python 安装目录',
                      description: '已安装 Python 解释器的根目录',
                    },
                    {
                      key: 'virtualEnvironmentsRoot' as const,
                      label: '虚拟环境根目录',
                      description: '所有虚拟环境的默认存放位置（建议非系统盘分区）',
                    },
                    {
                      key: 'cacheDirectory' as const,
                      label: '缓存目录',
                      description: '包缓存与临时文件存储位置（建议非系统盘分区）',
                    },
                  ]
                ).map((row) => (
                  <SettingsRow key={row.key} label={row.label} description={row.description}>
                    <div className="flex flex-col items-start gap-1">
                      <div className="flex items-center gap-2">
                        <Input
                          type="text"
                          value={settings.paths[row.key]}
                          onChange={(e) => updatePaths({ [row.key]: e.target.value })}
                          aria-invalid={Boolean(pathErrors[row.key])}
                          className={`min-w-[220px] font-mono text-xs ${
                            pathErrors[row.key] ? 'border-state-error focus-visible:ring-state-error' : ''
                          }`}
                        />
                        <Button variant="outline" size="icon" aria-label="选择目录">
                          <Folder className="h-4 w-4" />
                        </Button>
                      </div>
                      {pathErrors[row.key] && (
                        <span className="flex items-center gap-1 text-xs text-state-error" role="alert">
                          <AlertCircle className="h-3 w-3" />
                          {pathErrors[row.key]}
                        </span>
                      )}
                    </div>
                  </SettingsRow>
                ))}

                {/* 日志目录：修改后自动触发旧日志迁移（进度 + 失败处理） */}
                <SettingsRow
                  label="日志存储目录"
                  description={
                    logDirDefault
                      ? `运行日志存放位置；留空使用平台默认 ${logDirDefault}`
                      : '运行日志存放位置；修改保存后自动迁移旧日志文件'
                  }
                >
                  <div className="flex flex-col items-start gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        type="text"
                        placeholder={logDirDefault ?? '如 D:\\Logs\\PyForge 或 ~/PyForge/logs'}
                        value={logDirInput}
                        onChange={(e) => {
                          setLogDirInput(e.target.value);
                          setLogMigrationError(validatePathValue(e.target.value.trim()));
                        }}
                        aria-invalid={Boolean(logMigrationError)}
                        className={`min-w-[220px] font-mono text-xs ${
                          logMigrationError ? 'border-state-error focus-visible:ring-state-error' : ''
                        }`}
                      />
                      <Button
                        variant="outline"
                        onClick={() => void handleMigrateLogs()}
                        disabled={logMigrating || Boolean(logMigrationError) || !logDirInput.trim()}
                      >
                        {logMigrating ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FolderOpen className="mr-1.5 h-4 w-4" />}
                        {logMigrating ? '迁移中...' : '保存并迁移'}
                      </Button>
                    </div>
                    {logMigrationError && (
                      <span className="flex items-center gap-1 text-xs text-state-error" role="alert">
                        <AlertCircle className="h-3 w-3" />
                        {logMigrationError}
                      </span>
                    )}
                    {logMigrationResult && !logMigrationError && (
                      <span className="text-xs text-state-success">
                        {logMigrating
                          ? '正在迁移旧日志文件...'
                          : `已迁移 ${logMigrationResult.migrated_files.length} 个文件${logMigrationResult.active_file_deferred ? '，活跃日志文件将在重启后切换' : ''}`}
                      </span>
                    )}
                  </div>
                </SettingsRow>

                {/* 系统盘写入监控：违规记录查看与 Excel 导出（记录文件夹与日志目录同层级） */}
                <SettingsRow
                  label="系统盘写入监控"
                  description={
                    violationsDir
                      ? `运行期文件写入系统盘将被记录并导出 Excel；记录文件夹与日志目录同层级：${violationsDir}`
                      : '运行期文件写入系统盘将被记录，Excel 记录文件存放于与日志目录同层的独立文件夹'
                  }
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      onClick={() => void handleExportViolations()}
                      disabled={exportingViolations}
                    >
                      {exportingViolations ? (
                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="mr-1.5 h-4 w-4" />
                      )}
                      {exportingViolations ? '导出中...' : '导出违规记录 (Excel)'}
                    </Button>
                    <span className="text-xs opacity-70">
                      {violations.length === 0
                        ? '未检测到系统盘写入违规'
                        : `已记录 ${violations.length} 条系统盘写入违规`}
                    </span>
                  </div>
                </SettingsRow>

                <div className="flex items-center justify-end gap-2 pt-4">
                  <Button variant="ghost" onClick={handleResetPaths} disabled={!platformDefaults}>
                    <RotateCcw className="mr-1.5 h-4 w-4" />
                    恢复默认路径
                  </Button>
                </div>
              </SectionCard>
            </TabsContent>

            <TabsContent value="ai" className="!mt-0 space-y-6">
              {/* 服务商切换时的联动加载态（250ms 过渡，≤300ms 规范） */}
              <div className="relative">
                <div
                  aria-hidden={providerSwitching}
                  className={`transition-opacity duration-200 ${
                    providerSwitching ? 'pointer-events-none opacity-40' : 'opacity-100'
                  }`}
                >
              <SectionCard icon={Brain} title="AI 模型">
                <SettingsRow label="API 提供商" description="切换后自动加载该服务商的专属配置项">
                  <div className="relative">
                    <Select
                      value={settings.ai.provider}
                      onChange={(e) => handleProviderChange(e.target.value as ApiProvider)}
                      disabled={providerSwitching}
                      className="min-w-[160px] appearance-none pr-8"
                    >
                      {(Object.keys(PROVIDER_LABELS) as CustomModelProvider[]).map((p) => (
                        <SelectItem key={p} value={p}>
                          {PROVIDER_LABELS[p]}
                        </SelectItem>
                      ))}
                    </Select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-pf-muted-foreground" />
                  </div>
                </SettingsRow>

                {settings.ai.provider !== 'local' && (
                  <SettingsRow label="API 密钥" description="加密存储，不会上传到服务端">
                    <Input
                      type="password"
                      placeholder={settings.ai.provider === 'compatible' ? 'sk-...（服务商提供的密钥）' : 'sk-...'}
                      value={settings.ai.apiKey}
                      onChange={(e) => updateAI({ apiKey: e.target.value })}
                      className="min-w-[240px]"
                    />
                  </SettingsRow>
                )}

                {providerNeedsBaseUrl(settings.ai.provider as CustomModelProvider) && (
                  <SettingsRow
                    label="API 地址"
                    description={
                      settings.ai.baseUrl
                        ? '当前服务商的接入端点（可按需修改）'
                        : '该服务商需要填写接入端点 Base URL'
                    }
                  >
                    <Input
                      type="url"
                      placeholder={
                        PROVIDER_DEFAULT_BASE_URL[settings.ai.provider as CustomModelProvider] ??
                        'https://api.example.com/v1'
                      }
                      value={settings.ai.baseUrl ?? ''}
                      onChange={(e) => updateAI({ baseUrl: e.target.value })}
                      className="min-w-[280px]"
                    />
                  </SettingsRow>
                )}

                <SettingsRow label="模型" description="用于代码生成与部署的模型">
                  {PROVIDER_MODEL_OPTIONS[settings.ai.provider as CustomModelProvider].length > 0 ? (
                    <div className="relative">
                      <Select
                        key={settings.ai.provider}
                        value={settings.ai.model}
                        onChange={(e) => updateAI({ model: e.target.value })}
                        disabled={providerSwitching}
                        className="min-w-[200px] appearance-none pr-8"
                      >
                        {PROVIDER_MODEL_OPTIONS[settings.ai.provider as CustomModelProvider].map((m) => (
                          <SelectItem key={m} value={m}>
                            {m}
                          </SelectItem>
                        ))}
                      </Select>
                      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-pf-muted-foreground" />
                    </div>
                  ) : (
                    <Input
                      type="text"
                      placeholder={
                        settings.ai.provider === 'local' ? '如 qwen2.5:7b（Ollama 模型名）' : '输入模型名称，如 gpt-4o'
                      }
                      value={settings.ai.model}
                      onChange={(e) => updateAI({ model: e.target.value })}
                      className="min-w-[200px] font-mono text-xs"
                    />
                  )}
                </SettingsRow>

                {/* 本地 LLM 开关 + 平滑展开的本地模型配置面板（≤300ms） */}
                <div className="py-0">
                  <SettingsRow label="启动本地 LLM" description="使用本地部署的模型服务（如 Ollama / LM Studio）">
                    <Switch
                      checked={settings.ai.useLocalLlm}
                      onCheckedChange={(checked) => updateAI({ useLocalLlm: checked })}
                    />
                  </SettingsRow>

                  <div
                    className={`grid transition-all duration-300 ease-out ${
                      settings.ai.useLocalLlm ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                    }`}
                    aria-hidden={!settings.ai.useLocalLlm}
                  >
                    <div className="overflow-hidden">
                      <div className="mb-2 mt-3 rounded-lg border border-pf-primary/20 bg-pf-primary/5 p-4">
                        <p className="mb-3 text-xs leading-relaxed text-pf-muted-foreground">
                          本地模型无需 API 密钥；请确保本地推理服务已启动，端点需兼容 OpenAI Chat
                          API 格式。保存后立即生效，无需重启应用。
                        </p>
                        <div className="flex flex-col gap-3">
                          <label className="flex flex-col gap-1.5">
                            <span className="text-xs font-medium text-pf-foreground">服务端点</span>
                            <Input
                              type="url"
                              placeholder="http://localhost:11434/v1"
                              value={settings.ai.localLlmEndpoint ?? ''}
                              onChange={(e) => updateAI({ localLlmEndpoint: e.target.value })}
                              className="font-mono text-xs"
                            />
                          </label>
                          <label className="flex flex-col gap-1.5">
                            <span className="text-xs font-medium text-pf-foreground">模型名称</span>
                            <Input
                              type="text"
                              placeholder="如 qwen2.5:7b / llama3.1:8b"
                              value={settings.ai.model}
                              onChange={(e) => updateAI({ model: e.target.value })}
                              className="font-mono text-xs"
                            />
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <SettingsRow label="温度" description="拖动滑块查看数值刻度与生成分段提示">
                  <TemperatureSlider
                    value={settings.ai.temperature}
                    min={0}
                    max={2}
                    step={0.1}
                    onChange={(value) => updateAI({ temperature: value })}
                  />
                </SettingsRow>
              </SectionCard>
                </div>
                {providerSwitching && (
                  <div className="absolute inset-0 z-10 flex items-start justify-center pt-10">
                    <span className="inline-flex items-center gap-2 rounded-full border border-pf-border bg-pf-card px-4 py-1.5 text-xs text-pf-muted-foreground shadow-lg">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-pf-primary" />
                      正在加载服务商配置...
                    </span>
                  </div>
                )}
              </div>

              {/* AI 自定义模型（智能体模式）：本地保存 / JSON 导入导出 / 实时生效 */}
              <CustomModelsCard />
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
                        {appInfo?.name ?? 'PyForge AI'}
                      </span>
                      <span className="text-sm text-pf-muted-foreground">
                        版本 {appInfo?.version ?? '—'}
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
                          platformInfo ? formatPlatform(platformInfo) : '—'
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
                        {appInfo ? `© ${new Date().getFullYear()} ${appInfo.authors || 'PyForge AI'}` : '—'}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 pt-2">
                    <Button onClick={() => void checkForUpdate()} disabled={updateInProgress}>
                      {updateStatus === 'checking' ? (
                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="mr-1.5 h-4 w-4" />
                      )}
                      检查更新
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        // 打开仓库 LICENSE（真实开源许可证文件）
                        const url = 'https://github.com/Ruffec/pyforge-ai-plus/blob/master/LICENSE';
                        if (isTauri()) {
                          shellOpen(url).catch(() => window.open(url, '_blank'));
                        } else {
                          window.open(url, '_blank', 'noopener');
                        }
                      }}
                    >
                      <ExternalLink className="mr-1.5 h-4 w-4" />
                      开源许可证
                    </Button>
                  </div>

                  {updateStatus === 'available' && updateInfo && (
                    <div className="flex flex-col gap-3 rounded-lg border border-pf-primary/40 bg-pf-primary/5 p-4">
                      <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-pf-foreground">
                        <Download className="h-4 w-4 text-pf-primary" />
                        发现新版本 {updateInfo.version}
                        <span className="text-pf-muted-foreground">
                          （当前 {updateInfo.currentVersion}）
                        </span>
                      </div>
                      {updateInfo.notes && (
                        <p className="whitespace-pre-wrap text-xs leading-relaxed text-pf-muted-foreground">
                          {updateInfo.notes}
                        </p>
                      )}
                      <Button className="w-fit" onClick={() => void installUpdate()}>
                        <Download className="mr-1.5 h-4 w-4" />
                        下载并安装
                      </Button>
                    </div>
                  )}

                  {updateStatus === 'downloading' && (
                    <div className="flex flex-col gap-2 rounded-lg border border-pf-border p-4">
                      <div className="flex items-center justify-between gap-4 text-xs text-pf-muted-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          正在下载更新...
                        </span>
                        <span>
                          {updateTotal > 0
                            ? `${formatBytes(updateDownloaded)} / ${formatBytes(updateTotal)}`
                            : formatBytes(updateDownloaded)}
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-pf-muted">
                        <div
                          className="h-full rounded-full bg-pf-primary transition-all duration-200"
                          style={{ width: `${Math.max(3, updateProgress)}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {updateStatus === 'installing' && (
                    <div className="flex items-center gap-2 rounded-lg border border-pf-primary/40 bg-pf-primary/5 p-3 text-xs text-pf-foreground">
                      <Loader2 className="h-4 w-4 animate-spin text-pf-primary" />
                      更新包已就绪，正在安装并重启应用（Windows 上安装器启动后应用会自动退出）...
                    </div>
                  )}

                  {updateStatus === 'up-to-date' && (
                    <div className="flex items-center gap-2 text-xs text-pf-muted-foreground">
                      <CheckCircle2 className="h-4 w-4 text-state-success" />
                      当前已是最新版本
                    </div>
                  )}

                  {updateStatus === 'error' && updateError && (
                    <div className="flex items-center gap-2 rounded-lg border border-state-error/50 bg-state-error/10 p-3 text-xs text-state-error">
                      <AlertCircle className="h-4 w-4" />
                      {updateError}
                    </div>
                  )}
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
              <Button
                variant="ghost"
                onClick={() => {
                  void (async () => {
                    try {
                      await resetConfig();
                      showSuccess('已恢复默认设置', '配置已重置为默认值并持久化');
                      await loadConfig();
                    } catch (err) {
                      showError('恢复默认失败', err instanceof Error ? err.message : String(err));
                    }
                  })();
                }}
                disabled={isLoadingConfig}
              >
                <RotateCcw className="mr-1.5 h-4 w-4" />
                恢复默认
              </Button>
              <Button
                variant="outline"
                className="ml-auto"
                disabled={!isTauri()}
                title={isTauri() ? undefined : '网页端无需重启应用'}
                onClick={() => {
                  void import('@tauri-apps/plugin-process')
                    .then(({ relaunch }) => relaunch())
                    .catch((err) => {
                      showError('重启失败', err instanceof Error ? err.message : String(err));
                    });
                }}
              >
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
