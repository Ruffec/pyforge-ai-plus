/**
 * Python 一键安装对话框
 *
 * 提供「本地直接安装」流程：选择版本 / 架构 / 自定义安装目录，
 * 后端从 python.org 官方源下载安装包并静默安装，进度经 task/progress
 * 事件实时回显。支持中文与特殊字符路径（合法性由后端校验并给出原因）。
 */
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/Dialog';
import { InlineProgress } from '@/components/ui/TaskProgress';
import { Input } from '@/components/ui/Input';
import { Select, SelectItem } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import {
  CHANNELS,
  installPython,
  isTauri,
  subscribeEvent,
  validateInstallDir,
  type DirValidation,
  type InstallPythonResult,
} from '@/lib/tauri-api';
import type { PythonOrgRelease } from '@/types/python-versions';
import { logUserAction, logUserError } from '@/lib/user-log';
import { AlertCircle, CheckCircle2, Download, FolderOpen, Loader2, Terminal } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface InstallPythonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 可安装版本列表（python.org 官方稳定版，倒序） */
  releases: PythonOrgRelease[];
  /** 预选版本（从卡片「安装此版本」进入时） */
  initialVersion?: string;
  /** 当前平台（决定架构选项与安装方式说明） */
  platform: 'windows' | 'macos' | 'linux';
  /** 默认安装根目录（来自平台路径配置 paths.python_installations_path） */
  defaultBaseDir: string;
  /** 安装成功后的回调（触发重新扫描） */
  onInstalled?: (version: string) => void;
}

type Phase = 'idle' | 'running' | 'done' | 'error';

/** 由版本号推导默认安装目录：{base}\Python{312} 形式 */
export function suggestInstallDir(baseDir: string, version: string): string {
  if (!baseDir) return '';
  const tag = version.split('.').slice(0, 2).join('').replace(/\./g, '');
  const sep = baseDir.includes('\\') ? '\\' : '/';
  const base = baseDir.replace(/[\\/]+$/, '');
  return `${base}${sep}Python${tag}`;
}

