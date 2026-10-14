import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  Download,
  Globe,
  Loader2,
  PackagePlus,
  RefreshCw,
  Search,
  Trash2,
  Zap,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Pagination } from '@/components/ui/Pagination';
import { Select, SelectItem } from '@/components/ui/Select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import {
  measureDomesticMirrorSpeeds,
  measureMirrorSpeed,
  sortMirrors,
  isOfficialMirror,
} from '@/lib/mirror-registry';
import {
  CHANNELS,
  getMirrors,
  installPackage,
  listInstalledPackages,
  listVenvs,
  scanPythonVersions,
  searchPackage,
  setMirror,
  subscribeEvent,
  testMirrorSpeed,
  uninstallPackage,
  upgradeAllPackages,
} from '@/lib/tauri-api';
import type { VirtualEnvironment } from '@/types/environments';
import type { Package, PipMirror } from '@/types/packages';
import { usePrefsStore } from '@/store/useAppStore';
import { logUserAction, logUserError } from '@/lib/user-log';

function formatLatency(latencyMs?: number): { text: string; color: string } {
  if (latencyMs === undefined) return { text: '超时', color: 'text-error' };
  if (latencyMs <= 20) return { text: `${latencyMs}ms`, color: 'text-success' };
  if (latencyMs <= 50) return { text: `${latencyMs}ms`, color: 'text-warning' };
  return { text: `${latencyMs}ms`, color: 'text-error' };
}

function getSpeedBarWidth(latencyMs?: number): string {
  if (latencyMs === undefined || latencyMs <= 0) return '0%';
  const maxLatency = 200;
  const percentage = Math.min(100, Math.max(5, (maxLatency / latencyMs) * 100));
  return `${percentage.toFixed(0)}%`;
}

