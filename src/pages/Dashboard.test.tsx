/**
 * 控制台页面测试：
 * 数据层统一后 Dashboard 严格从后端获取真实数据（网页模式走 HTTP 桥接 RPC），
 * 这里 mock 的是传输通道（fetch），业务数值由前端按后端返回真实计算。
 */
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Dashboard } from './Dashboard';

const rpcOk = (data: unknown) =>
  new Response(JSON.stringify({ ok: true, data }), { status: 200 });

function stubBackendFetch() {
  const versions = Array.from({ length: 3 }, (_, i) => ({
    id: `py-${i}`,
    version: `3.${12 - i}.0`,
    path: `C:/Python/python3${i}.exe`,
    is_active: i === 0,
    pip_version: '24.0',
    packages_count: 100,
    architecture: 'x86_64',
  }));
  const venvs = Array.from({ length: 6 }, (_, i) => ({
    id: `venv-${i}`,
    name: `env-${i}`,
    python_version: '3.12.0',
    path: `C:/envs/env-${i}`,
    size_bytes: 1024,
    packages_count: 5,
    status: i === 0 ? 'active' : 'idle',
    created_at: Date.now(),
  }));
  const tasks = Array.from({ length: 18 }, (_, i) => ({
    id: `task-${i}`,
    task_type: 'package_install',
    status: i < 5 ? 'completed' : 'running',
    message: `任务 ${i}`,
    created_at: Date.now(),
    updated_at: Date.now(),
  }));

  return vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse((init?.body as string) ?? '{}');
    switch (body.command) {
      case 'get_platform_info':
        return rpcOk({
          os_type: 'windows',
          os_version: '11',
          architecture: 'x86_64',
          shell: 'powershell',
        });
      case 'scan_python_versions_command':
        return rpcOk(versions);
      case 'list_venvs':
        return rpcOk(venvs);
      case 'list_tasks_command':
        return rpcOk(tasks);
      default:
        return rpcOk(null);
    }
  });
}

describe('Dashboard', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = stubBackendFetch();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders dashboard headings and stat cards after loading', async () => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    expect(screen.getByText('控制台')).toBeInTheDocument();
    expect(screen.getByText(/欢迎回来/)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.queryByText('加载中...')).not.toBeInTheDocument();
    });

    // KPI 卡片标签（AI 部署次数等旧模块已移除）
    expect(screen.getByText('Python 版本数')).toBeInTheDocument();
    expect(screen.getByText('虚拟环境数')).toBeInTheDocument();
    expect(screen.getByText('已安装包数')).toBeInTheDocument();
    expect(screen.getByText('累计任务数')).toBeInTheDocument();

    // 数值由后端真实数据计算：3 个版本 / 6 个环境 / 300 个包（3×100）/ 18 个任务
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText('300')).toBeInTheDocument();
    expect(screen.getByText('18')).toBeInTheDocument();

    // 后端命令确实被调用（无任何本地假数据兜底）
    const commands = fetchMock.mock.calls.map(
      ([, init]) => JSON.parse((init as RequestInit).body as string).command
    );
    expect(commands).toContain('scan_python_versions_command');
    expect(commands).toContain('list_venvs');
    expect(commands).toContain('list_tasks_command');
  });

  it('renders quick actions and confirms the AI assistant module is removed', async () => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.queryByText('加载中...')).not.toBeInTheDocument();
    });

    // AI 助手模块已从控制台移除（功能统一收口至 AI 智能部署页）
    expect(screen.queryByText('AI 智能助手')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/向 AI 助手提问/)).not.toBeInTheDocument();
    expect(screen.queryByText('AI 部署次数')).not.toBeInTheDocument();

    expect(screen.getByText('一键部署环境')).toBeInTheDocument();
    expect(screen.getByText('创建虚拟环境')).toBeInTheDocument();
    expect(screen.getByText('安装 Python')).toBeInTheDocument();
    expect(screen.getByText('配置镜像源')).toBeInTheDocument();
  });
});
