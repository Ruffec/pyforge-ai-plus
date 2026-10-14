/**
 * Python 彻底卸载对话框
 *
 * 两段式确认 → 执行 → 报告：
 * - 确认阶段展示目标版本与路径、危险提示，可选清理环境变量 / 注册表；
 * - 执行阶段订阅 task/progress 事件实时回显进度（task_type=python_uninstall）；
 * - 报告阶段展示清理明细（文件 / 注册表 / 环境变量计数）、警告与耗时；
 * - 失败时（如存在依赖虚拟环境）出现「强制卸载」开关，允许带 force 重试。
 */
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/Dialog';
import { InlineProgress } from '@/components/ui/TaskProgress';
import { Switch } from '@/components/ui/Switch';
import {
  CHANNELS,
  subscribeEvent,
  uninstallPythonVersion,
  type UninstallReport,
} from '@/lib/tauri-api';
import { logUserAction, logUserError } from '@/lib/user-log';
import type { PythonVersion } from '@/types/python-versions';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Eraser,
  FileX,
  Loader2,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';

export interface UninstallPythonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 待卸载的本地 Python 版本 */
  target: PythonVersion | null;
  /** 当前平台（注册表 / 环境变量清理仅 Windows 有效） */
  platform: 'windows' | 'macos' | 'linux';
  /** 卸载成功后的回调（触发重新扫描） */
  onUninstalled?: (report: UninstallReport) => void;
}

type Phase = 'confirm' | 'running' | 'done' | 'error';

