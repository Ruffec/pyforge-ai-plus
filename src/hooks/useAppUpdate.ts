import { formatBytes, useUpdateStore } from '@/store/useUpdateStore';

export type { AppUpdateInfo, AppUpdateStatus } from '@/store/useUpdateStore';
export { formatBytes };

/**
 * 更新状态的组件绑定层——状态实际存放在全局 useUpdateStore，
 * 因此顶栏（自动检查）与设置页（手动检查）共享同一份状态机。
 */
export function useAppUpdate() {
  const status = useUpdateStore((s) => s.status);
  const info = useUpdateStore((s) => s.info);
  const progress = useUpdateStore((s) => s.progress);
  const downloadedBytes = useUpdateStore((s) => s.downloadedBytes);
  const totalBytes = useUpdateStore((s) => s.totalBytes);
  const error = useUpdateStore((s) => s.error);
  const checkForUpdate = useUpdateStore((s) => s.checkForUpdate);
  const installUpdate = useUpdateStore((s) => s.installUpdate);

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
