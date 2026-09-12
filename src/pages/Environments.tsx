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
  Upload,
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
  createVenv,
  getDependencies,
  listVenvs,
  removeVenv,
  scanPythonVersions,
} from '@/lib/tauri-api';
import type { DependencyNode, EnvironmentStatus, VirtualEnvironment } from '@/types/environments';
import { ENVIRONMENT_STATUS_LABELS } from '@/types/environments';
import type { PythonVersion } from '@/types/python-versions';

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
  env: VirtualEnvironment;
  copied: boolean;
  onActivate: () => void;
  onCopyPath: () => void;
  onDelete: () => void;
  onExport: () => void;
  onViewTree: () => void;
  className?: string;
}

const EnvironmentActions: React.FC<EnvironmentActionsProps> = ({
  env,
  copied,
  onActivate,
  onCopyPath,
  onDelete,
  onExport,
  onViewTree,
  className = '',
}) => {
  const isCorrupted = env.status === 'corrupted';
  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <Tooltip content={env.isActive ? '当前已激活' : '激活该环境'}>
        <Button
          variant="ghost"
          size="sm"
          className="text-pf-primary hover:text-pf-primary"
          disabled={env.isActive || isCorrupted}
          onClick={onActivate}
        >
          {env.isActive ? (
            <Check className="mr-1 h-3 w-3" />
          ) : (
            <Play className="mr-1 h-3 w-3" />
          )}
          {env.isActive ? '已激活' : '激活'}
        </Button>
      </Tooltip>
      <span className="text-pf-border">|</span>
      <Tooltip content="复制路径">
        <Button variant="ghost" size="sm" onClick={onCopyPath}>
          {copied ? <Check className="mr-1 h-3 w-3" /> : <Copy className="mr-1 h-3 w-3" />}
          {copied ? '已复制' : '复制路径'}
        </Button>
      </Tooltip>
      <Tooltip content="导出环境">
        <Button variant="ghost" size="sm" onClick={onExport}>
          <Download className="mr-1 h-3 w-3" />
          导出
        </Button>
      </Tooltip>
      <Tooltip content="查看依赖树">
        <Button variant="ghost" size="sm" onClick={onViewTree}>
          <GitBranch className="mr-1 h-3 w-3" />
          依赖树
        </Button>
      </Tooltip>
      <Tooltip content="删除环境">
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto text-state-error hover:text-state-error"
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
  onToggleSelect: () => void;
  onActivate: () => void;
  onCopyPath: () => void;
  onDelete: () => void;
  onExport: () => void;
  onViewTree: () => void;
}

const EnvironmentCard: React.FC<EnvironmentCardProps> = ({
  env,
  selected,
  copied,
  onToggleSelect,
  onActivate,
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
        env={env}
        copied={copied}
        onActivate={onActivate}
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
  onToggleSelect: () => void;
  onActivate: () => void;
  onCopyPath: () => void;
  onDelete: () => void;
  onExport: () => void;
  onViewTree: () => void;
}

const EnvironmentListRow: React.FC<EnvironmentListRowProps> = ({
  env,
  selected,
  copied,
  onToggleSelect,
  onActivate,
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
          env={env}
          copied={copied}
          onActivate={onActivate}
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
  const [environments, setEnvironments] = useState<VirtualEnvironment[]>([]);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | EnvironmentStatus>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [treeEnv, setTreeEnv] = useState<VirtualEnvironment | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pythonVersions, setPythonVersions] = useState<PythonVersion[]>([]);

  const [createName, setCreateName] = useState('');
  const [createVersion, setCreateVersion] = useState('');
  const [createLocation, setCreateLocation] = useState('');
  const [inheritGlobal, setInheritGlobal] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const [venvs, pythons] = await Promise.all([listVenvs(), scanPythonVersions()]);
        if (!mounted) return;
        setEnvironments(venvs);
        setPythonVersions(pythons);
        if (pythons[0]) {
          setCreateVersion(pythons[0].version);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : '加载环境数据失败');
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

  const handleActivate = (id: string) => {
    setEnvironments((prev) => prev.map((env) => ({ ...env, isActive: env.id === id })));
  };

  const handleCopyPath = async (env: VirtualEnvironment) => {
    try {
      await navigator.clipboard.writeText(env.path);
      setCopiedId(env.id);
      window.setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // Ignore clipboard errors in mock context
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

  const handleExport = (env: VirtualEnvironment) => {
    // Mock export action
    window.console.log('Export environment', env.name);
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

  const handleBulkExport = () => {
    window.console.log('Export environments', Array.from(selectedIds));
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
          <p className="text-sm text-pf-muted-foreground">创建、激活与删除虚拟环境</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            创建环境
          </Button>
          <Button variant="outline">
            <Upload className="mr-2 h-4 w-4" />
            导入环境
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
                onToggleSelect={() => toggleSelect(env.id)}
                onActivate={() => handleActivate(env.id)}
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
                      onToggleSelect={() => toggleSelect(env.id)}
                      onActivate={() => handleActivate(env.id)}
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