export const InstallPythonDialog: React.FC<InstallPythonDialogProps> = ({
  open,
  onOpenChange,
  releases,
  initialVersion,
  platform,
  defaultBaseDir,
  onInstalled,
}) => {
  const [version, setVersion] = useState(initialVersion ?? releases[0]?.version ?? '');
  const [arch, setArch] = useState<'64' | '32' | 'arm64'>('64');
  const [installDir, setInstallDir] = useState(() => suggestInstallDir(defaultBaseDir, initialVersion ?? releases[0]?.version ?? ''));
  const [dirTouched, setDirTouched] = useState(false);
  const [dirValidation, setDirValidation] = useState<DirValidation | null>(null);
  const [validating, setValidating] = useState(false);
  const [allUsers, setAllUsers] = useState(false);
  const [prependPath, setPrependPath] = useState(true);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState('');
  const [result, setResult] = useState<InstallPythonResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);

  const running = phase === 'running';

  // 版本变化时同步默认目录（用户未手动编辑过目录时）
  useEffect(() => {
    if (!dirTouched) {
      setInstallDir(suggestInstallDir(defaultBaseDir, version));
    }
  }, [version, defaultBaseDir, dirTouched]);

  // 打开时重置状态
  useEffect(() => {
    if (open) {
      setVersion(initialVersion ?? releases[0]?.version ?? '');
      setPhase('idle');
      setProgress(0);
      setProgressMsg('');
      setResult(null);
      setError(null);
      setDirTouched(false);
      setInstallDir(suggestInstallDir(defaultBaseDir, initialVersion ?? releases[0]?.version ?? ''));
    }
  }, [open, initialVersion, releases, defaultBaseDir]);

  // 目录校验（300ms 防抖，仅桌面端需要真实可写性；网页端后端同样可校验）
  useEffect(() => {
    if (!open || !installDir.trim() || running) {
      setDirValidation(null);
      return;
    }
    const timer = setTimeout(async () => {
      setValidating(true);
      try {
        const v = await validateInstallDir(installDir.trim());
        setDirValidation(v);
      } catch {
        setDirValidation(null);
      } finally {
        setValidating(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [installDir, open, running]);

  // 订阅安装任务进度事件
  useEffect(() => {
    if (!open || !running) return;
    let disposed = false;
    subscribeEvent<{ task_type: string; progress: number; message: string }>(
      CHANNELS.taskProgress,
      (payload) => {
        if (disposed || payload.task_type !== 'python_install') return;
        setProgress(payload.progress);
        setProgressMsg(payload.message);
      }
    ).then((un) => {
      if (disposed) un();
      else unlistenRef.current = un;
    });
    return () => {
      disposed = true;
      unlistenRef.current?.();
      unlistenRef.current = null;
    };
  }, [open, running]);

  const canStart =
    !running && version !== '' && platform === 'linux'
      ? true
      : !running && version !== '' && (dirValidation?.valid ?? false);

  const handleStart = useCallback(async () => {
    setPhase('running');
    setProgress(1);
    setProgressMsg('正在准备下载...');
    setError(null);
    setResult(null);
    logUserAction(
      `安装 Python ${version}: 开始 (arch=${platform === 'windows' ? arch : 'default'}, installDir=${platform === 'windows' ? installDir.trim() : 'default'}, allUsers=${allUsers}, prependPath=${prependPath})`
    );
    try {
      const res = await installPython({
        version,
        arch: platform === 'windows' ? arch : undefined,
        installDir: platform === 'windows' ? installDir.trim() : undefined,
        allUsers: platform === 'windows' ? allUsers : undefined,
        prependPath: platform === 'windows' ? prependPath : undefined,
      });
      setResult(res);
      setProgress(100);
      setPhase('done');
      logUserAction(
        `安装 Python ${version}: 成功 (路径=${res.installed_path ?? '未知'}, 警告=${res.warnings.length}条)`
      );
      onInstalled?.(res.version);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '安装失败';
      logUserError(`安装 Python ${version}: 失败 - ${msg}`);
      setError(msg);
      setPhase('error');
    }
  }, [version, arch, installDir, allUsers, prependPath, platform, onInstalled]);

  /** 目录选择（仅桌面端；插件按需加载避免网页端打包报错） */
  const handleBrowse = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const { open: pickFolder } = await import('@tauri-apps/plugin-dialog');
      const picked = await pickFolder({ directory: true, title: '选择 Python 安装目录' });
      if (picked) {
        setDirTouched(true);
        setInstallDir(picked);
      }
    } catch {
      // 用户取消或插件不可用
    }
  }, []);

  const versionLabel = useMemo(() => {
    const rel = releases.find((r) => r.version === version);
    return rel ? `Python ${rel.version}（${rel.releaseDate}）` : `Python ${version}`;
  }, [releases, version]);

  return (
    <Dialog open={open} onOpenChange={(o) => !running && onOpenChange(o)}>
      <DialogContent className="max-w-lg w-[calc(100vw-2rem)] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>一键安装 Python</DialogTitle>
          <DialogDescription>
            从 python.org 官方源下载并本地静默安装，无需跳转浏览器。
          </DialogDescription>
        </DialogHeader>

        {phase === 'idle' && (
          <div className="space-y-4">
            {/* 版本选择 */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-pf-foreground" htmlFor="install-version">
                Python 版本
              </label>
              <Select
                id="install-version"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                disabled={running}
              >
                {releases.length === 0 && <SelectItem value="">（官方版本列表加载中...）</SelectItem>}
                {releases.map((r) => (
                  <SelectItem key={r.version} value={r.version}>
                    Python {r.version}（{r.releaseDate}）{r.isLatest ? ' · 最新稳定版' : ''}
                  </SelectItem>
                ))}
              </Select>
              <p className="text-[11px] text-pf-muted-foreground">{versionLabel}</p>
            </div>

            {/* Windows 架构 */}
            {platform === 'windows' && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-pf-foreground" htmlFor="install-arch">
                  安装包架构
                </label>
                <Select
                  id="install-arch"
                  value={arch}
                  onChange={(e) => setArch(e.target.value as '64' | '32' | 'arm64')}
                >
                  <SelectItem value="64">64-bit（amd64，推荐）</SelectItem>
                  <SelectItem value="32">32-bit（x86）</SelectItem>
                  <SelectItem value="arm64">ARM64</SelectItem>
                </Select>
              </div>
            )}

            {/* 自定义安装目录 */}
            {platform !== 'linux' && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-pf-foreground" htmlFor="install-dir">
                  安装目录{platform === 'macos' ? '（macOS 安装到系统框架目录，此选项不生效）' : ''}
                </label>
                <div className="flex gap-2">
                  <Input
                    id="install-dir"
                    value={installDir}
                    onChange={(e) => {
                      setDirTouched(true);
                      setInstallDir(e.target.value);
                    }}
                    placeholder="例如 D:\Python\Python312（支持中文与空格）"
                    disabled={running || platform === 'macos'}
                    className="font-mono text-xs"
                  />
                  {isTauri() && platform === 'windows' && (
                    <Button variant="outline" size="sm" onClick={handleBrowse} disabled={running} title="浏览文件夹">
                      <FolderOpen className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                {validating && (
                  <p className="text-[11px] text-pf-muted-foreground flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" /> 正在校验目录...
                  </p>
                )}
                {!validating && dirValidation && !dirValidation.valid && dirValidation.reason && (
                  <p className="text-[11px] text-state-error flex items-start gap-1">
                    <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                    {dirValidation.reason}
                  </p>
                )}
                {!validating && dirValidation?.valid && (
                  <p className="text-[11px] text-state-success flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" /> 目录可用
                  </p>
                )}
              </div>
            )}

            {/* Windows 高级选项 */}
            {platform === 'windows' && (
              <div className="space-y-2 rounded-lg border border-pf-border p-3">
                <p className="text-xs font-medium text-pf-foreground">安装选项</p>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-pf-muted-foreground">写入 PATH 环境变量</span>
                  <Switch checked={prependPath} onCheckedChange={setPrependPath} disabled={running} />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-pf-muted-foreground">
                    为所有用户安装（需要管理员授权）
                  </span>
                  <Switch checked={allUsers} onCheckedChange={setAllUsers} disabled={running} />
                </div>
              </div>
            )}

            {/* 平台说明 */}
            {platform === 'macos' && (
              <p className="text-[11px] text-pf-muted-foreground flex items-start gap-1">
                <Terminal className="h-3 w-3 mt-0.5 shrink-0" />
                macOS 将下载官方 pkg 并请求管理员授权安装到系统框架目录。
              </p>
            )}
            {platform === 'linux' && (
              <p className="text-[11px] text-state-warning flex items-start gap-1">
                <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                Linux 平台仅下载官方源码包到本地（暂不支持自动化编译安装），可使用系统包管理器替代。
              </p>
            )}
          </div>
        )}

        {phase === 'running' && (
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-2 text-sm text-pf-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-pf-primary" />
              正在安装 Python {version}
            </div>
            <InlineProgress progress={progress} label={progressMsg || '处理中...'} />
            <p className="text-[11px] text-pf-muted-foreground">
              下载与安装过程可能需要几分钟，请保持网络畅通；如弹出 UAC 授权窗口请选择「是」。
            </p>
          </div>
        )}

        {phase === 'done' && result && (
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-2 text-sm text-state-success">
              <CheckCircle2 className="h-4 w-4" />
              {result.message}
            </div>
            {result.installed_path && (
              <div className="rounded-md bg-pf-muted p-2 font-mono text-xs text-pf-foreground break-all">
                {result.installed_path}
              </div>
            )}
            {result.warnings.length > 0 && (
              <div className="space-y-1">
                {result.warnings.map((w, i) => (
                  <p key={i} className="text-[11px] text-state-warning flex items-start gap-1">
                    <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" /> {w}
                  </p>
                ))}
              </div>
            )}
            <Badge variant="success" className="text-[10px]">已自动刷新本地版本列表</Badge>
          </div>
        )}

        {phase === 'error' && error && (
          <div className="flex items-start gap-2 rounded-lg border border-state-error/50 bg-state-error/10 p-3 text-xs text-state-error">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span className="break-all">{error}</span>
          </div>
        )}

        <DialogFooter>
          {phase === 'idle' && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button onClick={handleStart} disabled={!canStart || releases.length === 0}>
                <Download className="mr-1.5 h-4 w-4" />
                开始下载并安装
              </Button>
            </>
          )}
          {phase === 'running' && (
            <Button variant="outline" disabled>
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              安装进行中...
            </Button>
          )}
          {(phase === 'done' || phase === 'error') && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                关闭
              </Button>
              {phase === 'error' && (
                <Button onClick={handleStart}>
                  <Download className="mr-1.5 h-4 w-4" /> 重试
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default InstallPythonDialog;
