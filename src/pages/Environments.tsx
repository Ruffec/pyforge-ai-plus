import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Database,
  Download,
  FileCode,
  FlaskConical,
  GitBranch,
  LayoutGrid,
  List,
  Loader2,
  Play,
  Plus,
  Rocket,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent } from '@/components/ui/Card';
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
import { Switch } from '@/components/ui/Switch';
import { Tooltip } from '@/components/ui/Tooltip';
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
  createVenv,
  exportVenv,
  getDependencies,
  isTauri,
  listVenvs,
  removeVenv,
  scanPythonVersions,
  subscribeEvent,
} from '@/lib/tauri-api';
import type { DependencyNode, EnvironmentStatus, VirtualEnvironment } from '@/types/environments';
import { ENVIRONMENT_STATUS_LABELS } from '@/types/environments';
import type { PythonVersion } from '@/types/python-versions';
import { useSearchParams } from 'react-router-dom';

const FILTER_OPTIONS: { key: 'all' | EnvironmentStatus; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'active', label: '活跃' },
  { key: 'idle', label: '空闲' },
  { key: 'needs_update', label: '需更新' },
  { key: 'corrupted', label: '已损坏' },
];

function getEnvironmentIcon(env: VirtualEnvironment) {
  if (env.status === 'corrupted') return AlertTriangle;
  switch (env.name) {
    case 'data-science':
      return Database;
    case 'web-api':
      return Play;
    case 'ml-experiments':
      return FlaskConical;
    case 'scripts':
      return FileCode;
    case 'my-project':
    default:
      return Rocket;
  }
}

function getStatusClasses(status: EnvironmentStatus) {
  switch (status) {
    case 'active':
      return {
        dot: 'bg-state-success',
        badge: 'border-state-success text-state-success',
      };
    case 'idle':
      return {
        dot: 'bg-pf-muted-foreground',
        badge: 'border-pf-border text-pf-muted-foreground',
      };
    case 'needs_update':
      return {
        dot: 'bg-state-warning',
        badge: 'border-state-warning text-state-warning',
      };
    case 'corrupted':
      return {
        dot: 'bg-state-error',
        badge: 'border-state-error text-state-error',
      };
  }
}

