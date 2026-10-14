/**
 * 项目管理页面
 *
 * 扫描、管理 Python 项目，支持项目识别、依赖解析、环境关联。
 */

import { useState, useEffect, useCallback } from 'react';
import { FolderOpen, RefreshCw, Play, Search, Package, GitBranch, FlaskConical, Box } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog';
import {
  useSelectionStore,
  useSuccessNotification,
  useErrorNotification,
} from '@/store/useAppStore';
import type { ProjectInfo, ProjectScanResult } from '@/types/app-types';
import {
  CHANNELS,
  createVenv,
  detectProject,
  getConfig,
  scanProjects,
  scanPythonVersions,
  subscribeEvent,
} from '@/lib/tauri-api';
import { logUserAction, logUserError } from '@/lib/user-log';

const projectTypeIcons: Record<string, typeof Box> = {
  standard: Box,
  poetry: Package,
  pdm: Package,
  pipenv: Package,
  conda: Package,
  setuptools: Box,
  flask: FlaskConical,
  django: Box,
  fastapi: FlaskConical,
  data_science: Box,
  unknown: Box,
};

const projectTypeLabels: Record<string, string> = {
  standard: '标准项目',
  poetry: 'Poetry',
  pdm: 'PDM',
  pipenv: 'Pipenv',
  conda: 'Conda',
  setuptools: 'Setuptools',
  flask: 'Flask',
  django: 'Django',
  fastapi: 'FastAPI',
  data_science: '数据科学',
  unknown: '未知',
};

