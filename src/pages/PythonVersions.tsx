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
import { Input } from '@/components/ui/Input';
import { Select, SelectItem } from '@/components/ui/Select';
import {
  availablePythonVersions,
  fetchPythonReleases,
  getPythonDetails,
  scanPythonVersions,
  setDefaultPython
} from '@/lib/tauri-api';
import type { PythonOrgRelease, PythonVersion } from '@/types/python-versions';
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
import React, { useEffect, useMemo, useState } from 'react';

/** 「可安装版本」条目：优先来自 python.org 官方 API，失败时回退到本地静态列表 */
export interface InstallablePythonVersion {
  version: string;
  label: string;
  releaseDate: string;
  size?: string;
}

/** 最多展示的官方稳定版本数量（python.org 历史版本较多） */
const MAX_INSTALLABLE_VERSIONS = 12;

export const PythonVersions: React.FC = () => {
  const [versions, setVersions] = useState<PythonVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<PythonVersion | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeActionId, setActiveActionId] = useState<string | null>(null);
  const [installVersion, setInstallVersion] = useState(availablePythonVersions[0]?.version ?? '');
  const [customVersion, setCustomVersion] = useState('');
  const [selectedPlatform, setSelectedPlatform] = useState<'windows' | 'macos' | 'linux'>('windows');
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [pythonReleases, setPythonReleases] = useState<PythonOrgRelease[]>([]);
  const [releasesError, setReleasesError] = useState<string | null>(null);

  const activeVersion = useMemo(
    () => versions.find((v) => v.isActive) ?? versions[0] ?? null,
    [versions]
  );

  // python.org 官方稳定版本列表（预发布版本已由后端过滤）；失败时回退到本地静态列表
  useEffect(() => {
    let mounted = true;
    fetchPythonReleases()
      .then((releases) => {
        if (!mounted) return;
        setPythonReleases(releases);
        // 官方列表到达后，默认选中最新稳定版
        if (releases.length > 0) {
          setInstallVersion(releases[0].version);
        }
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

  const installableVersions: InstallablePythonVersion[] = useMemo(() => {
    if (pythonReleases.length === 0) {
      return availablePythonVersions;
    }
    return pythonReleases.slice(0, MAX_INSTALLABLE_VERSIONS).map((r) => ({
      version: r.version,
      label: r.isLatest ? '最新稳定版' : '稳定版',
      releaseDate: r.releaseDate,
    }));
  }, [pythonReleases]);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const data = await scanPythonVersions();
        if (!mounted) return;
        setVersions(data);
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : '加载 Python 版本失败');
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

  const handleScan = async () => {
    try {
      setScanning(true);
      setError(null);
      const data = await scanPythonVersions();
      setVersions(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '扫描失败');
    } finally {
      setScanning(false);
    }
  };

  const handleSetDefault = async (version: PythonVersion) => {
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
      setError(err instanceof Error ? err.message : '设置默认版本失败');
    } finally {
      setActiveActionId(null);
    }
  };

  const handleOpenDirectory = (version: PythonVersion) => {
    // TODO: 使用 Tauri shell.open() 打开文件所在目录
    console.log('打开目录:', version.path);
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

  const handleUpdatePip = (version: PythonVersion) => {
    setActiveActionId(version.id);
    // TODO: 调用 Rust 后端执行 python -m pip install --upgrade pip
    console.log('更新 pip:', version.path);
    window.setTimeout(() => {
      setVersions((prev) =>
        prev.map((v) =>
          v.id === version.id
            ? { ...v, pipVersion: '24.3' }
            : v
        )
      );
      setActiveActionId(null);
    }, 1000);
  };

  const handleCreateVenv = (version: PythonVersion) => {
    // TODO: 跳转到虚拟环境创建页面，预填此 Python 版本
    console.log('创建虚拟环境，使用 Python:', version.path);
    // 可以使用 react-router 导航到 /environments?create=true&python=xxx
  };

  const handleUninstall = (version: PythonVersion) => {
    setActiveActionId(version.id);
    // TODO: 调用 Rust 后端卸载 API
    window.setTimeout(() => {
      setVersions((prev) => prev.filter((v) => v.id !== version.id));
      setActiveActionId(null);
    }, 800);
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

  const handleInstallSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setInstalling(true);
    // TODO: 调用 Rust 后端安装 API
    window.setTimeout(() => {
      const version = customVersion || installVersion;
      const newVersion: PythonVersion = {
        id: `py-${version}`,
        version,
        path: `/usr/local/python${version}/bin/python`,
        isActive: false,
        pipVersion: '24.2',
        packagesCount: 0,
        lastUsed: '-',
        releaseDate: new Date().toISOString().split('T')[0],
        architecture: 'arm64',
        size: '待定',
      };
      setVersions((prev) => [...prev, newVersion]);
      setInstalling(false);
      setInstallOpen(false);
      setCustomVersion('');
    }, 1500);
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
          <Button variant="outline" onClick={() => setInstallOpen(true)} size="sm" className="shrink-0">
            <Download className="mr-2 h-4 w-4" />
            安装新版本
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
                        onClick={() => handleCopyPath(activeVersion.path)}
                        className="text-[10px] text-pf-muted-foreground hover:text-pf-primary transition-colors"
                      >
                        {copiedPath === activeVersion.path ? '✓ 已复制' : '复制'}
                      </button>
                    </div>
                    <p
                      className="font-mono text-xs text-pf-foreground truncate"
                      title={activeVersion.path}
                    >
                      {activeVersion.path}
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
            <Badge variant="secondary">{versions.length}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-center text-pf-muted-foreground">
              <Loader2 className="mx-auto h-5 w-5 animate-spin" />
              <span className="mt-2 block text-xs">加载中...</span>
            </div>
          ) : (
            <div className="space-y-3">
              {versions.map((version) => (
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
                          disabled={activeActionId === version.id}
                          onClick={() => handleUninstall(version)}
                          title="卸载此版本"
                        >
                          {activeActionId === version.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
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
                              handleCopyPath(version.path);
                            }}
                            className="text-[10px] text-pf-muted-foreground hover:text-pf-primary transition-colors"
                          >
                            {copiedPath === version.path ? '✓ 已复制' : '复制'}
                          </button>
                        </div>
                        <span
                          className="font-mono text-xs text-pf-foreground block truncate"
                          title={version.path}
                        >
                          {version.path}
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

              {!loading && versions.length === 0 && (
                <div className="py-8 text-center text-pf-muted-foreground">
                  未检测到已安装的 Python 版本，点击「扫描本地版本」重新检测。
                </div>
              )}
            </div>
          )}
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
              获取 python.org 官方版本列表失败，已回退到内置版本列表：
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
          {installableVersions.map((item) => (
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

              {/* 平台特定下载信息 */}
              <div className="flex items-center gap-2 text-xs text-pf-muted-foreground">
                <span className="truncate">{item.releaseDate}</span>
                <span className="text-pf-border shrink-0">·</span>
                <span className="flex items-center gap-0.5 shrink-0">
                  <HardDrive className="h-3 w-3" />
                  {item.size}
                </span>
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

              <Button size="sm" onClick={() => setInstallOpen(true)} className="w-full">
                <Download className="mr-1 h-3 w-3" />
                下载安装 ({selectedPlatform})
              </Button>
            </div>
          ))}
        </div>
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
                  { label: '安装路径', value: selectedVersion.path },
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

      {/* Install New Version Dialog */}
      <Dialog open={installOpen} onOpenChange={setInstallOpen}>
        <DialogContent className="max-w-md w-[calc(100vw-2rem)]">
          <DialogHeader>
            <DialogTitle>安装新版本</DialogTitle>
            <DialogDescription>选择或输入要安装的 Python 版本。</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleInstallSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="version-select" className="text-sm font-medium text-pf-foreground">
                选择版本
              </label>
              <Select
                id="version-select"
                value={installVersion}
                onChange={(e) => setInstallVersion(e.target.value)}
                disabled={!!customVersion}
              >
                {installableVersions.map((item) => (
                  <SelectItem key={item.version} value={item.version}>
                    Python {item.version} ({item.label})
                  </SelectItem>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <label htmlFor="custom-version" className="text-sm font-medium text-pf-foreground">
                或输入自定义版本
              </label>
              <Input
                id="custom-version"
                placeholder="例如：3.12.6"
                value={customVersion}
                onChange={(e) => setCustomVersion(e.target.value)}
              />
            </div>
            <div className="rounded-md border border-pf-border bg-pf-muted p-3 text-xs text-pf-muted-foreground">
              将自动从官方源下载并安装所选版本，安装完成后会刷新版本列表。
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setInstallOpen(false)} disabled={installing}>
                取消
              </Button>
              <Button type="submit" disabled={installing || (!installVersion && !customVersion)}>
                {installing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                开始安装
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};
