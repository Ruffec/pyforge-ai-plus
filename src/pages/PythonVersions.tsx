import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog';
import { Pagination } from '@/components/ui/Pagination';
import { InstallPythonDialog } from '@/components/python/InstallPythonDialog';
import { UninstallPythonDialog } from '@/components/python/UninstallPythonDialog';
import {
  CHANNELS,
  fetchPythonReleases,
  getPlatformDefaultPaths,
  getPlatformInfo,
  getPythonDetails,
  isTauri,
  scanPythonVersions,
  setDefaultPython,
  subscribeEvent,
  upgradePip,
} from '@/lib/tauri-api';
import type { PythonOrgRelease, PythonVersion } from '@/types/python-versions';
import { usePrefsStore } from '@/store/useAppStore';
import {
  AlertCircle,
  Boxes,
  Check,
  Clock,
  Download,
  FolderOpen,
  HardDrive,
  Loader2,
  Plus,
  RefreshCw,
  ScanLine,
  Terminal,
  Trash2,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { open as shellOpen } from '@tauri-apps/plugin-shell';
import { logUserAction, logUserError } from '@/lib/user-log';

/** 「可安装版本」条目：来自 python.org 官方发布 API（真实数据源） */
export interface InstallablePythonVersion {
  version: string;
  label: string;
  releaseDate: string;
  releasePageUrl: string;
}

/** 最多展示的官方稳定版本数量（python.org 历史版本较多） */
const MAX_INSTALLABLE_VERSIONS = 12;

/**
 * 展示层路径清洗：剥离 Windows 扩展长度前缀（\\?\ 与 \\?\UNC\），
 * 与后端 normalize_display_path 规则一致，兜底覆盖历史缓存数据。
 */
export function displayPath(path: string): string {
  if (!path) return path;
  if (path.startsWith('\\\\?\\UNC\\')) return `\\\\${path.slice(8)}`;
  if (path.startsWith('\\\\?\\')) return path.slice(4);
  return path;
}

/**
 * 可安装版本卡片的已安装状态判定：按完整版本号精确匹配已安装列表。
 * 命中时卡片显示「此版本已安装 + 卸载」双按钮（卸载复用已安装列表同一流程）；
 * 卸载完成刷新列表后自动回退为单一「安装此版本」按钮——状态完全由数据派生，天然双端同步。
 */
export function findInstalledMatch(
  itemVersion: string,
  versions: PythonVersion[]
): PythonVersion | null {
  return versions.find((v) => v.version === itemVersion) ?? null;
}

export const PythonVersions: React.FC = () => {
  const navigate = useNavigate();
  const [versions, setVersions] = useState<PythonVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<PythonVersion | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeActionId, setActiveActionId] = useState<string | null>(null);
  const [selectedPlatform, setSelectedPlatform] = useState<'windows' | 'macos' | 'linux'>('windows');
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [pythonReleases, setPythonReleases] = useState<PythonOrgRelease[]>([]);
  const [releasesError, setReleasesError] = useState<string | null>(null);
  // 安装 / 卸载对话框（安装入口替换原「前往官方下载」外跳逻辑）
  const [installDialogOpen, setInstallDialogOpen] = useState(false);
  const [installInitialVersion, setInstallInitialVersion] = useState<string | undefined>(undefined);
  const [uninstallDialogOpen, setUninstallDialogOpen] = useState(false);
  const [uninstallTarget, setUninstallTarget] = useState<PythonVersion | null>(null);
  // 真实运行平台（安装方式与注册表/环境变量清理仅对真实平台有意义）
  const [runtimePlatform, setRuntimePlatform] = useState<'windows' | 'macos' | 'linux'>('windows');
  // 默认安装根目录（平台路径配置 paths.python_installations_path）
  const [defaultBaseDir, setDefaultBaseDir] = useState('');
  // 统一分页：已安装 / 可安装列表共用「每页条数」全局偏好（默认 10）
  const pageSize = usePrefsStore((s) => s.pageSize);
  const setPageSize = usePrefsStore((s) => s.setPageSize);
  const [installedPage, setInstalledPage] = useState(1);
  const [installablePage, setInstallablePage] = useState(1);

  const activeVersion = useMemo(
    () => versions.find((v) => v.isActive) ?? versions[0] ?? null,
    [versions]
  );

  const installableVersions: InstallablePythonVersion[] = useMemo(() => {
    if (pythonReleases.length === 0) {
      return [];
    }
    return pythonReleases.slice(0, MAX_INSTALLABLE_VERSIONS).map((r) => ({
      version: r.version,
      label: r.isLatest ? '最新稳定版' : '稳定版',
      releaseDate: r.releaseDate,
      releasePageUrl: r.releasePageUrl,
    }));
  }, [pythonReleases]);

  const installedTotalPages = Math.max(1, Math.ceil(versions.length / pageSize));
  const pagedVersions = useMemo(
    () => versions.slice((installedPage - 1) * pageSize, installedPage * pageSize),
    [versions, installedPage, pageSize]
  );

  const installableTotalPages = Math.max(1, Math.ceil(installableVersions.length / pageSize));
  const pagedInstallableVersions = useMemo(
    () =>
      installableVersions.slice(
        (installablePage - 1) * pageSize,
        installablePage * pageSize
      ),
    [installableVersions, installablePage, pageSize]
  );

  // 数据量变化时收敛页码，避免停留在越界空页
  useEffect(() => {
    setInstalledPage((prev) => Math.min(prev, installedTotalPages));
  }, [installedTotalPages]);

  useEffect(() => {
    setInstallablePage((prev) => Math.min(prev, installableTotalPages));
  }, [installableTotalPages]);

  const handleInstalledPageSizeChange = (size: number) => {
    setPageSize(size);
    setInstalledPage(1);
  };

  const handleInstallablePageSizeChange = (size: number) => {
    setPageSize(size);
    setInstallablePage(1);
  };

  // python.org 官方稳定版本列表（预发布版本已由后端过滤）
  useEffect(() => {
    let mounted = true;
    fetchPythonReleases()
      .then((releases) => {
        if (!mounted) return;
        setPythonReleases(releases);
      })
      .catch((err) => {
        if (mounted) {
          setReleasesError(err instanceof Error ? err.message : '获取官方版本列表失败');
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  // 真实运行平台 + 默认安装根目录（安装/卸载对话框使用，与 UI 平台切换无关）
  useEffect(() => {
    let mounted = true;
    getPlatformInfo()
      .then((info) => {
        if (mounted) setRuntimePlatform(info.osType);
      })
      .catch(() => {
        // 平台信息获取失败时保持默认值，安装对话框仍可展示
      });
    getPlatformDefaultPaths()
      .then((paths) => {
        if (mounted && paths?.python_installations_path) {
          setDefaultBaseDir(paths.python_installations_path);
        }
      })
      .catch(() => {
        // 路径获取失败时对话框内允许手动输入目录
      });
    return () => {
      mounted = false;
    };
  }, []);

  // 后端每次执行扫描命令都会广播 pythonScanned 事件；
  // 通过「在飞标记 + 最近完成时间戳」跳过本端扫描引发的回声事件，
  // 避免同一动作触发二次扫描与「列表 ↔ 加载态」反复切换造成的闪屏。
  const scanBusyRef = useRef(false);
  const lastScanAtRef = useRef(0);

  /** 执行后端扫描并原地更新数据（不触碰 loading，供首载/手动扫描/事件刷新共用） */
  const runScan = useCallback(async () => {
    scanBusyRef.current = true;
    try {
      const data = await scanPythonVersions();
      lastScanAtRef.current = Date.now();
      setVersions(data);
    } finally {
      scanBusyRef.current = false;
    }
  }, []);

  /**
   * 加载已安装版本。仅在首次挂载时展示 loading 态；
   * 事件驱动的刷新静默进行（列表保持挂载、数据原地替换），避免整卡内容切换闪烁。
   */
  const loadVersions = useCallback(
    async (options?: { initial?: boolean }) => {
      const initial = options?.initial ?? false;
      if (initial) setLoading(true);
      try {
        setError(null);
        await runScan();
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载 Python 版本失败');
      } finally {
        if (initial) setLoading(false);
      }
    },
    [runScan]
  );

  useEffect(() => {
    void loadVersions({ initial: true });
  }, [loadVersions]);

  // 跨端实时同步：任一端扫描版本 / 切换默认版本后自动刷新本页（静默，无加载态切换）
  useEffect(() => {
    const isEchoEvent = () =>
      scanBusyRef.current || Date.now() - lastScanAtRef.current < 1500;
    const offs = [
      subscribeEvent(CHANNELS.pythonScanned, () => {
        if (isEchoEvent()) return;
        void loadVersions();
      }),
      subscribeEvent(CHANNELS.pythonDefaultChanged, () => {
        if (isEchoEvent()) return;
        void loadVersions();
      }),
    ];
    return () => offs.forEach((p) => void p.then((fn) => fn()));
  }, [loadVersions]);

  const handleScan = async () => {
    logUserAction('python.scan', { manual: true });
    try {
      setScanning(true);
      setError(null);
      await runScan();
    } catch (err) {
      logUserError('python.scan.failed', { error: err instanceof Error ? err.message : String(err) });
      setError(err instanceof Error ? err.message : '扫描失败');
    } finally {
      // 与 setVersions 同批次渲染：遮罩淡出与新数据一次呈现，状态切换平滑无闪烁
      setScanning(false);
    }
  };

  const handleSetDefault = async (version: PythonVersion) => {
    logUserAction('python.set_default', { version: version.version, path: version.path });
    setActiveActionId(version.id);
    try {
      await setDefaultPython(version.path);
      setVersions((prev) =>
        prev.map((v) => ({
          ...v,
          isActive: v.id === version.id,
        }))
      );
    } catch (err) {
      logUserError('python.set_default.failed', { version: version.version, error: err instanceof Error ? err.message : String(err) });
      setError(err instanceof Error ? err.message : '设置默认版本失败');
    } finally {
      setActiveActionId(null);
    }
  };

  /** 打开解释器所在目录（桌面端系统文件管理器 / 网页端新窗口） */
  const handleOpenDirectory = async (version: PythonVersion) => {
    // 取可执行文件所在目录；路径为目录本身时直接打开
    const dir = version.path.replace(/[\\/]+$/, '').replace(/[\\/][^\\/]*$/, '');
    const target = dir || version.path;
    try {
      if (isTauri()) {
        await shellOpen(target);
      } else {
        window.open(target, '_blank');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '打开目录失败');
    }
  };

  const handleCopyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      setCopiedPath(path);
      setTimeout(() => setCopiedPath(null), 2000);
    } catch {
      console.error('复制失败');
    }
  };

  /** 真实升级 pip：python -m pip install --upgrade pip，完成后重新扫描刷新版本号 */
  const handleUpdatePip = async (version: PythonVersion) => {
    setActiveActionId(version.id);
    setError(null);
    try {
      await upgradePip(version.path);
      await handleScan();
    } catch (err) {
      setError(err instanceof Error ? err.message : `升级 pip 失败（Python ${version.version}）`);
    } finally {
      setActiveActionId(null);
    }
  };

  /** 跳转到虚拟环境页并预填此 Python 解释器 */
  const handleCreateVenv = (version: PythonVersion) => {
    navigate(
      `/environments?create=1&python=${encodeURIComponent(version.path)}`
    );
  };

  const handleRowClick = async (version: PythonVersion) => {
    try {
      const details = await getPythonDetails(version.path);
      setSelectedVersion(details);
      setDetailOpen(true);
    } catch {
      setSelectedVersion(version);
      setDetailOpen(true);
    }
  };

  /** 打开一键安装对话框（不跳转浏览器，由应用本地下载并静默安装） */
  const handleOpenInstall = (version?: string) => {
    logUserAction('python.install_dialog.open', { version });
    setInstallInitialVersion(version);
    setInstallDialogOpen(true);
  };

  /** 打开彻底卸载确认对话框（已安装列表行与可安装卡片双按钮共用此入口） */
  const handleOpenUninstall = (version: PythonVersion) => {
    logUserAction('python.uninstall_dialog.open', { version: version.version, path: version.path });
    setUninstallTarget(version);
    setUninstallDialogOpen(true);
  };

  return (
    <div className="space-y-6 w-full">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-pf-foreground truncate">Python 版本</h1>
          <p className="text-sm text-pf-muted-foreground mt-1">管理本地与远程 Python 解释器版本</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={handleScan} disabled={scanning} size="sm" className="shrink-0">
            {scanning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ScanLine className="mr-2 h-4 w-4" />}
            扫描本地版本
          </Button>
          <Button variant="outline" onClick={() => handleOpenInstall()} size="sm" className="shrink-0">
            <Download className="mr-2 h-4 w-4" />
            安装 Python 版本
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-state-error/50 bg-state-error/10 p-4 text-sm text-state-error">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="break-all">{error}</span>
        </div>
      )}

      {/* Status Bar */}
      {loading && (
        <div className="flex items-center gap-3 rounded-lg border border-pf-border bg-pf-card p-4 text-sm text-pf-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          正在加载 Python 版本信息...
        </div>
      )}

      {/* 当前默认版本卡片 */}
      {!loading && activeVersion && (
        <Card>
          <CardContent className="p-4 sm:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
              {/* 左侧：版本信息 */}
              <div className="flex items-center gap-3 min-w-0 lg:w-1/3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-pf-primary/10 text-pf-primary">
                  <Boxes className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-pf-muted-foreground">当前默认版本</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="font-mono text-base sm:text-lg font-semibold text-pf-foreground truncate">
                      Python {activeVersion.version}
                    </span>
                    <Badge variant="success" className="shrink-0 text-[10px]">活跃</Badge>
                  </div>
                </div>
              </div>

              {/* 右侧：详细信息 */}
              <div className="flex-1 min-w-0 lg:pl-6 lg:border-l lg:border-pf-border">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="text-xs text-pf-muted-foreground mb-1 flex items-center gap-1">
                      <Terminal className="h-3 w-3" />
                      pip 版本
                    </p>
                    <p className="font-mono text-pf-foreground font-medium truncate">{activeVersion.pipVersion}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-pf-muted-foreground mb-1 flex items-center gap-1">
                      <Boxes className="h-3 w-3" />
                      已安装包
                    </p>
                    <p className="font-mono text-pf-foreground font-medium truncate">{activeVersion.packagesCount} 个</p>
                  </div>
                  {activeVersion.architecture && (
                    <div className="min-w-0">
                      <p className="text-xs text-pf-muted-foreground mb-1 flex items-center gap-1">
                        <HardDrive className="h-3 w-3" />
                        架构
                      </p>
                      <p className="font-mono text-pf-foreground font-medium truncate">{activeVersion.architecture}</p>
                    </div>
                  )}
                  <div className="min-w-0 sm:col-span-3">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs text-pf-muted-foreground">安装路径</p>
                      <button
                        onClick={() => handleCopyPath(displayPath(activeVersion.path))}
                        className="text-[10px] text-pf-muted-foreground hover:text-pf-primary transition-colors"
                      >
                        {copiedPath === activeVersion.path ? '✓ 已复制' : '复制'}
                      </button>
                    </div>
                    <p
                      className="font-mono text-xs text-pf-foreground truncate"
                      title={displayPath(activeVersion.path)}
                    >
                      {displayPath(activeVersion.path)}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Installed Versions */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <CardTitle>已安装版本</CardTitle>
            {loading || scanning ? (
              // 扫描进行期间仅显示文本标签，不附带任何版本数字；扫描完成后才渲染计数
              <span className="inline-flex items-center gap-1.5 text-xs font-normal text-pf-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                扫描中…
              </span>
            ) : (
              <Badge variant="secondary">{versions.length}</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="relative">
            {loading ? (
              <div className="py-8 text-center text-pf-muted-foreground">
                <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                <span className="mt-2 block text-xs">加载中...</span>
              </div>
            ) : (
              <>
            <div className="space-y-3">
              {pagedVersions.map((version) => (
                <div
                  key={version.id}
                  className="rounded-lg border border-pf-border p-4 transition-colors hover:bg-pf-muted/30 cursor-pointer"
                  onClick={() => handleRowClick(version)}
                >
                  <div className="flex flex-col gap-3">
                    {/* 第一行：版本号 + 状态 + 操作 */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono font-medium text-pf-foreground truncate">
                          Python {version.version}
                        </span>
                        {version.isActive && (
                          <Badge className="shrink-0 text-[10px]">默认</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                        {version.isActive ? (
                          <Badge variant="success" className="text-[10px] mr-1">活跃</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] mr-1">未使用</Badge>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={version.isActive || activeActionId === version.id}
                          onClick={() => handleSetDefault(version)}
                          title="设为默认版本"
                        >
                          {activeActionId === version.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Check className="h-3.5 w-3.5" />
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleOpenDirectory(version)}
                          title="打开安装目录"
                        >
                          <FolderOpen className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleUpdatePip(version)}
                          title="更新 pip"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-pf-primary"
                          onClick={() => handleCreateVenv(version)}
                          title="用此版本创建虚拟环境"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-state-error hover:bg-state-error/10"
                          onClick={() => handleOpenUninstall(version)}
                          title="彻底卸载此版本"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    {/* 第二行：路径 + 元信息 */}
                    <div className="grid grid-cols-1 gap-2 min-w-0">
                      <div className="min-w-0">
                        <div className="flex items-center justify-between mb-0.5">
                          <p className="text-xs text-pf-muted-foreground">安装路径</p>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopyPath(displayPath(version.path));
                            }}
                            className="text-[10px] text-pf-muted-foreground hover:text-pf-primary transition-colors"
                          >
                            {copiedPath === version.path ? '✓ 已复制' : '复制'}
                          </button>
                        </div>
                        <span
                          className="font-mono text-xs text-pf-foreground block truncate"
                          title={displayPath(version.path)}
                        >
                          {displayPath(version.path)}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        {version.pipVersion && (
                          <div className="flex items-center gap-1.5 text-xs">
                            <Terminal className="h-3 w-3 text-pf-primary shrink-0" />
                            <span className="text-pf-muted-foreground">pip</span>
                            <span className="font-mono font-medium text-pf-foreground">{version.pipVersion}</span>
                          </div>
                        )}
                        {typeof version.packagesCount === 'number' && (
                          <div className="flex items-center gap-1.5 text-xs">
                            <Boxes className="h-3 w-3 text-pf-primary shrink-0" />
                            <span className="text-pf-muted-foreground">包</span>
                            <span className="font-mono font-medium text-pf-foreground">{version.packagesCount}</span>
                          </div>
                        )}
                        {version.architecture && (
                          <div className="flex items-center gap-1.5 text-xs">
                            <HardDrive className="h-3 w-3 text-pf-primary shrink-0" />
                            <span className="text-pf-muted-foreground">架构</span>
                            <span className="font-mono font-medium text-pf-foreground">{version.architecture}</span>
                          </div>
                        )}
                        {version.lastUsed && version.lastUsed !== '-' && (
                          <div className="flex items-center gap-1.5 text-xs">
                            <Clock className="h-3 w-3 text-pf-primary shrink-0" />
                            <span className="text-pf-muted-foreground">最近使用</span>
                            <span className="font-mono font-medium text-pf-foreground">{version.lastUsed}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {versions.length === 0 && (
                <div className="py-8 text-center text-pf-muted-foreground">
                  未检测到已安装的 Python 版本，点击「扫描本地版本」重新检测。
                </div>
              )}
            </div>

            {versions.length > 0 && (
              <Pagination
                className="mt-4 border-t border-pf-border pt-3"
                page={installedPage}
                pageSize={pageSize}
                total={versions.length}
                onPageChange={setInstalledPage}
                onPageSizeChange={handleInstalledPageSizeChange}
              />
            )}
            </>
          )}

            {/* 扫描遮罩：不透明覆盖旧数据（扫描期间不显示任何版本数字），
                列表保持挂载、高度零变化，避免内容卸载/重挂导致的闪屏 */}
            {scanning && !loading && (
              <div
                className="pf-fade-in absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-lg bg-pf-card text-pf-muted-foreground"
                aria-busy="true"
              >
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-xs">正在扫描本地 Python 版本...</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Available Versions */}
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
          <h3 className="text-sm font-semibold text-pf-foreground">可安装版本</h3>
          {/* 平台切换 */}
          <div className="flex items-center gap-1 rounded-lg border border-pf-border bg-pf-card p-1">
            {(['windows', 'macos', 'linux'] as const).map((platform) => (
              <button
                key={platform}
                onClick={() => setSelectedPlatform(platform)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  selectedPlatform === platform
                    ? 'bg-pf-primary text-pf-primary-foreground'
                    : 'text-pf-muted-foreground hover:bg-pf-muted'
                }`}
              >
                {platform === 'windows' ? 'Windows' : platform === 'macos' ? 'macOS' : 'Linux'}
              </button>
            ))}
          </div>
        </div>

        {/* 数据来源说明 */}
        {releasesError ? (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-state-error/40 bg-state-error/10 px-3 py-2 text-xs text-state-error">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span>
              获取 python.org 官方版本列表失败：
              {releasesError}
            </span>
          </div>
        ) : pythonReleases.length > 0 ? (
          <div className="mb-3 flex items-center gap-2 text-xs text-pf-muted-foreground">
            <Check className="h-3.5 w-3.5 text-state-success" />
            <span>
              数据来自 python.org 官方发布，已过滤预发布版本（alpha / beta / rc），
              仅列出稳定的 Python 3 版本，按发布时间倒序显示前 {installableVersions.length} 个。
            </span>
          </div>
        ) : (
          <div className="mb-3 flex items-center gap-2 text-xs text-pf-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>正在从 python.org 获取官方稳定版本列表...</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {pagedInstallableVersions.map((item) => {
            // 需求③：已安装判定 → 双按钮（此版本已安装 + 卸载），卸载复用已安装列表流程
            const installed = findInstalledMatch(item.version, versions);
            return (
            <div
              key={item.version}
              className="flex flex-col gap-3 rounded-lg border border-pf-border bg-pf-card p-4 transition-colors hover:border-pf-muted-foreground min-w-0"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono font-medium text-pf-foreground truncate">
                  Python {item.version}
                </span>
                <Badge variant={item.label === '最新稳定版' ? 'default' : 'outline'} className="shrink-0 text-[10px]">
                  {item.label}
                </Badge>
              </div>

              {/* 发布信息 */}
              <div className="flex items-center gap-2 text-xs text-pf-muted-foreground">
                <span className="truncate">{item.releaseDate}</span>
              </div>

              {/* 平台下载选项 */}
              <div className="flex flex-wrap gap-1.5">
                {selectedPlatform === 'windows' && (
                  <>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-pf-muted text-pf-muted-foreground">
                      Windows Installer (64-bit)
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-pf-muted text-pf-muted-foreground">
                      Windows Installer (32-bit)
                    </span>
                  </>
                )}
                {selectedPlatform === 'macos' && (
                  <>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-pf-muted text-pf-muted-foreground">
                      macOS 64-bit universal2
                    </span>
                  </>
                )}
                {selectedPlatform === 'linux' && (
                  <>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-pf-muted text-pf-muted-foreground">
                      Gzipped source tarball
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-pf-muted text-pf-muted-foreground">
                      XZ tarball
                    </span>
                  </>
                )}
              </div>

              {installed ? (
                // 安装成功后的状态切换：与已安装列表按钮样式统一（并排双按钮）
                <div className="flex w-full gap-2">
                  <Button size="sm" variant="outline" disabled className="flex-1 min-w-0">
                    <Check className="mr-1 h-3 w-3 shrink-0" />
                    此版本已安装
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="shrink-0 text-state-error hover:bg-state-error/10"
                    onClick={() => handleOpenUninstall(installed)}
                    title="彻底卸载此版本（复用已安装列表同一卸载流程）"
                  >
                    <Trash2 className="mr-1 h-3 w-3" />
                    卸载
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  onClick={() => handleOpenInstall(item.version)}
                  className="w-full"
                >
                  <Download className="mr-1 h-3 w-3" />
                  安装此版本
                </Button>
              )}
            </div>
            );
          })}
        </div>

        {installableVersions.length > 0 && (
          <Pagination
            className="mt-4"
            page={installablePage}
            pageSize={pageSize}
            total={installableVersions.length}
            onPageChange={setInstallablePage}
            onPageSizeChange={handleInstallablePageSizeChange}
          />
        )}
      </div>

      {/* Version Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-md w-[calc(100vw-2rem)]">
          <DialogHeader>
            <DialogTitle>版本详情</DialogTitle>
            <DialogDescription>
              查看 {selectedVersion ? `Python ${selectedVersion.version}` : '所选版本'} 的详细信息。
            </DialogDescription>
          </DialogHeader>
          {selectedVersion && (
            <div className="space-y-6">
              <div className="space-y-3">
                {[
                  { label: '版本号', value: selectedVersion.version },
                  { label: '发布日期', value: selectedVersion.releaseDate ?? '-' },
                  { label: '安装路径', value: displayPath(selectedVersion.path) },
                  { label: '架构', value: selectedVersion.architecture ?? '-' },
                  { label: '包管理器', value: selectedVersion.pipVersion ? `pip ${selectedVersion.pipVersion}` : '-' },
                  { label: '已安装包', value: `${selectedVersion.packagesCount ?? 0} 个` },
                  { label: '最近使用', value: selectedVersion.lastUsed ?? '-' },
                  { label: '状态', value: selectedVersion.isActive ? '活跃' : '未使用' },
                ].map((row) => (
                  <div key={row.label} className="flex items-start justify-between gap-4 text-sm">
                    <span className="text-pf-muted-foreground shrink-0">{row.label}</span>
                    <span className={`font-mono text-pf-foreground text-right break-all ${row.label === '状态' ? 'font-sans' : ''}`}>
                      {row.value}
                    </span>
                  </div>
                ))}
              </div>

              {selectedVersion.dependencies && selectedVersion.dependencies.length > 0 && (
                <div className="border-t border-pf-border pt-4">
                  <h4 className="mb-3 text-sm font-semibold text-pf-foreground">依赖包</h4>
                  <div className="space-y-2">
                    {selectedVersion.dependencies.map((dep) => (
                      <div key={`${dep.name}-${dep.version}`} className="flex items-center gap-2 text-sm text-pf-muted-foreground">
                        <Terminal className="h-3.5 w-3.5 text-pf-primary shrink-0" />
                        <span className="font-mono truncate">{dep.name}</span>
                        <span className="text-pf-border">·</span>
                        <span className="shrink-0">{dep.version}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedVersion.envVars && selectedVersion.envVars.length > 0 && (
                <div className="border-t border-pf-border pt-4">
                  <h4 className="mb-3 text-sm font-semibold text-pf-foreground">环境变量</h4>
                  <div className="space-y-2">
                    {selectedVersion.envVars.map((env) => (
                      <div
                        key={env.key}
                        className="rounded-md bg-pf-muted p-2 font-mono text-xs text-pf-foreground break-all"
                      >
                        {env.key}={env.value}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailOpen(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 一键安装对话框（头部入口与可安装卡片共用；版本由入口预选） */}
      <InstallPythonDialog
        open={installDialogOpen}
        onOpenChange={setInstallDialogOpen}
        releases={pythonReleases}
        initialVersion={installInitialVersion}
        platform={runtimePlatform}
        defaultBaseDir={defaultBaseDir}
        onInstalled={() => {
          // 后端安装完成后已自动重扫并广播 pythonScanned，这里显式再扫一次兜底
          void handleScan();
        }}
      />

      {/* 彻底卸载确认对话框 */}
      <UninstallPythonDialog
        open={uninstallDialogOpen}
        onOpenChange={setUninstallDialogOpen}
        target={uninstallTarget}
        platform={runtimePlatform}
        onUninstalled={() => {
          void handleScan();
        }}
      />
    </div>
  );
};