export function Projects() {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [scanPath, setScanPath] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProject, setSelectedProject] = useState<ProjectInfo | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [scanResult, setScanResult] = useState<ProjectScanResult | null>(null);

  const setSelectedProjectStore = useSelectionStore((s) => s.setSelectedProject);
  const showSuccess = useSuccessNotification();
  const showError = useErrorNotification();

  const loadRecentProjects = useCallback(async () => {
    try {
      const config = await getConfig();
      const recentPaths = config?.general?.recent_projects ?? [];
      const loadedProjects: ProjectInfo[] = [];

      for (const path of recentPaths) {
        try {
          const project = await detectProject(path);
          if (project) {
            loadedProjects.push(project as unknown as ProjectInfo);
          }
        } catch {
          // 忽略单个项目加载失败
        }
      }
      setProjects(loadedProjects);
    } catch (err) {
      console.error('加载最近项目失败:', err);
    }
  }, []);

  // 加载最近项目：回调为稳定引用，仅挂载时执行一次
  useEffect(() => {
    void loadRecentProjects();
  }, [loadRecentProjects]);

  // 跨端实时同步：配置变更（最近项目列表变化）时自动刷新
  useEffect(() => {
    const off = subscribeEvent(CHANNELS.configChanged, () => void loadRecentProjects());
    return () => {
      void off.then((fn) => fn());
    };
  }, [loadRecentProjects]);

  const handleScan = useCallback(async () => {
    const root = scanPath.trim();
    if (!root) {
      showError('扫描路径不能为空', '请输入要扫描的目录路径');
      return;
    }

    setIsScanning(true);
    logUserAction(`扫描项目: 路径=${root}, 深度=3`);
    try {
      const result = await scanProjects(root, 3);
      setScanResult(result as unknown as ProjectScanResult);
      setProjects(result.projects as unknown as ProjectInfo[]);
      logUserAction(`扫描项目: 完成，发现 ${result.projects.length} 个项目，扫描 ${result.directories_scanned} 个目录`);
      showSuccess('扫描完成', `发现 ${result.projects.length} 个 Python 项目，扫描了 ${result.directories_scanned} 个目录`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '未知错误';
      logUserError(`扫描项目: 失败 (路径=${root}) - ${msg}`);
      showError('扫描失败', msg);
    } finally {
      setIsScanning(false);
    }
  }, [scanPath, showSuccess, showError]);

  const handleSelectProject = useCallback(
    (project: ProjectInfo) => {
      setSelectedProject(project);
      setSelectedProjectStore(project);
      setShowDetail(true);
    },
    [setSelectedProjectStore]
  );

  const handleCreateVenv = useCallback(
    async (project: ProjectInfo) => {
      logUserAction(`创建项目虚拟环境: 项目=${project.name} (${project.path})`);
      try {
        // 使用当前活跃（或首个可用）Python 解释器，在默认根目录创建项目虚拟环境
        const versions = await scanPythonVersions();
        const python = versions.find((v) => v.isActive) ?? versions[0];
        if (!python) {
          logUserError(`创建项目虚拟环境: ${project.name} 失败 - 无可用 Python`);
          showError('无可用 Python', '未检测到已安装的 Python，请先在「Python 版本」页安装');
          return;
        }
        const venv = await createVenv(`${project.name}-env`, python.path, '');
        logUserAction(`创建项目虚拟环境: ${project.name} 成功 (venv=${venv.name}, python=${python.version})`);
        showSuccess('虚拟环境已创建', `${venv.name}（Python ${python.version}）已创建，可在「环境管理」页查看`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : '未知错误';
        logUserError(`创建项目虚拟环境: ${project.name} 失败 - ${msg}`);
        showError('创建失败', msg);
      }
    },
    [showSuccess, showError]
  );

  const filteredProjects = projects.filter((project) =>
    project.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    project.path.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">项目管理</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            扫描和管理 Python 项目，自动识别项目类型和依赖
          </p>
        </div>
      </div>

      {/* 扫描区域 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="w-5 h-5" />
            项目扫描
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            <Input
              placeholder="输入要扫描的目录路径，例如 /home/user/projects"
              value={scanPath}
              onChange={(e) => setScanPath(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleScan()}
              className="flex-1"
            />
            <Button onClick={handleScan} disabled={isScanning}>
              {isScanning ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  扫描中...
                </>
              ) : (
                <>
                  <FolderOpen className="w-4 h-4 mr-2" />
                  扫描
                </>
              )}
            </Button>
          </div>
          {scanResult && (
            <div className="mt-3 text-sm text-gray-500 dark:text-gray-400">
              扫描路径: {scanResult.root_path} | 扫描目录: {scanResult.directories_scanned} | 耗时: {scanResult.scan_time_ms}ms
            </div>
          )}
        </CardContent>
      </Card>

      {/* 项目列表 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>项目列表 ({filteredProjects.length})</CardTitle>
            <Input
              placeholder="搜索项目..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-64"
            />
          </div>
        </CardHeader>
        <CardContent>
          {filteredProjects.length === 0 ? (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">
              <FolderOpen className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>暂无项目，请扫描目录或添加项目</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>项目名称</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>Python 版本</TableHead>
                  <TableHead>依赖数</TableHead>
                  <TableHead>路径</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProjects.map((project) => {
                  const TypeIcon = projectTypeIcons[project.project_type] || Box;
                  return (
                    <TableRow
                      key={project.path}
                      className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800"
                      onClick={() => handleSelectProject(project)}
                    >
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <TypeIcon className="w-4 h-4 text-blue-500" />
                          <span className="font-medium">{project.name}</span>
                          {project.has_tests && <Badge variant="secondary">测试</Badge>}
                          {project.has_docker && <Badge variant="secondary">Docker</Badge>}
                          {project.has_ci && <Badge variant="secondary">CI</Badge>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge>{projectTypeLabels[project.project_type] || project.project_type}</Badge>
                      </TableCell>
                      <TableCell>{project.python_version || '-'}</TableCell>
                      <TableCell>{project.dependencies.length}</TableCell>
                      <TableCell className="max-w-xs truncate text-sm text-gray-500">
                        {project.path}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCreateVenv(project);
                            }}
                          >
                            <Play className="w-3 h-3 mr-1" />
                            创建环境
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* 项目详情对话框 */}
      <Dialog open={showDetail} onOpenChange={setShowDetail}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>项目详情 - {selectedProject?.name}</DialogTitle>
          </DialogHeader>
          {selectedProject && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-gray-500">项目类型</label>
                  <p className="mt-1">{projectTypeLabels[selectedProject.project_type]}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500">Python 版本</label>
                  <p className="mt-1">{selectedProject.python_version || '未指定'}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500">项目版本</label>
                  <p className="mt-1">{selectedProject.version || '未指定'}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500">关联虚拟环境</label>
                  <p className="mt-1 text-sm">{selectedProject.associated_venv || '未关联'}</p>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-500">项目路径</label>
                <p className="mt-1 text-sm font-mono bg-gray-100 dark:bg-gray-800 p-2 rounded">
                  {selectedProject.path}
                </p>
              </div>

              {selectedProject.description && (
                <div>
                  <label className="text-sm font-medium text-gray-500">描述</label>
                  <p className="mt-1">{selectedProject.description}</p>
                </div>
              )}

              <div>
                <label className="text-sm font-medium text-gray-500">
                  依赖文件 ({selectedProject.dependency_files.length})
                </label>
                <div className="mt-1 flex flex-wrap gap-2">
                  {selectedProject.dependency_files.map((file) => (
                    <Badge key={file} variant="secondary">
                      <GitBranch className="w-3 h-3 mr-1" />
                      {file}
                    </Badge>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-500">
                  生产依赖 ({selectedProject.dependencies.length})
                </label>
                <div className="mt-1 max-h-40 overflow-y-auto border rounded-lg">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>包名</TableHead>
                        <TableHead>版本约束</TableHead>
                        <TableHead>来源</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedProject.dependencies.map((dep, idx) => (
                        <TableRow key={`${dep.name}-${idx}`}>
                          <TableCell className="font-medium">{dep.name}</TableCell>
                          <TableCell>{dep.version_constraint || '最新'}</TableCell>
                          <TableCell className="text-sm text-gray-500">{dep.source}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {selectedProject.dev_dependencies.length > 0 && (
                <div>
                  <label className="text-sm font-medium text-gray-500">
                    开发依赖 ({selectedProject.dev_dependencies.length})
                  </label>
                  <div className="mt-1 max-h-40 overflow-y-auto border rounded-lg">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>包名</TableHead>
                          <TableHead>版本约束</TableHead>
                          <TableHead>来源</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedProject.dev_dependencies.map((dep, idx) => (
                          <TableRow key={`${dep.name}-${idx}`}>
                            <TableCell className="font-medium">{dep.name}</TableCell>
                            <TableCell>{dep.version_constraint || '最新'}</TableCell>
                            <TableCell className="text-sm text-gray-500">{dep.source}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default Projects;