/** 毫秒耗时的人类可读形式 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export const UninstallPythonDialog: React.FC<UninstallPythonDialogProps> = ({
  open,
  onOpenChange,
  target,
  platform,
  onUninstalled,
}) => {
  const [phase, setPhase] = useState<Phase>('confirm');
  const [removeEnv, setRemoveEnv] = useState(true);
  const [removeRegistry, setRemoveRegistry] = useState(true);
  const [force, setForce] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState('');
  const [report, setReport] = useState<UninstallReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);

  const running = phase === 'running';
  const isWindows = platform === 'windows';

  // 打开时重置状态
  useEffect(() => {
    if (open) {
      setPhase('confirm');
      setRemoveEnv(true);
      setRemoveRegistry(true);
      setForce(false);
      setProgress(0);
      setProgressMsg('');
      setReport(null);
      setError(null);
    }
  }, [open]);

  // 订阅卸载任务进度事件
  useEffect(() => {
    if (!open || !running) return;
    let disposed = false;
    subscribeEvent<{ task_type: string; progress: number; message: string }>(
      CHANNELS.taskProgress,
      (payload) => {
        if (disposed || payload.task_type !== 'python_uninstall') return;
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

  const handleUninstall = useCallback(async () => {
    if (!target) return;
    setPhase('running');
    setProgress(1);
    setProgressMsg('正在准备卸载...');
    setError(null);
    logUserAction(`卸载 Python ${target.version}: 开始执行 (路径=${target.path}, removeEnv=${removeEnv}, removeRegistry=${removeRegistry}, force=${force})`);
    try {
      const rep = await uninstallPythonVersion({
        path: target.path,
        removeEnv: isWindows ? removeEnv : undefined,
        removeRegistry: isWindows ? removeRegistry : undefined,
        force: force || undefined,
      });
      setReport(rep);
      setProgress(100);
      setPhase('done');
      logUserAction(
        `卸载 Python ${target.version}: 成功 (耗时=${rep.duration_ms}ms, 官方卸载器=${rep.official_uninstaller_used}, ` +
          `文件=${rep.removed_paths.length}, 注册表=${rep.removed_registry_keys.length}, 环境变量=${rep.removed_env_entries.length}, ` +
          `MSI残留清理=${rep.msi_residue_removed?.length ?? 0}, MSI残留未净=${rep.msi_products_remaining?.length ?? 0})`
      );
      if ((rep.msi_products_remaining?.length ?? 0) > 0) {
        logUserError(
          `卸载 Python ${target.version}: 存在未清理净的 MSI 产品残留: ${rep.msi_products_remaining?.join('; ')}`
        );
      }
      onUninstalled?.(rep);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '卸载失败';
      logUserError(`卸载 Python ${target.version}: 失败 - ${msg}`);
      setError(msg);
      setPhase('error');
    }
  }, [target, removeEnv, removeRegistry, force, isWindows, onUninstalled]);

  /** 错误信息中通常包含依赖虚拟环境列表，需要 force 才能继续 */
  const needsForce = phase === 'error' && /虚拟环境|venv|force|强制/i.test(error ?? '');

  const renderReportRow = (icon: React.ReactNode, label: string, count: number) => (
    <div className="flex items-center justify-between gap-2 rounded-md bg-pf-muted px-2.5 py-1.5">
      <span className="flex items-center gap-1.5 text-xs text-pf-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="font-mono text-xs font-medium text-pf-foreground">{count} 项</span>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !running && onOpenChange(o)}>
      <DialogContent className="max-w-lg w-[calc(100vw-2rem)] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>彻底卸载 Python</DialogTitle>
          <DialogDescription>
            {phase === 'confirm' && '将卸载该版本并清理全部残留文件，此操作不可撤销。'}
            {phase === 'running' && '正在执行卸载流程，请勿关闭窗口。'}
            {phase === 'done' && '卸载完成，以下是清理明细。'}
            {phase === 'error' && '卸载未完成，请根据错误信息处理后重试。'}
          </DialogDescription>
        </DialogHeader>

        {/* 目标信息（confirm / error 阶段展示） */}
        {(phase === 'confirm' || phase === 'error') && target && (
          <div className="space-y-2 rounded-lg border border-pf-border p-3">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-medium text-pf-foreground">
                Python {target.version}
              </span>
              {target.isActive && (
                <Badge variant="destructive" className="text-[10px] gap-1">
                  <AlertTriangle className="h-3 w-3" /> 当前默认版本
                </Badge>
              )}
            </div>
            <p className="font-mono text-[11px] text-pf-muted-foreground break-all" title={target.path}>
              {target.path}
            </p>
          </div>
        )}

        {phase === 'confirm' && (
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-lg border border-state-warning/50 bg-state-warning/10 p-3 text-xs text-state-warning">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                卸载流程：调用官方卸载器（如可用）→ 删除安装目录 → 清理 pip 用户目录
                {isWindows ? ' → 移除注册表项与环境变量' : ''}。若存在依赖此解释器的虚拟环境，
                需先删除这些环境或使用强制卸载。
              </span>
            </div>

            {isWindows && (
              <div className="space-y-2 rounded-lg border border-pf-border p-3">
                <p className="text-xs font-medium text-pf-foreground">残留清理选项</p>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-pf-muted-foreground">
                    清理环境变量（PATH / PYTHONHOME / PYTHONPATH）
                  </span>
                  <Switch checked={removeEnv} onCheckedChange={setRemoveEnv} disabled={running} />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-pf-muted-foreground">
                    清理注册表项（PEP 514 / 卸载表项）
                  </span>
                  <Switch checked={removeRegistry} onCheckedChange={setRemoveRegistry} disabled={running} />
                </div>
              </div>
            )}
            {!isWindows && (
              <p className="text-[11px] text-pf-muted-foreground">
                当前平台将执行文件级卸载；注册表与环境变量清理仅适用于 Windows。
              </p>
            )}
          </div>
        )}

        {phase === 'running' && (
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-2 text-sm text-pf-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-pf-primary" />
              正在卸载 Python {target?.version}
            </div>
            <InlineProgress progress={progress} label={progressMsg || '处理中...'} />
            <p className="text-[11px] text-pf-muted-foreground">
              如弹出 UAC 授权窗口（官方卸载器需要提权），请选择「是」。
            </p>
          </div>
        )}

        {phase === 'done' && report && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-state-success">
              <CheckCircle2 className="h-4 w-4" />
              Python {report.version ?? target?.version} 已彻底卸载
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="success" className="text-[10px] gap-1">
                <ShieldCheck className="h-3 w-3" />
                {report.official_uninstaller_used ? '官方卸载器' : '手动清理'}
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                耗时 {formatDuration(report.duration_ms)}
              </Badge>
            </div>

            <div className="space-y-1.5">
              {renderReportRow(<FileX className="h-3.5 w-3.5" />, '清理文件路径', report.removed_paths.length)}
              {isWindows && renderReportRow(<Eraser className="h-3.5 w-3.5" />, '清理注册表项', report.removed_registry_keys.length)}
              {isWindows && renderReportRow(<ShieldCheck className="h-3.5 w-3.5" />, '清理环境变量条目', report.removed_env_entries.length)}
              {isWindows && report.msi_residue_removed && renderReportRow(<Eraser className="h-3.5 w-3.5" />, '清理 MSI 安装器残留', report.msi_residue_removed.length)}
            </div>

            {isWindows && (report.msi_products_remaining?.length ?? 0) > 0 && (
              <div className="space-y-1 rounded-lg border border-state-error/40 bg-state-error/10 p-2.5">
                {report.msi_products_remaining!.map((p, i) => (
                  <p key={i} className="text-[11px] text-state-error flex items-start gap-1">
                    <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" /> MSI 残留未清理净：{p}
                  </p>
                ))}
              </div>
            )}

            {report.warnings.length > 0 && (
              <div className="space-y-1 rounded-lg border border-state-warning/40 bg-state-warning/10 p-2.5">
                {report.warnings.map((w, i) => (
                  <p key={i} className="text-[11px] text-state-warning flex items-start gap-1">
                    <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" /> {w}
                  </p>
                ))}
              </div>
            )}

            {report.removed_paths.length > 0 && (
              <details className="rounded-lg border border-pf-border p-2.5">
                <summary className="cursor-pointer text-[11px] text-pf-muted-foreground">
                  查看已清理路径明细
                </summary>
                <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                  {report.removed_paths.map((p) => (
                    <p key={p} className="font-mono text-[10px] text-pf-muted-foreground break-all">
                      {p}
                    </p>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}

        {phase === 'error' && error && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-lg border border-state-error/50 bg-state-error/10 p-3 text-xs text-state-error">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span className="break-all">{error}</span>
            </div>
            {needsForce && (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-pf-border p-3">
                <span className="text-xs text-pf-muted-foreground">
                  强制卸载（忽略依赖虚拟环境警告，可能导致这些环境不可用）
                </span>
                <Switch checked={force} onCheckedChange={setForce} />
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {phase === 'confirm' && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button variant="destructive" onClick={handleUninstall} disabled={!target}>
                <Trash2 className="mr-1.5 h-4 w-4" />
                确认卸载
              </Button>
            </>
          )}
          {phase === 'running' && (
            <Button variant="outline" disabled>
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              卸载进行中...
            </Button>
          )}
          {phase === 'done' && (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
          )}
          {phase === 'error' && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                关闭
              </Button>
              <Button variant="destructive" onClick={handleUninstall}>
                <Trash2 className="mr-1.5 h-4 w-4" />
                {needsForce && !force ? '配置强制卸载后重试' : '重试'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default UninstallPythonDialog;