const EnvironmentStatusBadge: React.FC<{ status: EnvironmentStatus }> = ({ status }) => {
  const classes = getStatusClasses(status);
  return (
    <Badge variant="outline" className={`gap-1.5 ${classes.badge}`}>
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${classes.dot}`} />
      {ENVIRONMENT_STATUS_LABELS[status]}
    </Badge>
  );
};

const DependencyTreeNode: React.FC<{ node: DependencyNode; depth?: number }> = ({
  node,
  depth = 0,
}) => {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children && node.children.length > 0;

  return (
    <div>
      <div className="flex items-center gap-1 py-1" style={{ paddingLeft: depth * 16 }}>
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="inline-flex h-4 w-4 items-center justify-center rounded text-pf-muted-foreground hover:text-pf-foreground"
          >
            {expanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </button>
        ) : (
          <span className="inline-block h-4 w-4" />
        )}
        <GitBranch className="h-3.5 w-3.5 text-pf-primary" />
        <span className="font-mono text-sm text-pf-foreground">{node.name}</span>
        <span className="text-xs text-pf-muted-foreground">{node.version}</span>
      </div>
      {expanded && hasChildren && (
        <div>
          {node.children!.map((child, index) => (
            <DependencyTreeNode
              key={`${child.name}-${child.version}-${index}`}
              node={child}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
};

interface EnvironmentActionsProps {
  copied: boolean;
  copiedCmd: boolean;
  onCopyActivate: () => void;
  onCopyPath: () => void;
  onDelete: () => void;
  onExport: () => void;
  onViewTree: () => void;
  className?: string;
}

const EnvironmentActions: React.FC<EnvironmentActionsProps> = ({
  copied,
  copiedCmd,
  onCopyActivate,
  onCopyPath,
  onDelete,
  onExport,
  onViewTree,
  className = '',
}) => {
  return (
    <div className={`flex flex-wrap items-center gap-x-1 gap-y-1 ${className}`}>
      <Tooltip content="复制该环境的终端激活命令">
        <Button
          variant="ghost"
          size="sm"
          className="whitespace-nowrap text-pf-primary hover:text-pf-primary"
          onClick={onCopyActivate}
        >
          {copiedCmd ? (
            <Check className="mr-1 h-3 w-3" />
          ) : (
            <Play className="mr-1 h-3 w-3" />
          )}
          {copiedCmd ? '已复制命令' : '激活命令'}
        </Button>
      </Tooltip>
      <span className="text-pf-border">|</span>
      <Tooltip content="复制路径">
        <Button variant="ghost" size="sm" className="whitespace-nowrap" onClick={onCopyPath}>
          {copied ? <Check className="mr-1 h-3 w-3" /> : <Copy className="mr-1 h-3 w-3" />}
          {copied ? '已复制' : '复制路径'}
        </Button>
      </Tooltip>
      <Tooltip content="导出环境依赖为 requirements.txt">
        <Button variant="ghost" size="sm" className="whitespace-nowrap" onClick={onExport}>
          <Download className="mr-1 h-3 w-3" />
          导出
        </Button>
      </Tooltip>
      <Tooltip content="查看依赖树">
        <Button variant="ghost" size="sm" className="whitespace-nowrap" onClick={onViewTree}>
          <GitBranch className="mr-1 h-3 w-3" />
          依赖树
        </Button>
      </Tooltip>
      <Tooltip content="删除环境">
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto whitespace-nowrap text-state-error hover:text-state-error"
          onClick={onDelete}
        >
          <Trash2 className="mr-1 h-3 w-3" />
          删除
        </Button>
      </Tooltip>
    </div>
  );
};

interface EnvironmentCardProps {
  env: VirtualEnvironment;
  selected: boolean;
  copied: boolean;
  copiedCmd: boolean;
  onToggleSelect: () => void;
  onCopyActivate: () => void;
  onCopyPath: () => void;
  onDelete: () => void;
  onExport: () => void;
  onViewTree: () => void;
}

const EnvironmentCard: React.FC<EnvironmentCardProps> = ({
  env,
  selected,
  copied,
  copiedCmd,
  onToggleSelect,
  onCopyActivate,
  onCopyPath,
  onDelete,
  onExport,
  onViewTree,
}) => {
  const Icon = getEnvironmentIcon(env);
  const isCorrupted = env.status === 'corrupted';

  return (
    <Card className="group flex flex-col gap-3 p-5 transition-colors hover:border-pf-primary hover:shadow-md">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            className="h-4 w-4 accent-pf-primary"
          />
          <EnvironmentStatusBadge status={env.status} />
        </div>
        <Icon className="h-4 w-4 text-pf-muted-foreground" />
      </div>

      <div className="flex flex-col gap-1">
        <h3 className="font-mono text-base font-semibold text-pf-foreground">{env.name}</h3>
        <div className="flex items-center gap-2 text-sm text-pf-muted-foreground">
          <span className="font-mono">Python {env.pythonVersion}</span>
          <span>·</span>
          <span>{env.packagesCount ?? 0} 个包</span>
        </div>
      </div>

      <div className="truncate font-mono text-xs text-pf-muted-foreground">{env.path}</div>

      {isCorrupted ? (
        <div className="flex items-center gap-2 rounded-md bg-pf-muted p-2 text-xs text-state-error">
          <AlertCircle className="h-3.5 w-3.5" />
          <span>环境配置损坏，建议重建</span>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between text-xs text-pf-muted-foreground">
            <span>磁盘使用</span>
            <span className="font-mono">{env.size}</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-pf-muted">
            <div
              className={`h-full rounded-full ${env.status === 'needs_update' ? 'bg-state-warning' : 'bg-pf-primary'}`}
              style={{ width: `${env.usagePercent ?? 0}%` }}
            />
          </div>
        </div>
      )}

      <EnvironmentActions
        copied={copied}
        copiedCmd={copiedCmd}
        onCopyActivate={onCopyActivate}
        onCopyPath={onCopyPath}
        onDelete={onDelete}
        onExport={onExport}
        onViewTree={onViewTree}
        className="mt-auto border-t border-pf-border pt-3"
      />
    </Card>
  );
};

interface EnvironmentListRowProps {
  env: VirtualEnvironment;
  selected: boolean;
  copied: boolean;
  copiedCmd: boolean;
  onToggleSelect: () => void;
  onCopyActivate: () => void;
  onCopyPath: () => void;
  onDelete: () => void;
  onExport: () => void;
  onViewTree: () => void;
}

const EnvironmentListRow: React.FC<EnvironmentListRowProps> = ({
  env,
  selected,
  copied,
  copiedCmd,
  onToggleSelect,
  onCopyActivate,
  onCopyPath,
  onDelete,
  onExport,
  onViewTree,
}) => {
  const Icon = getEnvironmentIcon(env);

  return (
    <TableRow>
      <TableCell>
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="h-4 w-4 accent-pf-primary"
        />
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-pf-muted-foreground" />
          <span className="font-mono font-medium text-pf-foreground">{env.name}</span>
        </div>
      </TableCell>
      <TableCell>
        <span className="font-mono text-pf-muted-foreground">Python {env.pythonVersion}</span>
      </TableCell>
      <TableCell>
        <span className="font-mono text-xs text-pf-muted-foreground">{env.path}</span>
      </TableCell>
      <TableCell>
        <span className="text-sm text-pf-muted-foreground">{env.size}</span>
      </TableCell>
      <TableCell>
        <EnvironmentStatusBadge status={env.status} />
      </TableCell>
      <TableCell>
        <EnvironmentActions
          copied={copied}
          copiedCmd={copiedCmd}
          onCopyActivate={onCopyActivate}
          onCopyPath={onCopyPath}
          onDelete={onDelete}
          onExport={onExport}
          onViewTree={onViewTree}
        />
      </TableCell>
    </TableRow>
  );
};

export const Environments: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [environments, setEnvironments] = useState<VirtualEnvironment[]>([]);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | EnvironmentStatus>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [treeEnv, setTreeEnv] = useState<VirtualEnvironment | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedCmdId, setCopiedCmdId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pythonVersions, setPythonVersions] = useState<PythonVersion[]>([]);

  const [createName, setCreateName] = useState('');
  const [createVersion, setCreateVersion] = useState('');
  const [createLocation, setCreateLocation] = useState('');
  const [inheritGlobal, setInheritGlobal] = useState(false);

  const load = async (mounted: { current: boolean }) => {
    try {
      setLoading(true);
      setError(null);
      const [venvs, pythons] = await Promise.all([listVenvs(), scanPythonVersions()]);
      if (!mounted.current) return;
      setEnvironments(venvs);
      setPythonVersions(pythons);
      if (pythons[0]) {
        setCreateVersion(pythons[0].version);
      }
      // 支持从 Python 版本页跳转预填：/environments?create=1&python=<path>
      if (searchParams.get('create') === '1') {
        const py = searchParams.get('python');
        if (py) {
          const matched = pythons.find((v) => v.path === py || v.version === py);
          setCreateVersion(matched ? matched.version : py);
        }
        setCreateOpen(true);
        setSearchParams({}, { replace: true });
      }
    } catch (err) {
      if (mounted.current) {
        setError(err instanceof Error ? err.message : '加载环境数据失败');
      }
    } finally {
      if (mounted.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    const mounted = { current: true };
    void load(mounted);
    return () => {
      mounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // 跨端实时同步：任一端创建/删除虚拟环境后自动刷新本页
  useEffect(() => {
    const off = subscribeEvent(CHANNELS.venvChanged, () => {
      listVenvs()
        .then((venvs) => setEnvironments(venvs))
        .catch(() => undefined);
    });
    return () => {
      void off.then((fn) => fn());
    };
  }, []);

  const filteredEnvironments = useMemo(() => {
    const term = search.trim().toLowerCase();
    return environments.filter((env) => {
      const matchesStatus = filterStatus === 'all' || env.status === filterStatus;
      const matchesSearch =
        !term ||
        env.name.toLowerCase().includes(term) ||
        env.pythonVersion.toLowerCase().includes(term) ||
        env.path.toLowerCase().includes(term);
      return matchesStatus && matchesSearch;
    });
  }, [environments, filterStatus, search]);

  const statusCounts = useMemo(() => {
    const counts: Record<EnvironmentStatus | 'all', number> = {
      all: environments.length,
      active: 0,
      idle: 0,
      needs_update: 0,
      corrupted: 0,
    };
    environments.forEach((env) => {
      counts[env.status] += 1;
    });
    return counts;
  }, [environments]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelectedIds(new Set(filteredEnvironments.map((env) => env.id)));
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  /** 生成该环境在当前操作系统下的真实终端激活命令 */
  const buildActivateCommand = (env: VirtualEnvironment): string => {
    const isWindows = navigator.platform.toLowerCase().includes('win');
    return isWindows
      ? `${env.path}\\Scripts\\activate.bat`
      : `source ${env.path}/bin/activate`;
  };

  const handleCopyActivateCommand = async (env: VirtualEnvironment) => {
    try {
      await navigator.clipboard.writeText(buildActivateCommand(env));
      setCopiedCmdId(env.id);
      window.setTimeout(() => setCopiedCmdId(null), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : '复制激活命令失败');
    }
  };

  const handleCopyPath = async (env: VirtualEnvironment) => {
    try {
      await navigator.clipboard.writeText(env.path);
      setCopiedId(env.id);
      window.setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // 剪贴板不可用（非安全上下文/权限拒绝）时静默忽略
    }
  };

  const handleViewTree = async (env: VirtualEnvironment) => {
    setTreeEnv(env);
    setTreeLoading(true);
    try {
      const tree = await getDependencies(env.path);
      setTreeEnv((prev) => (prev ? { ...prev, dependencyTree: tree } : null));
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载依赖树失败');
    } finally {
      setTreeLoading(false);
    }
  };

  const handleDelete = async (env: VirtualEnvironment) => {
    try {
      await removeVenv(env.path);
      setEnvironments((prev) => prev.filter((e) => e.id !== env.id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(env.id);
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除环境失败');
    }
  };

  /** 将文本保存为本地文件：桌面端走系统另存为对话框，网页端走浏览器下载 */
  const saveTextFile = async (defaultName: string, content: string) => {
    if (isTauri()) {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const { writeTextFile } = await import('@tauri-apps/plugin-fs');
      const filePath = await save({
        defaultPath: defaultName,
        filters: [{ name: 'requirements', extensions: ['txt'] }],
      });
      if (!filePath) return;
      await writeTextFile(filePath, content);
    } else {
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = defaultName;
      anchor.click();
      URL.revokeObjectURL(url);
    }
  };

  /** 真实导出：pip freeze 依赖清单保存为 requirements.txt */
  const handleExport = async (env: VirtualEnvironment) => {
    try {
      const requirements = await exportVenv(env.path);
      await saveTextFile(`${env.name}-requirements.txt`, requirements);
    } catch (err) {
      setError(err instanceof Error ? err.message : `导出环境 ${env.name} 失败`);
    }
  };

  const handleBulkDelete = async () => {
    try {
      const toDelete = environments.filter((env) => selectedIds.has(env.id));
      await Promise.all(toDelete.map((env) => removeVenv(env.path)));
      setEnvironments((prev) => prev.filter((env) => !selectedIds.has(env.id)));
      clearSelection();
    } catch (err) {
      setError(err instanceof Error ? err.message : '批量删除失败');
    }
  };

  /** 批量导出：合并为单个 requirements 文件（按环境分段标注） */
  const handleBulkExport = async () => {
    const toExport = environments.filter((env) => selectedIds.has(env.id));
    if (toExport.length === 0) return;
    try {
      const sections = await Promise.all(
        toExport.map(async (env) => {
          const requirements = await exportVenv(env.path);
          return `# ===== ${env.name} (${env.path}) =====\n${requirements}`;
        })
      );
      await saveTextFile('pyforge-environments-requirements.txt', sections.join('\n\n'));
      clearSelection();
    } catch (err) {
      setError(err instanceof Error ? err.message : '批量导出失败');
    }
  };

  const resetCreateForm = () => {
    setCreateName('');
    setCreateVersion(pythonVersions[0]?.version ?? '');
    setCreateLocation('');
    setInheritGlobal(false);
  };

  const handleCreateSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = createName.trim() || 'untitled-env';
    const pythonPath =
      pythonVersions.find((v) => v.version === createVersion)?.path ?? createVersion;
    const targetDir = createLocation.trim() || `~/.pyforge/envs/${name}`;
    try {
      const newEnv = await createVenv(name, pythonPath, targetDir);
      setEnvironments((prev) => [...prev, newEnv]);
      setCreateOpen(false);
      resetCreateForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建环境失败');
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="pf-text-display text-2xl text-pf-foreground">虚拟环境</h1>
          <p className="text-sm text-pf-muted-foreground">创建、导出与删除虚拟环境</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            创建环境
          </Button>
          <div className="flex items-center rounded-md border border-pf-border bg-pf-card p-1">
            <Button
              variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-8 w-8 px-0"
              onClick={() => setViewMode('grid')}
              aria-label="网格视图"
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === 'list' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-8 w-8 px-0"
              onClick={() => setViewMode('list')}
              aria-label="列表视图"
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-state-error/50 bg-state-error/10 p-4 text-sm text-state-error">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      {/* Filter / Search Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {FILTER_OPTIONS.map((option) => {
            const active = filterStatus === option.key;
            return (
              <button
                key={option.key}
                type="button"
                onClick={() => setFilterStatus(option.key)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  active
                    ? 'border-pf-primary text-pf-primary'
                    : 'border-pf-border text-pf-muted-foreground hover:border-pf-muted-foreground hover:text-pf-foreground'
                }`}
              >
                {option.label}
                <span className="opacity-70">{statusCounts[option.key]}</span>
              </button>
            );
          })}
        </div>
        <div className="relative flex items-center">
          <Search className="absolute left-3 h-4 w-4 text-pf-muted-foreground" />
          <Input
            placeholder="搜索环境..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full pl-9 sm:w-72"
          />
        </div>
      </div>

      {/* Environment Content */}
      {viewMode === 'grid' ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {loading ? (
            <div className="col-span-full rounded-lg border border-pf-border bg-pf-card p-8 text-center text-pf-muted-foreground">
              <Loader2 className="mx-auto h-5 w-5 animate-spin" />
              <span className="mt-2 block text-xs">加载中...</span>
            </div>
          ) : (
            filteredEnvironments.map((env) => (
              <EnvironmentCard
                key={env.id}
                env={env}
                selected={selectedIds.has(env.id)}
                copied={copiedId === env.id}
                copiedCmd={copiedCmdId === env.id}
                onToggleSelect={() => toggleSelect(env.id)}
                onCopyActivate={() => handleCopyActivateCommand(env)}
                onCopyPath={() => handleCopyPath(env)}
                onDelete={() => handleDelete(env)}
                onExport={() => handleExport(env)}
                onViewTree={() => handleViewTree(env)}
              />
            ))
          )}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <input
                      type="checkbox"
                      checked={
                        filteredEnvironments.length > 0 &&
                        filteredEnvironments.every((env) => selectedIds.has(env.id))
                      }
                      onChange={(event) =>
                        event.target.checked ? selectAllVisible() : clearSelection()
                      }
                      className="h-4 w-4 accent-pf-primary"
                    />
                  </TableHead>
                  <TableHead>环境名称</TableHead>
                  <TableHead>Python 版本</TableHead>
                  <TableHead>路径</TableHead>
                  <TableHead>大小</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="w-[280px] sm:w-[320px] lg:w-[360px]">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-pf-muted-foreground">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                      <span className="mt-2 block text-xs">加载中...</span>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredEnvironments.map((env) => (
                    <EnvironmentListRow
                      key={env.id}
                      env={env}
                      selected={selectedIds.has(env.id)}
                      copied={copiedId === env.id}
                      copiedCmd={copiedCmdId === env.id}
                      onToggleSelect={() => toggleSelect(env.id)}
                      onCopyActivate={() => handleCopyActivateCommand(env)}
                      onCopyPath={() => handleCopyPath(env)}
                      onDelete={() => handleDelete(env)}
                      onExport={() => handleExport(env)}
                      onViewTree={() => handleViewTree(env)}
                    />
                  ))
                )}
                {!loading && filteredEnvironments.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-8 text-center text-pf-muted-foreground"
                    >
                      未找到匹配的虚拟环境
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {!loading && filteredEnvironments.length === 0 && viewMode === 'grid' && (
        <div className="rounded-lg border border-pf-border bg-pf-card p-8 text-center text-pf-muted-foreground">
          未找到匹配的虚拟环境
        </div>
      )}

      {/* Bulk Operations Bar */}
      {selectedIds.size > 0 && (
        <div className="sticky bottom-4 z-40 flex flex-col gap-3 rounded-lg border border-pf-border bg-pf-card p-4 shadow-lg sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Boxes className="h-5 w-5 text-pf-primary" />
            <span className="text-sm text-pf-foreground">
              已选择 <span className="font-semibold">{selectedIds.size}</span> 个环境
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleBulkExport}>
              <Download className="mr-1 h-3 w-3" />
              导出所选
            </Button>
            <Button variant="destructive" size="sm" onClick={handleBulkDelete}>
              <Trash2 className="mr-1 h-3 w-3" />
              删除所选
            </Button>
            <Button variant="ghost" size="sm" onClick={clearSelection}>
              <X className="mr-1 h-3 w-3" />
              取消
            </Button>
          </div>
        </div>
      )}

      {/* Create Environment Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建环境</DialogTitle>
            <DialogDescription>填写以下信息创建新的 Python 虚拟环境。</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="env-name" className="text-sm font-medium text-pf-foreground">
                  环境名称
                </label>
                <Input
                  id="env-name"
                  value={createName}
                  onChange={(event) => setCreateName(event.target.value)}
                  placeholder="my-new-env"
                  className="font-mono"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="env-version" className="text-sm font-medium text-pf-foreground">
                  Python 版本
                </label>
                <Select
                  id="env-version"
                  value={createVersion}
                  onChange={(event) => setCreateVersion(event.target.value)}
                  className="font-mono"
                >
                  {pythonVersions.map((version) => (
                    <SelectItem key={version.id} value={version.version}>
                      Python {version.version}
                    </SelectItem>
                  ))}
                </Select>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <label htmlFor="env-location" className="text-sm font-medium text-pf-foreground">
                  位置
                </label>
                <Input
                  id="env-location"
                  value={createLocation}
                  onChange={(event) => setCreateLocation(event.target.value)}
                  placeholder="点击浏览或输入路径，例如 ~/.pyforge/envs/my-project"
                  className="font-mono"
                />
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-md border border-pf-border bg-pf-muted p-3">
              <Switch
                id="env-inherit"
                checked={inheritGlobal}
                onCheckedChange={setInheritGlobal}
              />
              <label htmlFor="env-inherit" className="text-sm text-pf-foreground">
                继承全局站点包
              </label>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setCreateOpen(false);
                  resetCreateForm();
                }}
              >
                取消
              </Button>
              <Button type="submit">创建环境</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dependency Tree Dialog */}
      <Dialog open={!!treeEnv} onOpenChange={(open) => !open && setTreeEnv(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>依赖树</DialogTitle>
            <DialogDescription>
              {treeEnv ? (
                <>
                  环境 <span className="font-mono text-pf-foreground">{treeEnv.name}</span> 的包依赖关系
                </>
              ) : (
                '查看所选环境的依赖关系'
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto rounded-md border border-pf-border bg-pf-muted p-4">
            {treeLoading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-pf-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                正在加载依赖树…
              </div>
            ) : treeEnv && treeEnv.dependencyTree && treeEnv.dependencyTree.length > 0 ? (
              treeEnv.dependencyTree.map((node, index) => (
                <DependencyTreeNode
                  key={`${node.name}-${node.version}-${index}`}
                  node={node}
                />
              ))
            ) : (
              <div className="py-8 text-center text-sm text-pf-muted-foreground">
                暂无依赖数据
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTreeEnv(null)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
