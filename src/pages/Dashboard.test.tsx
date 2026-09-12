import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { Dashboard } from './Dashboard';

describe('Dashboard', () => {
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

    expect(screen.getByText('Python 版本数')).toBeInTheDocument();
    expect(screen.getByText('虚拟环境数')).toBeInTheDocument();
    expect(screen.getByText('已安装包数')).toBeInTheDocument();
    expect(screen.getByText('AI 部署次数')).toBeInTheDocument();

    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText('259')).toBeInTheDocument();
    expect(screen.getByText('18')).toBeInTheDocument();
  });

  it('renders the AI assistant and quick actions sections', async () => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.queryByText('加载中...')).not.toBeInTheDocument();
    });

    expect(screen.getByText('AI 智能助手')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/向 AI 助手提问/)).toBeInTheDocument();

    expect(screen.getByText('一键部署环境')).toBeInTheDocument();
    expect(screen.getByText('创建虚拟环境')).toBeInTheDocument();
    expect(screen.getByText('安装 Python')).toBeInTheDocument();
    expect(screen.getByText('配置镜像源')).toBeInTheDocument();
  });
});
