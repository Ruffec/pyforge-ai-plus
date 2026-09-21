import { useCallback, useRef, useState } from 'react';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { isTauri } from '@/lib/tauri-api';

export type AppUpdateStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'error';

export interface AppUpdateInfo {
  version: string;
  currentVersion: string;
  notes?: string;
  pubDate?: string;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/**
 * 应用内更新状态机：检查更新 -> 下载（带进度）-> 安装 -> 重启。
 * 浏览器预览环境（非 Tauri）下禁用。
 */
export function useAppUpdate() {
  const [status, setStatus] = useState<AppUpdateStatus>('idle');
  const [info, setInfo] = useState<AppUpdateInfo | null>(null);
  const [progress, setProgress] = useState(0);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const updateRef = useRef<Update | null>(null);
  const downloadedRef = useRef(0);
  const totalRef = useRef(0);

  const checkForUpdate = useCallback(async () => {
    if (!isTauri()) {
      setStatus('error');
      setError('当前为浏览器预览环境，请在桌面应用中检查更新');
      return;
    }
    setStatus('checking');
    setError(null);
    setInfo(null);
    setProgress(0);
    setDownloadedBytes(0);
    setTotalBytes(0);
    try {
      await updateRef.current?.close();
    } catch {
      // 释放旧资源失败不影响重新检查
    }
    try {
      const update = await check();
      if (!update) {
        setStatus('up-to-date');
        return;
      }
      updateRef.current = update;
      setInfo({
        version: update.version,
        currentVersion: update.currentVersion,
        notes: update.body ?? undefined,
        pubDate: update.date ?? undefined,
      });
      setStatus('available');
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const installUpdate = useCallback(async () => {
    const update = updateRef.current;
    if (!update) return;
    setStatus('downloading');
    setProgress(0);
    setDownloadedBytes(0);
    setTotalBytes(0);
    downloadedRef.current = 0;
    totalRef.current = 0;
    setError(null);
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          totalRef.current = event.data.contentLength ?? 0;
          setTotalBytes(totalRef.current);
        } else if (event.event === 'Progress') {
          downloadedRef.current += event.data.chunkLength;
          setDownloadedBytes(downloadedRef.current);
          if (totalRef.current > 0) {
            setProgress(Math.min(100, (downloadedRef.current / totalRef.current) * 100));
          }
        } else if (event.event === 'Finished') {
          setProgress(100);
        }
      });
      // Windows 上启动安装器后应用会自行退出，relaunch 仅对 macOS/Linux 生效；
      // 若进程已被安装器终止，这里的 Promise 不会 resolve，无需处理。
      setStatus('installing');
      await relaunch();
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  return {
    status,
    info,
    progress,
    downloadedBytes,
    totalBytes,
    error,
    checkForUpdate,
    installUpdate,
  };
}
