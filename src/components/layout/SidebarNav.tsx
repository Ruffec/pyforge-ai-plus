import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Code2,
  Boxes,
  Package,
  Sparkles,
  Settings,
  FolderGit2,
} from 'lucide-react';

export interface NavItem {
  label: string;
  to: string;
  icon: React.ElementType;
  badge?: string;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const navSections: NavSection[] = [
  {
    title: '概览',
    items: [
      { label: '控制台', to: '/', icon: LayoutDashboard },
    ],
  },
  {
    title: '环境管理',
    items: [
      { label: 'Python 版本', to: '/python-versions', icon: Code2 },
      { label: '虚拟环境', to: '/environments', icon: Boxes },
      { label: '包与镜像源', to: '/packages', icon: Package },
      { label: '项目管理', to: '/projects', icon: FolderGit2 },
    ],
  },
  {
    title: 'AI 工具',
    items: [
      { label: 'AI 智能部署', to: '/ai-deploy', icon: Sparkles, badge: 'New' },
    ],
  },
  {
    title: '系统',
    items: [
      { label: '设置', to: '/settings', icon: Settings },
    ],
  },
];

export interface SidebarNavProps {
  onItemClick?: () => void;
}

export const SidebarNav: React.FC<SidebarNavProps> = ({ onItemClick }) => {
  return (
    <nav className="flex h-full flex-col border-r border-pf-border bg-[var(--pf-sidebar-bg)]">
      {/* 导航列表 */}
      <div className="flex-1 overflow-y-auto py-3">
        {navSections.map((section, sectionIndex) => (
          <div key={section.title} className={sectionIndex > 0 ? 'mt-3' : ''}>
            {/* 分组标题 */}
            <div className="px-4 pb-1.5">
              <span className="text-[9px] font-semibold uppercase tracking-wider text-pf-muted-foreground">
                {section.title}
              </span>
            </div>

            {/* 导航项 */}
            <ul className="flex flex-col gap-0.5 px-3">
              {section.items.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.to === '/'}
                      onClick={onItemClick}
                      className={({ isActive }) =>
                        `group relative flex items-center gap-2.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-all duration-150 ${
                          isActive
                            ? 'bg-pf-primary/10 text-pf-primary nav-active'
                            : 'text-pf-muted-foreground hover:bg-pf-muted hover:text-pf-foreground'
                        }`
                      }
                    >
                      {/* 选中状态左侧指示条 */}
                      <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-pf-primary opacity-0 shadow-[0_0_6px_rgba(45,212,191,0.6)] group-[.nav-active]:opacity-100" />
                      <Icon className="h-3.5 w-3.5 shrink-0 transition-transform group-hover:scale-110" />
                      <span className="flex-1">{item.label}</span>
                      {item.badge && (
                        <span className="rounded-full bg-pf-primary/20 px-1.5 py-0.5 text-[8px] font-semibold text-pf-primary">
                          {item.badge}
                        </span>
                      )}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {/* 底部版本信息 */}
      <div className="border-t border-pf-border px-4 py-3">
        <span className="text-[10px] text-pf-muted-foreground">
          PyForge AI <span className="font-mono">v2.4.0</span>
        </span>
      </div>
    </nav>
  );
};
