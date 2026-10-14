import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Boxes,
  Layers,
  Package,
  Rocket,
  PlusCircle,
  Download,
  Settings2,
  ArrowRight,
  CheckCircle2,
  Circle,
  AlertCircle,
  Clock,
  Loader2,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import {
  CHANNELS,
  formatPlatform,
  getPlatformInfo,
  listTasks,
  listVenvs,
  scanPythonVersions,
  subscribeEvent,
  type TaskInfo,
} from '@/lib/tauri-api';
import type {
  StatCardData,
  EnvironmentSummary,
  QuickAction,
  ActivityItem,
} from '@/types/dashboard';
import type { VirtualEnvironment } from '@/types/environments';

/** 快捷入口（纯导航 UI 配置，非数据） */
const quickActions: QuickAction[] = [
  {
    id: 'deploy',
    label: '一键部署环境',
    description: '智能分析项目依赖',
    icon: 'Rocket',
    to: '/ai-deploy',
  },
  {
    id: 'create-env',
    label: '创建虚拟环境',
    description: '快速创建隔离环境',
    icon: 'PlusCircle',
    to: '/environments',
  },
  {
    id: 'install-python',
    label: '安装 Python',
    description: '管理多个版本',
    icon: 'Download',
    to: '/python-versions',
  },
  {
    id: 'config-mirror',
    label: '配置镜像源',
    description: '优化下载速度',
    icon: 'Settings2',
    to: '/packages',
  },
];

