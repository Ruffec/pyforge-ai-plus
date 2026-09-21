import { create } from 'zustand';
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

// Update 是携带底层连接的 Resource，不放进 zustand（非序列化），用模块级持有
let currentUpdate: Update | null = null;
let downloadedCount = 0;
let totalCount = 0;
let startupCheckStarted = false;

interface UpdateState {
  status: AppUpdateStatus;
  info: AppUpdateInfo | null;
  /** 0-100 */
  progress: number;
  downloadedBytes: number;
  totalBytes: number;
  error: string | null;
  checkForUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
  /** 应用启动时的静默检查（仅执行一次），供常驻布局组件调用 */
  startupCheck: () => Promise<void>;
}

export const useUpdateStore = create<UpdateState>()((set, get) => ({
  status: 'idle',
  info: null,
  progress: 0,
  downloadedBytes: 0,
  totalBytes: 0,
  error: null,

  checkForUpdate: async () => {
    if (!isTauri()) {
      set({ status: 'error', error: '当前为浏览器预览环境，请在桌面应用中检查更新' });
      return;
    }
    set({ status: 'checking', error: null, info: null, progress: 0, downloadedBytes: 0, totalBytes: 0 });
    try {
      await currentUpdate?.close();
    } catch {
      // 释放旧资源失败不影响重新检查
    }
    currentUpdate = null;
    try {
      const update = await check();
      if (!update) {
        set({ status: 'up-to-date' });
        return;
      }
      currentUpdate = update;
      set({
        status: 'available',
        info: {
          version: update.version,
          currentVersion: update.currentVersion,
          notes: update.body ?? undefined,
          pubDate: update.date ?? undefined,
        },
      });
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  },

  installUpdate: async () => {
    const update = currentUpdate;
    if (!update) return;
    set({ status: 'downloading', progress: 0, downloadedBytes: 0, totalBytes: 0, error: null });
    downloadedCount = 0;
    totalCount = 0;
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          totalCount = event.data.contentLength ?? 0;
          set({ totalBytes: totalCount });
        } else if (event.event === 'Progress') {
          downloadedCount += event.data.chunkLength;
          set({
            downloadedBytes: downloadedCount,
            progress: totalCount > 0 ? Math.min(100, (downloadedCount / totalCount) * 100) : 0,
          });
        } else if (event.event === 'Finished') {
          set({ progress: 100 });
        }
      });
      // Windows 上启动安装器后应用会自行退出，relaunch 仅对 macOS/Linux 生效；
      // 若进程已被安装器终止，这里的 Promise 不会 resolve，无需处理。
      set({ status: 'installing' });
      await relaunch();
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  },

  startupCheck: async () => {
    if (startupCheckStarted || !isTauri()) return;
    startupCheckStarted = true;
    await get().checkForUpdate();
  },
}));