export const Packages: React.FC = () => {
  const [mirrors, setMirrors] = useState<PipMirror[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Package[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedPackages, setSelectedPackages] = useState<string[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  // 目标环境（真实虚拟环境列表，value 为环境路径）
  const [targetEnv, setTargetEnv] = useState('');
  const [targetEnvs, setTargetEnvs] = useState<VirtualEnvironment[]>([]);
  const [installInput, setInstallInput] = useState('');
  const [isInstalling, setIsInstalling] = useState(false);
  const [terminalLines, setTerminalLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testingIds, setTestingIds] = useState<Set<string>>(new Set());
  const [applyLoading, setApplyLoading] = useState(false);
  const [installedPackages, setInstalledPackages] = useState<Package[]>([]);
  // 已安装包扫描来源（当前活跃 Python 环境），安装/升级/卸载操作均作用于此环境
  const [activeEnvPath, setActiveEnvPath] = useState('');
  const [speedTestingAll, setSpeedTestingAll] = useState(false);
  const terminalRef = useRef<HTMLDivElement>(null);

  // 已安装包统一分页（与全局每页条数偏好联动，默认 10）
  const pageSize = usePrefsStore((s) => s.pageSize);
  const setPageSize = usePrefsStore((s) => s.setPageSize);
  const [installedPkgPage, setInstalledPkgPage] = useState(1);
  const pagedInstalledPackages = useMemo(
    () =>
      installedPackages.slice(
        (installedPkgPage - 1) * pageSize,
        installedPkgPage * pageSize
      ),
    [installedPackages, installedPkgPage, pageSize]
  );
  const installedPkgTotalPages = Math.max(
    1,
    Math.ceil(installedPackages.length / pageSize)
  );

  useEffect(() => {
    setInstalledPkgPage((prev) => Math.min(prev, installedPkgTotalPages));
  }, [installedPkgTotalPages]);

  const activeMirror = useMemo(() => mirrors.find((m) => m.isActive) ?? mirrors[0], [mirrors]);
  // 官方源保持固定顺序置末尾；国内源按延迟升序、超时排末尾
  const sortedMirrors = useMemo(() => sortMirrors(mirrors), [mirrors]);

  /** 并发测速所有国内镜像源（3000ms 超时），官方源不参与 */
  const runDomesticSpeedTests = async (list: PipMirror[]) => {
    setSpeedTestingAll(true);
    try {
      const results = await measureDomesticMirrorSpeeds(list, testMirrorSpeed);
      setMirrors((prev) =>
        prev.map((m) =>
          results.has(m.id) ? { ...m, latencyMs: results.get(m.id) } : m
        )
      );
    } finally {
      setSpeedTestingAll(false);
    }
  };

  const addTerminalLine = (line: string) => {
    setTerminalLines((prev) => [...prev, line]);
    setTimeout(() => {
      terminalRef.current?.scrollTo({ top: terminalRef.current.scrollHeight, behavior: 'smooth' });
    }, 0);
  };

  /** 已安装包刷新（当前活跃 Python 环境的真实包列表） */
  const reloadInstalled = useCallback(
    async (pythonPath: string) => {
      const target = pythonPath || activeEnvPath;
      if (!target) return;
      try {
        const installed = await listInstalledPackages(target);
        setInstalledPackages(installed);
      } catch (err) {
        setError(err instanceof Error ? err.message : '刷新已安装包失败');
      }
    },
    [activeEnvPath]
  );

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const [mirrorData, pythons, venvs] = await Promise.all([
          getMirrors(),
          scanPythonVersions(),
          listVenvs(),
        ]);
        if (!mounted) return;

        // Prefer active Python; fallback to first available path for installed package scan.
        const pythonPath =
          pythons.find((p) => p.isActive)?.path ?? pythons[0]?.path ?? '';
        const installed = pythonPath ? await listInstalledPackages(pythonPath) : [];
        if (!mounted) return;

        setMirrors(mirrorData);
        setInstalledPackages(installed);
        setActiveEnvPath(pythonPath);
        setTargetEnvs(venvs);
        if (venvs[0]) {
          setTargetEnv(venvs[0].path);
        }
        // 终端初始输出：来自真实后端的当前镜像源与真实包数量
        const currentUrl = mirrorData.find((m) => m.isActive)?.url ?? 'https://pypi.org/simple';
        addTerminalLine('$ pip config get global.index-url');
        addTerminalLine(currentUrl);
        addTerminalLine(`$ pip list | wc -l`);
        addTerminalLine(String(installed.length));
        // 启动加载即对国内镜像源自动测速并按延迟排序
        void runDomesticSpeedTests(mirrorData);
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : '加载包与镜像源数据失败');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, []);

  // 跨端实时同步：任一端切换镜像源 / 安装卸载包后自动刷新本页
  useEffect(() => {
    const offs = [
      subscribeEvent(CHANNELS.mirrorChanged, () => void refreshMirrors()),
      subscribeEvent(CHANNELS.packageChanged, () => void reloadInstalled(activeEnvPath)),
    ];
    return () => offs.forEach((p) => void p.then((fn) => fn()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEnvPath]);

  /** 手动刷新：重新拉取镜像源列表并自动测速排序 */
  const refreshMirrors = async () => {
    try {
      const data = await getMirrors();
      setMirrors(data);
      void runDomesticSpeedTests(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '刷新镜像源失败');
    }
  };

  const handleTestSpeed = async (id: string) => {
    const mirror = mirrors.find((m) => m.id === id);
    if (!mirror) return;
    setTestingIds((prev) => new Set(prev).add(id));
    logUserAction(`镜像源测速: ${mirror.name} (${mirror.url})`);
    try {
      // 单源测速同样遵循 3000ms 超时阈值，超时显示「超时」并排至末尾
      const latency = await measureMirrorSpeed(mirror, testMirrorSpeed);
      logUserAction(`镜像源测速: ${mirror.name} 完成，延迟=${latency ?? '超时'}ms`);
      setMirrors((prev) =>
        prev.map((m) => (m.id === id ? { ...m, latencyMs: latency } : m))
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : `测试 ${mirror.name} 速度失败`;
      logUserError(`镜像源测速: ${mirror.name} 失败 - ${msg}`);
      setError(msg);
    } finally {
      setTestingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleRetestAll = async () => {
    await runDomesticSpeedTests(mirrors);
  };

  const handleSetActive = (id: string) => {
    setMirrors((prev) => prev.map((mirror) => ({ ...mirror, isActive: mirror.id === id })));
  };

  const handleApplyMirror = async () => {
    if (!activeMirror) return;
    setApplyLoading(true);
    logUserAction(`切换镜像源: ${activeMirror.name} (${activeMirror.url})`);
    try {
      await setMirror(activeMirror.url);
      addTerminalLine(`$ pip config set global.index-url ${activeMirror.url}`);
      addTerminalLine(`已切换至 ${activeMirror.name} 镜像源`);
      logUserAction(`切换镜像源: ${activeMirror.name} 成功`);
      await refreshMirrors();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '应用镜像源失败';
      logUserError(`切换镜像源: ${activeMirror.name} 失败 - ${msg}`);
      setError(msg);
    } finally {
      setApplyLoading(false);
    }
  };

  const handleSearch = async () => {
    const query = searchQuery.trim();
    setIsSearching(true);
    setError(null);
    try {
      const results = await searchPackage(query);
      setSearchResults(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : '搜索包失败');
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleQuickPackageClick = async (name: string) => {
    setSearchQuery(name);
    setIsSearching(true);
    try {
      const results = await searchPackage(name);
      setSearchResults(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : '搜索包失败');
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  /** 常用包快捷入口：由真实已安装包列表派生 */
  const quickPackageChips = useMemo(
    () => installedPackages.slice(0, 6).map((p) => p.name),
    [installedPackages]
  );

  const togglePackageSelection = (name: string) => {
    setSelectedPackages((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );
  };

  const openInstallDialog = () => {
    const names = selectedPackages.length > 0 ? selectedPackages.join(' ') : searchQuery.trim();
    setInstallInput(names);
    setDialogOpen(true);
  };

  /** 安装包：调用后端真实 pip 安装（目标为所选虚拟环境），终端输出真实 pip 日志 */
  const handleInstall = async () => {
    const names = installInput.trim().split(/\s+/).filter(Boolean);
    if (names.length === 0) return;
    if (!targetEnv) {
      setError('未选择目标虚拟环境，请先在「环境管理」页创建');
      return;
    }
    setDialogOpen(false);
    setIsInstalling(true);
    addTerminalLine(`$ pip install ${names.join(' ')}`);
    if (activeMirror) {
      addTerminalLine(`Looking in indexes: ${activeMirror.url}`);
    }
    let ok = 0;
    for (const name of names) {
      try {
        const output = await installPackage(targetEnv, name);
        const trimmed = output.trim();
        if (trimmed) addTerminalLine(trimmed);
        ok += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        addTerminalLine(`✗ 安装 ${name} 失败：${msg}`);
        setError(`安装 ${name} 失败：${msg}`);
      }
    }
    addTerminalLine(`✓ 执行完成：${ok}/${names.length} 个包安装成功`);
    setIsInstalling(false);
    setSelectedPackages([]);
    await reloadInstalled(activeEnvPath);
  };

  /** 升级包：安装最新版本（后端真实执行） */
  const handleUpgrade = async (pkg: Package) => {
    addTerminalLine(`$ pip install --upgrade ${pkg.name}`);
    try {
      const output = await installPackage(activeEnvPath, pkg.name, pkg.latestVersion);
      const trimmed = output.trim();
      if (trimmed) addTerminalLine(trimmed);
      addTerminalLine(`✓ ${pkg.name} 已升级至 ${pkg.latestVersion ?? '最新版本'}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addTerminalLine(`✗ 升级 ${pkg.name} 失败：${msg}`);
      setError(`升级 ${pkg.name} 失败：${msg}`);
    }
    await reloadInstalled(activeEnvPath);
  };

  /** 卸载包：后端真实执行 pip uninstall */
  const handleUninstall = async (pkg: Package) => {
    addTerminalLine(`$ pip uninstall -y ${pkg.name}`);
    try {
      const output = await uninstallPackage(activeEnvPath, pkg.name);
      const trimmed = output.trim();
      if (trimmed) addTerminalLine(trimmed);
      addTerminalLine(`✓ 已卸载 ${pkg.name} ${pkg.version}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addTerminalLine(`✗ 卸载 ${pkg.name} 失败：${msg}`);
      setError(`卸载 ${pkg.name} 失败：${msg}`);
    }
    await reloadInstalled(activeEnvPath);
  };

  /** 一键更新所有过时包：后端真实执行 */
  const handleUpgradeAll = async () => {
    if (!activeEnvPath) {
      setError('未检测到可用的 Python 环境');
      return;
    }
    setIsInstalling(true);
    addTerminalLine('$ pip install --upgrade <所有过时包>');
    try {
      const output = await upgradeAllPackages(activeEnvPath);
      const trimmed = output.trim();
      if (trimmed) addTerminalLine(trimmed);
      addTerminalLine('✓ 过时包更新完成');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addTerminalLine(`✗ 批量更新失败：${msg}`);
      setError(`批量更新失败：${msg}`);
    }
    setIsInstalling(false);
    await reloadInstalled(activeEnvPath);
  };

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h2 className="pf-text-display text-2xl text-foreground">包与镜像源</h2>
        <p className="text-muted-foreground">管理依赖包与 PyPI 镜像源配置</p>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-state-error/50 bg-state-error/10 p-4 text-sm text-state-error">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-3 rounded-lg border border-pf-border bg-pf-card p-4 text-sm text-pf-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在加载镜像源与已安装包数据...
        </div>
      )}

      {/* Main split panel */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* Left panel: mirror sources */}
        <section className="flex w-full flex-col gap-5 lg:w-[40%] lg:flex-shrink-0">
          {/* 镜像源统一功能容器：配置 + 速度测试整合在同一卡片内 */}
          <Card className="p-5">
            <div className="mb-4 flex items-center gap-2">
              <Globe className="h-[18px] w-[18px] text-primary" />
              <h3 className="pf-text-heading text-base font-semibold">镜像源配置</h3>
              <span className="flex-1" />
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-primary"
                onClick={() => void refreshMirrors()}
                disabled={speedTestingAll}
              >
                <RefreshCw className={`h-3 w-3 ${speedTestingAll ? 'animate-spin' : ''}`} />
                刷新测速
              </Button>
            </div>

            {/* Current source banner */}
            {activeMirror && (
              <div className="mb-3.5 flex items-center gap-2.5 rounded-lg border border-border bg-muted p-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-foreground">{activeMirror.name}</div>
                  <div className="text-xs text-muted-foreground">当前使用的镜像源</div>
                </div>
                <Badge>当前使用</Badge>
                <span
                  className={`min-w-[44px] text-right font-mono text-sm ${formatLatency(activeMirror.latencyMs).color}`}
                >
                  {formatLatency(activeMirror.latencyMs).text}
                </span>
              </div>
            )}

            {/* Mirror list：国内源按延迟升序、超时置末尾；官方源保持固定顺序置后 */}
            <div className="space-y-0">
              {sortedMirrors.map((mirror) => {
                const latency = formatLatency(mirror.latencyMs);
                const isTesting = testingIds.has(mirror.id) || (speedTestingAll && isOfficialMirror(mirror) === false);
                const official = isOfficialMirror(mirror);
                return (
                  <div
                    key={mirror.id}
                    className="flex items-center gap-3 border-b border-border py-2.5 last:border-b-0"
                  >
                    <button
                      type="button"
                      onClick={() => handleSetActive(mirror.id)}
                      className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border-[1.5px] ${
                        mirror.isActive ? 'border-primary' : 'border-muted-foreground/60'
                      }`}
                      aria-label={mirror.isActive ? '当前选中' : '设为活动源'}
                    >
                      {mirror.isActive && <span className="h-2 w-2 rounded-full bg-primary" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium text-foreground">{mirror.name}</span>
                        {official && (
                          <Badge variant="outline" className="shrink-0 px-1 py-0 text-[9px] text-muted-foreground">
                            官方·不排序
                          </Badge>
                        )}
                      </div>
                      <div className="truncate font-mono text-xs text-muted-foreground">
                        {mirror.url}
                      </div>
                    </div>
                    <span
                      className={`min-w-[44px] flex-shrink-0 text-right font-mono text-xs ${latency.color}`}
                    >
                      {isTesting ? <Loader2 className="mx-auto h-3 w-3 animate-spin" /> : latency.text}
                    </span>
                    {!official && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-muted-foreground hover:text-primary"
                        onClick={() => handleTestSpeed(mirror.id)}
                        disabled={isTesting}
                      >
                        测试
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>

            <Button className="mt-4 w-full" onClick={handleApplyMirror} disabled={applyLoading || !activeMirror}>
              {applyLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              应用镜像源
            </Button>

            {/* 分区内标题：速度测试（与上方配置区以分隔线衔接） */}
            <div className="mt-5 border-t border-border pt-4">
              <div className="mb-3 flex items-center gap-2">
                <Activity className="h-[18px] w-[18px] text-primary" />
                <h4 className="pf-text-heading text-sm font-semibold">速度测试</h4>
                <span className="text-xs text-muted-foreground">Top 5 延迟对比</span>
              </div>
              <div className="space-y-3">
                {sortedMirrors.slice(0, 5).map((mirror) => (
                  <div key={`speed-${mirror.id}`} className="flex items-center gap-2.5">
                    <span className="w-16 flex-shrink-0 text-xs text-foreground">{mirror.name}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-[width] duration-300"
                        style={{ width: getSpeedBarWidth(mirror.latencyMs) }}
                      />
                    </div>
                    <span className="w-11 flex-shrink-0 text-right font-mono text-xs text-muted-foreground">
                      {formatLatency(mirror.latencyMs).text}
                    </span>
                  </div>
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-3 gap-1.5 text-xs"
                onClick={handleRetestAll}
                disabled={testingIds.size > 0 || speedTestingAll}
              >
                <RefreshCw className={`h-3 w-3 ${speedTestingAll ? 'animate-spin' : ''}`} />
                {speedTestingAll ? '测速中...' : '重新测试'}
              </Button>
            </div>
          </Card>
        </section>

        {/* Right panel: package management */}
        <section className="flex min-w-0 flex-1 flex-col gap-5">
          {/* Package search / install card */}
          <Card className="p-4">
            <div className="mb-4 flex items-center gap-2">
              <PackagePlus className="h-[18px] w-[18px] text-primary" />
              <h3 className="pf-text-heading text-sm font-semibold">安装包</h3>
            </div>

            <div className="mb-3 flex items-center gap-2 rounded-lg border border-border bg-muted p-2.5">
              <Search className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
              <Input
                placeholder="搜索包名，如 numpy, flask, django..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                className="h-8 border-0 bg-transparent px-0 text-sm font-mono focus-visible:ring-0"
              />
              <Button size="sm" onClick={handleSearch} disabled={isSearching}>
                {isSearching ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
                搜索
              </Button>
            </div>

            <div className="mb-3 flex flex-wrap gap-2">
              {quickPackageChips.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => handleQuickPackageClick(name)}
                  className="rounded-full border border-border px-3 py-1 font-mono text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                >
                  {name}
                </button>
              ))}
            </div>

            {/* Search results */}
            <div className="mb-3 rounded-lg border border-border">
              {searchResults.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  {searchQuery.trim() ? '未找到匹配的包' : '输入关键词搜索 PyPI 包'}
                </div>
              ) : (
                searchResults.map((pkg) => (
                  <div
                    key={pkg.id}
                    className="flex items-center gap-3 border-b border-border p-3 last:border-b-0 hover:bg-muted/50"
                  >
                    <input
                      type="checkbox"
                      checked={selectedPackages.includes(pkg.name)}
                      onChange={() => togglePackageSelection(pkg.name)}
                      className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-sm font-medium text-foreground">{pkg.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{pkg.description}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-xs text-muted-foreground">{pkg.version}</div>
                      <div className="font-mono text-xs text-muted-foreground">{pkg.size}</div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                className="gap-1.5"
                onClick={openInstallDialog}
                disabled={isInstalling}
              >
                <Download className="h-3.5 w-3.5" />
                安装
              </Button>
              <Select
                value={targetEnv}
                onChange={(e) => setTargetEnv(e.target.value)}
                className="min-w-[140px] appearance-none text-sm"
              >
                {targetEnvs.map((env) => (
                  <SelectItem key={env.path} value={env.path}>
                    {env.name}
                  </SelectItem>
                ))}
              </Select>
            </div>
          </Card>

          {/* Installed packages table */}
          <Card className="overflow-hidden">
            <div className="flex items-center gap-2 p-4 pb-0">
              <h3 className="pf-text-heading text-sm font-semibold">已安装包</h3>
              <span className="font-mono text-sm font-semibold text-primary">{installedPackages.length}</span>
              <span className="flex-1" />
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-primary hover:text-primary"
                onClick={() => void handleUpgradeAll()}
                disabled={isInstalling || !activeEnvPath}
              >
                {isInstalling ? '更新中...' : '更新全部'}
              </Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>包名</TableHead>
                  <TableHead>版本</TableHead>
                  <TableHead>最新版本</TableHead>
                  <TableHead>大小</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                      <span className="mt-2 block text-xs">加载中...</span>
                    </TableCell>
                  </TableRow>
                ) : (
                  pagedInstalledPackages.map((pkg) => {
                    const hasUpdate = pkg.latestVersion && pkg.latestVersion !== pkg.version;
                    return (
                      <TableRow key={pkg.id}>
                        <TableCell className="font-mono font-medium">{pkg.name}</TableCell>
                        <TableCell className="font-mono text-muted-foreground">{pkg.version}</TableCell>
                        <TableCell className="font-mono text-muted-foreground">{pkg.latestVersion ?? '-'}</TableCell>
                        <TableCell className="font-mono text-muted-foreground">{pkg.size ?? '-'}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            {hasUpdate && (
                              <button
                                type="button"
                                onClick={() => handleUpgrade(pkg)}
                                className="flex items-center gap-1 text-xs text-primary hover:underline"
                              >
                                <Zap className="h-3 w-3" />
                                升级
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleUninstall(pkg)}
                              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-error hover:underline"
                            >
                              <Trash2 className="h-3 w-3" />
                              卸载
                            </button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
                {!loading && installedPackages.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      未检测到已安装包
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            {installedPackages.length > 0 && (
              <Pagination
                className="border-t border-border p-3"
                page={installedPkgPage}
                pageSize={pageSize}
                total={installedPackages.length}
                onPageChange={setInstalledPkgPage}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setInstalledPkgPage(1);
                }}
              />
            )}
          </Card>
        </section>
      </div>

      {/* Terminal / output panel */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-border bg-muted px-4 py-2">
          <div className="flex items-center gap-2">
            <div className="h-2.5 w-2.5 rounded-full bg-error" />
            <div className="h-2.5 w-2.5 rounded-full bg-warning" />
            <div className="h-2.5 w-2.5 rounded-full bg-success" />
          </div>
          <span className="font-mono text-xs text-muted-foreground">install.log</span>
        </div>
        <div
          ref={terminalRef}
          className="max-h-48 overflow-y-auto bg-neutral-950 p-3 font-mono text-xs text-foreground"
        >
          {terminalLines.map((line, index) => (
            <div key={index} className="truncate py-0.5">
              {line.startsWith('$') ? (
                <>
                  <span className="text-primary">$</span>
                  <span className="text-foreground">{line.slice(1)}</span>
                </>
              ) : (
                <span className="text-muted-foreground">{line}</span>
              )}
            </div>
          ))}
          {isInstalling && (
            <div className="py-0.5">
              <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-primary" />
            </div>
          )}
        </div>
      </Card>

      {/* Install package dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>安装包</DialogTitle>
            <DialogDescription>输入要安装的包名，多个包用空格分隔。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label htmlFor="package-names" className="text-sm font-medium text-foreground">
                包名
              </label>
              <Input
                id="package-names"
                placeholder="例如：numpy pandas flask"
                value={installInput}
                onChange={(e) => setInstallInput(e.target.value)}
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="target-env" className="text-sm font-medium text-foreground">
                目标环境
              </label>
              <Select
                id="target-env"
                value={targetEnv}
                onChange={(e) => setTargetEnv(e.target.value)}
              >
                {targetEnvs.map((env) => (
                  <SelectItem key={env.path} value={env.path}>
                    {env.name}
                  </SelectItem>
                ))}
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={() => void handleInstall()} disabled={!installInput.trim() || !targetEnv || isInstalling}>
              {isInstalling ? '安装中...' : '安装'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