/** 相对时间格式化（真实任务时间戳 → 展示文本） */
function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}天前`;
  return new Date(ms).toLocaleDateString('zh-CN');
}

const statIcons: Record<string, React.ElementType> = {
  Boxes,
  Layers,
  Package,
  Rocket,
};

const quickIcons: Record<string, React.ElementType> = {
  Rocket,
  PlusCircle,
  Download,
  Settings2,
};

const statusConfig: Record<
  EnvironmentSummary['status'],
  { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' | 'success'; icon: React.ElementType }
> = {
  active: { label: '活跃', variant: 'success', icon: CheckCircle2 },
  idle: { label: '空闲', variant: 'secondary', icon: Circle },
  'update-available': { label: '更新可用', variant: 'outline', icon: AlertCircle },
};

function mapVenvToSummary(env: VirtualEnvironment): EnvironmentSummary {
  let status: EnvironmentSummary['status'];
  switch (env.status) {
    case 'active':
      status = 'active';
      break;
    case 'needs_update':
    case 'corrupted':
      status = 'update-available';
      break;
    default:
      status = 'idle';
  }
  return {
    id: env.id,
    name: env.name,
    pythonVersion: env.pythonVersion,
    status,
    packageCount: env.packagesCount ?? 0,
    lastUsed: env.isActive ? '正在使用' : env.createdAt,
  };
}

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<StatCardData[]>([
    { label: 'Python 版本数', value: '-', suffix: '已安装', icon: 'Boxes' },
    { label: '虚拟环境数', value: '-', suffix: '个环境', icon: 'Layers' },
    { label: '已安装包数', value: '-', suffix: '个包', icon: 'Package' },
    { label: '累计任务数', value: '-', suffix: '次操作', icon: 'Rocket' },
  ]);
  const [environments, setEnvironments] = useState<EnvironmentSummary[]>([]);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [platform, setPlatform] = useState<string>('PyForge AI');

  // pythonScanned 由后端每次扫描命令广播，而本页 load() 恰好调用扫描命令；
  // 不设回声守卫会形成「load→扫描→事件→load」同步自激死循环（真机实测
  // ~3ms/轮的扫描风暴 + KPI 加载态高频切换闪屏）。
  // 守卫 = 在飞标记 + 完成时间戳窗口，跳过本端扫描引发的回声事件。
  const loadBusyRef = useRef(false);
  const lastLoadAtRef = useRef(0);

  /** 拉取控制台全量数据。事件驱动的刷新传 silent=true（不切换加载态，避免闪屏）。 */
  const load = useCallback(async (mounted: { current: boolean }, options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    loadBusyRef.current = true;
    try {
      if (!silent) {
        setLoading(true);
      }
      setError(null);
      const [platformInfo, versions, venvs, tasks] = await Promise.all([
        getPlatformInfo(),
        scanPythonVersions(),
        listVenvs(),
        listTasks().catch(() => [] as TaskInfo[]),
      ]);
      lastLoadAtRef.current = Date.now();
      if (!mounted.current) return;
      const totalPackages = versions.reduce((sum, v) => sum + (v.packagesCount ?? 0), 0);
      const activeVenvs = venvs.filter((v) => v.status === 'active').length;
      const completedTasks = tasks.filter((t) => t.status === 'completed').length;
      setStats([
        {
          label: 'Python 版本数',
          value: String(versions.length),
          suffix: '已安装',
          icon: 'Boxes',
        },
        {
          label: '虚拟环境数',
          value: String(venvs.length),
          suffix: '个环境',
          icon: 'Layers',
          trend: `${activeVenvs} 个活跃`,
        },
        {
          label: '已安装包数',
          value: String(totalPackages),
          suffix: '个包',
          icon: 'Package',
        },
        {
          label: '累计任务数',
          value: String(tasks.length),
          suffix: '次操作',
          icon: 'Rocket',
          trend: `${completedTasks} 个完成`,
        },
      ]);
      setEnvironments(venvs.slice(0, 5).map(mapVenvToSummary));
      // 最近活动：来自后端真实任务记录（按更新时间倒序）
      setActivities(
        tasks.slice(0, 6).map((t) => ({
          id: t.id,
          title: t.message || t.task_type,
          timestamp: formatRelativeTime(t.updated_at),
        }))
      );
      setPlatform(formatPlatform(platformInfo));
    } catch (err) {
      if (mounted.current) {
        setError(err instanceof Error ? err.message : '加载数据失败，请稍后重试');
      }
    } finally {
      loadBusyRef.current = false;
      if (mounted.current && !silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const mounted = { current: true };
    void load(mounted);
    return () => {
      mounted.current = false;
    };
  }, [load]);

  // 跨端实时同步：任一端发生虚拟环境/Python 变更或任务完成时自动刷新。
  // 事件驱动刷新全部走静默路径（不切换加载态）；本端 load 自身触发的
  // pythonScanned 回声由 isEchoEvent 拦截，杜绝自激循环。
  useEffect(() => {
    const mounted = { current: true };
    const isEchoEvent = () =>
      loadBusyRef.current || Date.now() - lastLoadAtRef.current < 1500;
    const refresh = () => {
      if (isEchoEvent()) return;
      void load(mounted, { silent: true });
    };
    const offs = [
      subscribeEvent(CHANNELS.venvChanged, refresh),
      subscribeEvent(CHANNELS.pythonScanned, refresh),
      subscribeEvent(CHANNELS.pythonDefaultChanged, refresh),
      subscribeEvent(CHANNELS.taskProgress, refresh),
    ];
    return () => {
      mounted.current = false;
      offs.forEach((p) => void p.then((fn) => fn()));
    };
  }, [load]);

  return (
    <div className="space-y-6">
      {/* Welcome header */}
      <section className="flex flex-col gap-4 rounded-lg border border-border border-l-4 border-l-primary bg-card p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">控制台</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            欢迎回来，Developer。您的 Python 开发环境已就绪，AI 助手正在待命。
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <Badge variant="outline">{platform}</Badge>
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            {new Date().toLocaleString('zh-CN', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </div>
      </section>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Stats cards：真 3D 物理质感（perspective 分层悬浮）+ 悬挂式立体标题，动效 ≤300ms */}
      <section className="pf-3d-scene grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => {
          const Icon = statIcons[stat.icon];
          return (
            <Card
              key={stat.label}
              className="pf-card-3d relative overflow-hidden hover:border-pf-primary/40"
            >
              <span className="pf-card-3d-sheen absolute inset-x-0 top-0 h-full" aria-hidden />
              <CardContent className="relative p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="pf-3d-title text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {stat.label}
                    </p>
                    {loading ? (
                      <Loader2 className="mt-2 h-8 w-8 animate-spin text-muted-foreground" />
                    ) : (
                      <p className="pf-3d-value mt-2 text-3xl font-bold tracking-tight text-foreground">
                        {stat.value}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">{stat.suffix}</p>
                  </div>
                  <div className="pf-3d-icon rounded-full bg-primary/10 p-2 text-primary shadow-[0_4px_10px_-2px_rgb(0_0_0/0.25)]">
                    <Icon className="h-5 w-5" />
                  </div>
                </div>
                {!loading && stat.trend && (
                  <div className="mt-4 flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">
                      {stat.trend}
                    </Badge>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </section>

      {/* Quick actions（AI 助手模块已移除，功能统一收口至 AI 智能部署页；3D 物理质感 + 悬挂式标题） */}
      <section>
        <div className="pf-3d-scene grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {quickActions.map((action) => {
            const Icon = quickIcons[action.icon];
            return (
              <button
                key={action.id}
                onClick={() => navigate(action.to)}
                className="pf-card-3d group relative flex flex-col overflow-hidden rounded-lg border border-border bg-card p-4 text-left hover:border-primary focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <span className="pf-card-3d-sheen absolute inset-x-0 top-0 h-full" aria-hidden />
                <div className="pf-3d-icon relative mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary transition-colors group-hover:bg-primary/20">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="pf-3d-title relative flex items-center gap-1 text-sm font-semibold text-foreground">
                  {action.label}
                  <ArrowRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
                <p className="relative mt-1 text-xs text-muted-foreground">{action.description}</p>
              </button>
            );
          })}
        </div>
      </section>

      {/* Environment status + Activity timeline */}
      <section className="grid gap-6 lg:grid-cols-3">
        {/* Environment status */}
        <div className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground">环境状态</h2>
            <Button variant="ghost" size="sm" onClick={() => navigate('/environments')}>
              查看全部
            </Button>
          </div>
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>环境名称</TableHead>
                  <TableHead>Python 版本</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>包数量</TableHead>
                  <TableHead>最后使用</TableHead>
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
                  environments.map((env) => {
                    const config = statusConfig[env.status];
                    const StatusIcon = config.icon;
                    return (
                      <TableRow key={env.id}>
                        <TableCell className="font-mono font-medium">{env.name}</TableCell>
                        <TableCell className="font-mono text-muted-foreground">
                          {env.pythonVersion}
                        </TableCell>
                        <TableCell>
                          <Badge variant={config.variant} className="gap-1">
                            <StatusIcon className="h-3 w-3" />
                            {config.label}
                          </Badge>
                        </TableCell>
                        <TableCell>{env.packageCount}</TableCell>
                        <TableCell className="text-muted-foreground">{env.lastUsed}</TableCell>
                      </TableRow>
                    );
                  })
                )}
                {!loading && environments.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      暂无虚拟环境数据
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        </div>

        {/* Activity timeline */}
        <div>
          <h2 className="mb-3 text-base font-semibold text-foreground">最近活动</h2>
          <Card className="p-5">
            <div className="space-y-0">
              {activities.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  暂无操作记录，创建环境或安装包后将在此展示
                </p>
              ) : (
                activities.map((activity, index) => {
                  const isLast = index === activities.length - 1;
                  return (
                    <div key={activity.id} className="flex gap-3">
                      <div className="flex flex-col items-center pt-1">
                        <span
                          className={`h-2 w-2 rounded-full ${
                            activity.variant === 'muted' ? 'bg-muted-foreground' : 'bg-primary'
                          }`}
                        />
                        {!isLast && <span className="mt-1 h-full w-px bg-border min-h-[2rem]" />}
                      </div>
                      <div className="pb-4">
                        <p className="text-sm text-foreground">{activity.title}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{activity.timestamp}</p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Card>
        </div>
      </section>
    </div>
  );
};
