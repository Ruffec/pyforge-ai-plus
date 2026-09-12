import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Boxes,
  Layers,
  Package,
  Rocket,
  PlusCircle,
  Download,
  Settings2,
  Sparkles,
  ArrowRight,
  Send,
  CheckCircle2,
  Circle,
  AlertCircle,
  Clock,
  Loader2,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
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
  formatPlatform,
  getPlatformInfo,
  listVenvs,
  mockActivities,
  mockQuickActions,
  scanPythonVersions,
} from '@/lib/tauri-api';
import type {
  StatCardData,
  EnvironmentSummary,
} from '@/types/dashboard';
import type { VirtualEnvironment } from '@/types/environments';

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
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<StatCardData[]>([
    { label: 'Python 版本数', value: '-', suffix: '已安装', icon: 'Boxes' },
    { label: '虚拟环境数', value: '-', suffix: '个环境', icon: 'Layers' },
    { label: '已安装包数', value: '-', suffix: '个包', icon: 'Package' },
    { label: 'AI 部署次数', value: '18', suffix: '次部署', icon: 'Rocket', trend: '成功率 100%' },
  ]);
  const [environments, setEnvironments] = useState<EnvironmentSummary[]>([]);
  const [platform, setPlatform] = useState<string>('PyForge AI');

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const [platformInfo, versions, venvs] = await Promise.all([
          getPlatformInfo(),
          scanPythonVersions(),
          listVenvs(),
        ]);
        if (!mounted) return;
        const totalPackages = versions.reduce((sum, v) => sum + (v.packagesCount ?? 0), 0);
        const activeVenvs = venvs.filter((v) => v.status === 'active').length;
        setStats([
          {
            label: 'Python 版本数',
            value: String(versions.length),
            suffix: '已安装',
            icon: 'Boxes',
            trend: '+1 本月',
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
            trend: '+12 今天',
          },
          {
            label: 'AI 部署次数',
            value: '18',
            suffix: '次部署',
            icon: 'Rocket',
            trend: '成功率 100%',
          },
        ]);
        setEnvironments(venvs.slice(0, 5).map(mapVenvToSummary));
        setPlatform(formatPlatform(platformInfo));
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : '加载数据失败，请稍后重试');
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

  const handlePromptSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    // TODO: wire to AI service in later phase
    setPrompt('');
  };

  const handleExampleClick = (text: string) => {
    setPrompt(text);
  };

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

      {/* Stats cards */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => {
          const Icon = statIcons[stat.icon];
          return (
            <Card key={stat.label} className="relative overflow-hidden">
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {stat.label}
                    </p>
                    {loading ? (
                      <Loader2 className="mt-2 h-8 w-8 animate-spin text-muted-foreground" />
                    ) : (
                      <p className="mt-2 text-3xl font-bold tracking-tight text-foreground">
                        {stat.value}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">{stat.suffix}</p>
                  </div>
                  <div className="rounded-full bg-primary/10 p-2 text-primary">
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

      {/* AI assistant panel + Quick actions */}
      <section className="grid gap-6 lg:grid-cols-5">
        {/* AI assistant panel */}
        <div className="lg:col-span-3">
          <Card className="h-full">
            <CardContent className="space-y-4 p-5">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                <h2 className="text-base font-semibold text-foreground">AI 智能助手</h2>
              </div>

              <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
                <p className="text-sm leading-relaxed text-foreground">
                  检测到 <span className="font-mono text-primary">&apos;web-api&apos;</span> 环境有 3 个包可更新。建议运行{' '}
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                    pip install --upgrade
                  </code>{' '}
                  进行更新。
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline">
                    查看建议
                  </Button>
                  <Button size="sm" variant="ghost">
                    忽略
                  </Button>
                </div>
              </div>

              <form onSubmit={handlePromptSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  placeholder="向 AI 助手提问，例如：分析项目依赖、推荐 Python 版本..."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  className="min-w-0 flex-1"
                />
                <Button type="submit" size="icon" aria-label="发送" className="shrink-0">
                  <Send className="h-4 w-4" />
                </Button>
              </form>

              <div className="flex flex-wrap gap-2">
                {['分析项目依赖', '推荐 Python 版本', '生成 requirements.txt', '排查安装错误'].map(
                  (example) => (
                    <Button
                      key={example}
                      variant="ghost"
                      size="sm"
                      onClick={() => handleExampleClick(example)}
                    >
                      {example}
                    </Button>
                  )
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Quick actions */}
        <div className="lg:col-span-2">
          <div className="grid h-full gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            {mockQuickActions.map((action) => {
              const Icon = quickIcons[action.icon];
              return (
                <button
                  key={action.id}
                  onClick={() => navigate(action.to)}
                  className="group flex flex-col rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-primary focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary transition-colors group-hover:bg-primary/20">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex items-center gap-1 text-sm font-semibold text-foreground">
                    {action.label}
                    <ArrowRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{action.description}</p>
                </button>
              );
            })}
          </div>
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
              {mockActivities.map((activity, index) => {
                const isLast = index === mockActivities.length - 1;
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
              })}
            </div>
          </Card>
        </div>
      </section>
    </div>
  );
};
