import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  getMirrors,
  listInstalledPackages,
  listVenvs,
  quickPackages,
  scanPythonVersions,
  searchPackage,
  setMirror,
  testMirrorSpeed,
} from '@/lib/tauri-api';
import type { Package, PipMirror } from '@/types/packages';

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
  const [targetEnv, setTargetEnv] = useState('');
  const [targetEnvs, setTargetEnvs] = useState<string[]>([]);
  const [installInput, setInstallInput] = useState('');
  const [isInstalling, setIsInstalling] = useState(false);
  const [terminalLines, setTerminalLines] = useState<string[]>([
    '$ pip config get global.index-url',
    'https://pypi.tuna.tsinghua.edu.cn',
    '$ pip list | wc -l',
    '248',
  ]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testingIds, setTestingIds] = useState<Set<string>>(new Set());
  const [applyLoading, setApplyLoading] = useState(false);
  const [installedPackages, setInstalledPackages] = useState<Package[]>([]);
  const terminalRef = useRef<HTMLDivElement>(null);

  const activeMirror = useMemo(() => mirrors.find((m) => m.isActive) ?? mirrors[0], [mirrors]);
  const sortedMirrors = useMemo(
    () => [...mirrors].sort((a, b) => (a.latencyMs ?? Infinity) - (b.latencyMs ?? Infinity)),
    [mirrors]
  );

  const addTerminalLine = (line: string) => {
    setTerminalLines((prev) => [...prev, line]);
    setTimeout(() => {
      terminalRef.current?.scrollTo({ top: terminalRef.current.scrollHeight, behavior: 'smooth' });
    }, 0);
  };

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
        const installed = await listInstalledPackages(pythonPath);
        if (!mounted) return;

        setMirrors(mirrorData);
        setInstalledPackages(installed);
        setTargetEnvs(venvs.map((env) => env.name));
        if (venvs[0]) {
          setTargetEnv(venvs[0].name);
        }
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

  const refreshMirrors = async () => {
    try {
      const data = await getMirrors();
      setMirrors(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '刷新镜像源失败');
    }
  };

  const handleTestSpeed = async (id: string) => {
    const mirror = mirrors.find((m) => m.id === id);
    if (!mirror) return;
    setTestingIds((prev) => new Set(prev).add(id));
    try {
      const latency = await testMirrorSpeed(mirror.url);
      setMirrors((prev) =>
        prev.map((m) => (m.id === id ? { ...m, latencyMs: latency } : m))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : `测试 ${mirror.name} 速度失败`);
    } finally {
      setTestingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleRetestAll = async () => {
    await Promise.all(
      mirrors.map(async (mirror) => {
        try {
          const latency = await testMirrorSpeed(mirror.url);
          setMirrors((prev) =>
            prev.map((m) => (m.id === mirror.id ? { ...m, latencyMs: latency } : m))
          );
        } catch {
          setMirrors((prev) =>
            prev.map((m) => (m.id === mirror.id ? { ...m, latencyMs: undefined } : m))
          );
        }
      })
    );
  };

  const handleSetActive = (id: string) => {
    setMirrors((prev) => prev.map((mirror) => ({ ...mirror, isActive: mirror.id === id })));
  };

  const handleApplyMirror = async () => {
    if (!activeMirror) return;
    setApplyLoading(true);
    try {
      await setMirror(activeMirror.url);
      addTerminalLine(`$ pip config set global.index-url ${activeMirror.url}`);
      addTerminalLine(`已切换至 ${activeMirror.name} 镜像源`);
      await refreshMirrors();
    } catch (err) {
      setError(err instanceof Error ? err.message : '应用镜像源失败');
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

  const handleInstall = () => {
    const names = installInput.trim();
    if (!names) return;
    setDialogOpen(false);
    setIsInstalling(true);
    addTerminalLine(`$ pip install ${names}`);
    if (activeMirror) {
      addTerminalLine(`Looking in indexes: ${activeMirror.url}`);
    }

    const steps = [
      'Collecting packages...',
      'Downloading packages...',
      'Installing collected packages...',
      `Successfully installed ${names}`,
    ];

    steps.forEach((step, index) => {
      setTimeout(() => {
        addTerminalLine(step);
        if (index === steps.length - 1) {
          setIsInstalling(false);
          setSelectedPackages([]);
        }
      }, (index + 1) * 800);
    });
  };

  const handleUpgrade = (pkg: Package) => {
    addTerminalLine(`$ pip install --upgrade ${pkg.name}`);
    addTerminalLine(` upgrading ${pkg.name} ${pkg.version} -> ${pkg.latestVersion ?? pkg.version}`);
    addTerminalLine(`Successfully installed ${pkg.name}-${pkg.latestVersion ?? pkg.version}`);
  };

  const handleUninstall = (pkg: Package) => {
    addTerminalLine(`$ pip uninstall -y ${pkg.name}`);
    addTerminalLine(`Found existing installation: ${pkg.name} ${pkg.version}`);
    addTerminalLine(`Uninstalling ${pkg.name}-${pkg.version}`);
    addTerminalLine(`Successfully uninstalled ${pkg.name}-${pkg.version}`);
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
          {/* Mirror config card */}
          <Card className="p-5">
            <div className="mb-4 flex items-center gap-2">
              <Globe className="h-[18px] w-[18px] text-primary" />
              <h3 className="pf-text-heading text-base font-semibold">镜像源配置</h3>
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

            {/* Mirror list */}
            <div className="space-y-0">
              {mirrors.map((mirror) => {
                const latency = formatLatency(mirror.latencyMs);
                const isTesting = testingIds.has(mirror.id);
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
                      <div className="text-sm font-medium text-foreground">{mirror.name}</div>
                      <div className="truncate font-mono text-xs text-muted-foreground">
                        {mirror.url}
                      </div>
                    </div>
                    <span
                      className={`min-w-[44px] flex-shrink-0 text-right font-mono text-xs ${latency.color}`}
                    >
                      {isTesting ? <Loader2 className="mx-auto h-3 w-3 animate-spin" /> : latency.text}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-muted-foreground hover:text-primary"
                      onClick={() => handleTestSpeed(mirror.id)}
                      disabled={isTesting}
                    >
                      测试
                    </Button>
                  </div>
                );
              })}
            </div>

            <Button className="mt-4 w-full" onClick={handleApplyMirror} disabled={applyLoading || !activeMirror}>
              {applyLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              应用镜像源
            </Button>
          </Card>

          {/* Speed test card */}
          <Card className="p-4">
            <div className="mb-4 flex items-center gap-2">
              <Activity className="h-[18px] w-[18px] text-primary" />
              <h3 className="pf-text-heading text-sm font-semibold">速度测试</h3>
            </div>
            <div className="space-y-3">
              {sortedMirrors.slice(0, 5).map((mirror) => (
                <div key={`speed-${mirror.id}`} className="flex items-center gap-2.5">
                  <span className="w-16 flex-shrink-0 text-xs text-foreground">{mirror.name}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
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
              disabled={testingIds.size > 0}
            >
              <RefreshCw className="h-3 w-3" />
              重新测试
            </Button>
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
              {quickPackages.map((name) => (
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
                  <SelectItem key={env} value={env}>
                    {env}
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
              <Button variant="ghost" size="sm" className="h-7 text-xs text-primary hover:text-primary">
                更新全部
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
                  installedPackages.map((pkg) => {
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
            <div className="flex items-center justify-between border-t border-border p-3">
              <span className="text-xs text-muted-foreground">
                显示 {installedPackages.length} / {installedPackages.length} 个包
              </span>
              <div className="flex items-center gap-1">
                {['‹', '1', '2', '3', '…', '31', '›'].map((page, index) => (
                  <button
                    key={`${page}-${index}`}
                    type="button"
                    disabled={page === '…'}
                    className={`flex h-6 min-w-[26px] items-center justify-center rounded-sm px-1.5 text-xs ${
                      page === '1'
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-muted disabled:cursor-default disabled:hover:bg-transparent'
                    }`}
                  >
                    {page}
                  </button>
                ))}
              </div>
            </div>
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
                  <SelectItem key={env} value={env}>
                    {env}
                  </SelectItem>
                ))}
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleInstall} disabled={!installInput.trim()}>
              安装
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
