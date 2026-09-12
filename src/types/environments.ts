export type EnvironmentStatus = 'active' | 'idle' | 'needs_update' | 'corrupted';

export interface DependencyNode {
  name: string;
  version: string;
  children?: DependencyNode[];
}

export interface VirtualEnvironment {
  id: string;
  name: string;
  pythonVersion: string;
  path: string;
  size: string;
  status: EnvironmentStatus;
  packagesCount?: number;
  createdAt: string;
  isActive?: boolean;
  /** 磁盘使用百分比，仅用于展示进度条 */
  usagePercent?: number;
  /** 依赖树 mock 数据 */
  dependencyTree?: DependencyNode[];
}

export const ENVIRONMENT_STATUS_LABELS: Record<EnvironmentStatus, string> = {
  active: '活跃',
  idle: '空闲',
  needs_update: '需更新',
  corrupted: '已损坏',
};
