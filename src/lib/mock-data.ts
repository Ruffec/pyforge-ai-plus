import type {
  ChatMessage,
  DeploymentPlan,
  ProjectAnalysis,
  Recommendation,
} from '@/types/ai-deploy';
import type {
  ActivityItem,
  EnvironmentSummary,
  QuickAction,
  StatCardData,
} from '@/types/dashboard';
import type { VirtualEnvironment } from '@/types/environments';
import type { Package, PipMirror } from '@/types/packages';
import type { PythonOrgRelease, PythonVersion } from '@/types/python-versions';
import type { AppInfo } from '@/types/settings';

export const mockStats: StatCardData[] = [
  { label: 'Python 版本数', value: '3', suffix: '已安装', icon: 'Boxes', trend: '+1 本月' },
  { label: '虚拟环境数', value: '7', suffix: '个环境', icon: 'Layers', trend: '2 个活跃' },
  { label: '已安装包数', value: '248', suffix: '个包', icon: 'Package', trend: '+12 今天' },
  { label: 'AI 部署次数', value: '18', suffix: '次部署', icon: 'Rocket', trend: '成功率 100%' },
];

export const mockQuickActions: QuickAction[] = [
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

export const mockEnvironments: EnvironmentSummary[] = [
  {
    id: '1',
    name: 'my-project',
    pythonVersion: '3.12.4',
    status: 'active',
    packageCount: 42,
    lastUsed: '2小时前',
  },
  {
    id: '2',
    name: 'data-science',
    pythonVersion: '3.11.6',
    status: 'idle',
    packageCount: 128,
    lastUsed: '昨天',
  },
  {
    id: '3',
    name: 'web-api',
    pythonVersion: '3.12.4',
    status: 'active',
    packageCount: 67,
    lastUsed: '正在使用',
  },
  {
    id: '4',
    name: 'ml-experiments',
    pythonVersion: '3.10.13',
    status: 'update-available',
    packageCount: 89,
    lastUsed: '3天前',
  },
  {
    id: '5',
    name: 'scripts',
    pythonVersion: '3.9.18',
    status: 'idle',
    packageCount: 12,
    lastUsed: '1周前',
  },
];

export const mockActivities: ActivityItem[] = [
  {
    id: '1',
    title: `安装了 Python 3.12.4`,
    timestamp: '10分钟前',
  },
  {
    id: '2',
    title: `创建了环境 'web-api'`,
    timestamp: '1小时前',
  },
  { id: '3', title: '更新了 12 个包', timestamp: '3小时前' },
  { id: '4', title: '配置了清华镜像源', timestamp: '昨天' },
  {
    id: '5',
    title: `导出了 'data-science' 环境`,
    timestamp: '2天前',
    variant: 'muted',
  },
];

export const mockPythonVersions: PythonVersion[] = [
  {
    id: 'py-3.12.4',
    version: '3.12.4',
    path: '/usr/local/python3.12.4/bin/python',
    isActive: true,
    pipVersion: '24.2',
    packagesCount: 42,
    lastUsed: '2024-08-07',
    releaseDate: '2024-06-06',
    architecture: 'arm64',
    size: '89.2 MB',
    dependencies: [
      { name: 'pip', version: '24.2' },
      { name: 'setuptools', version: '70.0' },
      { name: 'wheel', version: '0.43' },
    ],
    envVars: [
      { key: 'PYTHON_HOME', value: '/usr/local/python3.12.4' },
      { key: 'PYTHONPATH', value: '/usr/local/python3.12.4/lib' },
    ],
  },
  {
    id: 'py-3.11.6',
    version: '3.11.6',
    path: '/usr/local/python3.11.6/bin/python',
    isActive: false,
    pipVersion: '24.1',
    packagesCount: 128,
    lastUsed: '2024-07-12',
    releaseDate: '2023-10-02',
    architecture: 'arm64',
    size: '76.8 MB',
    dependencies: [
      { name: 'pip', version: '24.1' },
      { name: 'setuptools', version: '69.5' },
      { name: 'wheel', version: '0.42' },
    ],
    envVars: [
      { key: 'PYTHON_HOME', value: '/usr/local/python3.11.6' },
      { key: 'PYTHONPATH', value: '/usr/local/python3.11.6/lib' },
    ],
  },
  {
    id: 'py-3.10.13',
    version: '3.10.13',
    path: '/usr/local/python3.10.13/bin/python',
    isActive: false,
    pipVersion: '23.3',
    packagesCount: 89,
    lastUsed: '2024-05-30',
    releaseDate: '2023-08-24',
    architecture: 'x86_64',
    size: '71.5 MB',
    dependencies: [
      { name: 'pip', version: '23.3' },
      { name: 'setuptools', version: '68.2' },
      { name: 'wheel', version: '0.41' },
    ],
    envVars: [
      { key: 'PYTHON_HOME', value: '/usr/local/python3.10.13' },
      { key: 'PYTHONPATH', value: '/usr/local/python3.10.13/lib' },
    ],
  },
];

export const availablePythonVersions = [
  { version: '3.13.0', label: '最新稳定版', releaseDate: '2024-10-07', size: '92.1 MB' },
  { version: '3.12.5', label: 'Bug 修复', releaseDate: '2024-08-06', size: '89.5 MB' },
  { version: '3.9.19', label: '安全更新', releaseDate: '2024-03-12', size: '68.3 MB' },
];

/** 浏览器预览环境的 python.org 稳定版本 fallback 数据 */
export const mockPythonOrgReleases: PythonOrgRelease[] = [
  { version: '3.14.0', releaseDate: '2025-10-07', releasePageUrl: 'https://www.python.org/downloads/release/python-3140/', isLatest: true },
  { version: '3.13.9', releaseDate: '2025-10-14', releasePageUrl: 'https://www.python.org/downloads/release/python-1399/', isLatest: false },
  { version: '3.13.8', releaseDate: '2025-08-27', releasePageUrl: 'https://www.python.org/downloads/release/python-1388/', isLatest: false },
  { version: '3.12.11', releaseDate: '2025-06-03', releasePageUrl: 'https://www.python.org/downloads/release/python-12111/', isLatest: false },
  { version: '3.11.13', releaseDate: '2025-04-08', releasePageUrl: 'https://www.python.org/downloads/release/python-11113/', isLatest: false },
];

export const pythonVersionOptions = ['3.12.4', '3.11.6', '3.10.13', '3.9.18'];

export const mockVirtualEnvironments: VirtualEnvironment[] = [
  {
    id: 'env-my-project',
    name: 'my-project',
    pythonVersion: '3.12.4',
    path: '~/.pyforge/envs/my-project',
    size: '1.2 GB / 5 GB',
    status: 'active',
    packagesCount: 42,
    createdAt: '2024-06-12',
    isActive: false,
    usagePercent: 24,
    dependencyTree: [
      {
        name: 'requests',
        version: '2.32.0',
        children: [
          { name: 'charset-normalizer', version: '3.3.2' },
          { name: 'idna', version: '3.7' },
          { name: 'urllib3', version: '2.2.1' },
        ],
      },
      { name: 'pydantic', version: '2.7.0' },
    ],
  },
  {
    id: 'env-data-science',
    name: 'data-science',
    pythonVersion: '3.11.6',
    path: '~/.pyforge/envs/data-science',
    size: '3.8 GB / 5 GB',
    status: 'idle',
    packagesCount: 128,
    createdAt: '2024-05-20',
    isActive: false,
    usagePercent: 76,
    dependencyTree: [
      {
        name: 'numpy',
        version: '1.26.4',
        children: [{ name: 'ml-dtypes', version: '0.3.2' }],
      },
      {
        name: 'pandas',
        version: '2.2.2',
        children: [
          { name: 'numpy', version: '1.26.4' },
          { name: 'python-dateutil', version: '2.9.0' },
        ],
      },
    ],
  },
  {
    id: 'env-web-api',
    name: 'web-api',
    pythonVersion: '3.12.4',
    path: '~/.pyforge/envs/web-api',
    size: '890 MB / 5 GB',
    status: 'active',
    packagesCount: 67,
    createdAt: '2024-07-03',
    isActive: true,
    usagePercent: 18,
    dependencyTree: [
      {
        name: 'fastapi',
        version: '0.111.0',
        children: [
          { name: 'starlette', version: '0.37.2' },
          { name: 'pydantic', version: '2.7.0' },
        ],
      },
      { name: 'uvicorn', version: '0.29.0' },
    ],
  },
  {
    id: 'env-ml-experiments',
    name: 'ml-experiments',
    pythonVersion: '3.10.13',
    path: '~/.pyforge/envs/ml-experiments',
    size: '4.2 GB / 5 GB',
    status: 'needs_update',
    packagesCount: 89,
    createdAt: '2024-03-15',
    isActive: false,
    usagePercent: 84,
    dependencyTree: [
      {
        name: 'torch',
        version: '2.3.0',
        children: [{ name: 'filelock', version: '3.14.0' }],
      },
      { name: 'scikit-learn', version: '1.5.0' },
    ],
  },
  {
    id: 'env-scripts',
    name: 'scripts',
    pythonVersion: '3.9.18',
    path: '~/.pyforge/envs/scripts',
    size: '156 MB / 5 GB',
    status: 'idle',
    packagesCount: 12,
    createdAt: '2024-01-10',
    isActive: false,
    usagePercent: 3,
    dependencyTree: [
      { name: 'click', version: '8.1.7' },
      { name: 'rich', version: '13.7.1' },
    ],
  },
  {
    id: 'env-api-staging',
    name: 'api-staging',
    pythonVersion: '3.12.0',
    path: '~/.pyforge/envs/api-staging',
    size: '0 MB / 5 GB',
    status: 'corrupted',
    packagesCount: 0,
    createdAt: '2024-02-28',
    isActive: false,
    usagePercent: 0,
    dependencyTree: [],
  },
];

export const mockMirrors: PipMirror[] = [
  { id: 'tsinghua', name: '清华大学', url: 'https://pypi.tuna.tsinghua.edu.cn/simple', latencyMs: 12, isActive: true },
  { id: 'aliyun', name: '阿里云', url: 'https://mirrors.aliyun.com/pypi/simple/', latencyMs: 18, isActive: false },
  { id: 'tencent', name: '腾讯云', url: 'https://mirrors.cloud.tencent.com/pypi/simple/', latencyMs: 25, isActive: false },
  { id: 'ustc', name: '中科大', url: 'https://pypi.mirrors.ustc.edu.cn/simple', latencyMs: 31, isActive: false },
  { id: 'douban', name: '豆瓣', url: 'https://pypi.doubanio.com/simple/', latencyMs: undefined, isActive: false },
  { id: 'official', name: '官方源', url: 'https://pypi.org/simple/', latencyMs: 156, isActive: false },
];

export const mockInstalledPackages: Package[] = [
  { id: '1', name: 'numpy', version: '1.26.4', latestVersion: '2.0.1', size: '18.5 MB' },
  { id: '2', name: 'pandas', version: '2.2.2', latestVersion: '2.2.2', size: '42.1 MB' },
  { id: '3', name: 'flask', version: '3.0.3', latestVersion: '3.0.3', size: '3.2 MB' },
  { id: '4', name: 'django', version: '4.2.13', latestVersion: '5.0.7', size: '28.7 MB' },
  { id: '5', name: 'requests', version: '2.32.3', latestVersion: '2.32.3', size: '1.1 MB' },
  { id: '6', name: 'scikit-learn', version: '1.5.0', latestVersion: '1.5.1', size: '15.3 MB' },
  { id: '7', name: 'matplotlib', version: '3.9.0', latestVersion: '3.9.0', size: '12.8 MB' },
  { id: '8', name: 'torch', version: '2.3.1', latestVersion: '2.4.0', size: '156.4 MB' },
];

export const mockSearchPackages: Package[] = [
  { id: 's1', name: 'numpy', version: '2.0.1', description: '科学计算基础包', size: '18.5 MB' },
  { id: 's2', name: 'pandas', version: '2.2.2', description: '数据分析与处理', size: '42.1 MB' },
  { id: 's3', name: 'flask', version: '3.0.3', description: '轻量级 Web 框架', size: '3.2 MB' },
  { id: 's4', name: 'django', version: '5.0.7', description: '全功能 Web 框架', size: '28.7 MB' },
  { id: 's5', name: 'requests', version: '2.32.3', description: 'HTTP 请求库', size: '1.1 MB' },
  { id: 's6', name: 'scikit-learn', version: '1.5.1', description: '机器学习工具包', size: '15.3 MB' },
  { id: 's7', name: 'torch', version: '2.4.0', description: '深度学习框架', size: '156.4 MB' },
];

export const mockEnvironmentNames = ['my-project', 'data-science', 'web-api', 'ml-experiments', 'scripts'];

export const quickPackages = ['numpy', 'pandas', 'flask', 'django', 'requests', 'scikit-learn', 'torch'];

export const mockDeploymentPlan: DeploymentPlan = {
  pythonVersion: '3.12.4',
  dependencies: [
    { name: 'flask', version: '3.0.3' },
    { name: 'sqlalchemy', version: '2.0.30' },
    { name: 'redis', version: '5.0.7' },
    { name: 'celery', version: '5.4.0' },
    { name: 'gunicorn', version: '22.0.0' },
  ],
  commands: [
    'pyforge ai-deploy --project ./web-api-project',
    'python -m venv web-api-env',
    'source web-api-env/bin/activate',
    'pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple',
    'gunicorn -w 4 -b 0.0.0.0:8000 app:app',
  ],
  steps: [
    { id: '1', label: '项目分析', description: '扫描项目文件', status: 'completed' },
    { id: '2', label: 'AI 推荐', description: '生成配置方案', status: 'completed' },
    { id: '3', label: '一键部署', description: '正在部署...', status: 'in-progress' },
    { id: '4', label: '完成', description: '环境就绪', status: 'pending' },
  ],
};

export const mockProjectAnalysis: ProjectAnalysis = {
  name: 'web-api-project',
  type: 'Flask Web 应用',
  pythonVersion: '3.12.4',
  dependencyFile: 'requirements.txt',
  dependencyCount: 23,
  size: '45.2 MB',
};

export const mockRecommendations: Recommendation[] = [
  { id: '1', icon: 'Zap', title: '使用 Python 3.12.4', description: '最佳性能与兼容性', applied: true },
  { id: '2', icon: 'Globe', title: '配置清华镜像源', description: '下载速度提升 10x', applied: true },
  { id: '3', icon: 'Layers', title: '创建独立虚拟环境', description: '隔离依赖避免冲突', applied: true },
  { id: '4', icon: 'Shield', title: '安装安全更新', description: '3 个包有安全漏洞', applied: false },
  { id: '5', icon: 'Gauge', title: '优化启动配置', description: '添加 Gunicorn 生产配置', applied: false },
];

export const mockInitialMessages: ChatMessage[] = [
  {
    id: 'welcome',
    role: 'assistant',
    content:
      '您好！我是 PyForge AI 部署助手。我可以帮您分析项目依赖、推荐 Python 版本、生成部署方案并一键完成环境搭建。请描述您的项目或选择下方快捷操作。',
    timestamp: new Date(Date.now() - 1000 * 60 * 5),
  },
];

export const mockTerminalLines: string[] = [
  '$ pyforge ai-deploy --project ./web-api-project',
  '→ AI 正在分析项目结构...',
  '✓ 检测到 Flask Web 应用',
  '✓ 识别 23 个依赖包',
  '→ AI 推荐: Python 3.12.4 + 清华镜像源',
  '→ 创建虚拟环境 web-api-env...',
  '✓ 虚拟环境创建成功',
  '→ 安装依赖包 [15/23]...',
  '  → 安装 flask-3.0.3...',
  '  → 安装 sqlalchemy-2.0.30...',
  '  → 安装 redis-5.0.7...',
];

export const aiDeployQuickActions = [
  '部署 Flask 项目',
  '部署 FastAPI 项目',
  '分析 requirements.txt',
];

export const mockAppInfo: AppInfo = {
  name: 'PyForge AI',
  version: '2.4.0',
  copyright: '© 2024 PyForge AI',
  platform: `${navigator.platform ?? 'Unknown'} · ${navigator.userAgent ?? ''}`,
};

export const defaultPaths = {
  pythonInstallationsPath: '/usr/local/python',
  virtualEnvironmentsRoot: '~/.pyforge/envs',
  cacheDirectory: '~/.pyforge/cache',
};

export const accentColors = [
  { value: 'teal' as const, label: '青绿', className: 'bg-pf-primary' },
  { value: 'blue' as const, label: '蓝色', className: 'bg-state-info' },
  { value: 'amber' as const, label: '琥珀', className: 'bg-state-warning' },
  { value: 'red' as const, label: '红色', className: 'bg-state-error' },
  { value: 'green' as const, label: '绿色', className: 'bg-state-success' },
];

export const fontSizeOptions = [
  { value: 'small' as const, label: '小' },
  { value: 'medium' as const, label: '中' },
  { value: 'large' as const, label: '大' },
];
