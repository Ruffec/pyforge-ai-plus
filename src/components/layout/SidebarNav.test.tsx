import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { SidebarNav } from './SidebarNav';

const labels = ['控制台', 'Python 版本', '虚拟环境', '包与镜像源', 'AI 智能部署', '设置'];

describe('SidebarNav', () => {
  it('renders all navigation items', () => {
    render(
      <MemoryRouter>
        <SidebarNav />
      </MemoryRouter>
    );

    labels.forEach((label) => {
      expect(screen.getByText(label)).toBeInTheDocument();
    });
  });

  it('highlights the active route', () => {
    render(
      <MemoryRouter initialEntries={['/environments']}>
        <SidebarNav />
      </MemoryRouter>
    );

    const activeLink = screen.getByText('虚拟环境').closest('a');
    expect(activeLink).toHaveClass('bg-pf-primary/10');
    expect(activeLink).toHaveClass('text-pf-primary');
    expect(activeLink).toHaveClass('nav-active');
  });

  it('does not mark other routes as active', () => {
    render(
      <MemoryRouter initialEntries={['/packages']}>
        <SidebarNav />
      </MemoryRouter>
    );

    const dashboardLink = screen.getByText('控制台').closest('a');
    expect(dashboardLink).not.toHaveClass('nav-active');
  });
});
