import React, { useEffect, useState } from 'react';
import { Sun, Moon, Search, Bell, Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useUpdateStore } from '@/store/useUpdateStore';

export interface TopBarProps {
  title?: string;
  onMenuToggle?: () => void;
  menuOpen?: boolean;
}

export const TopBar: React.FC<TopBarProps> = ({
  onMenuToggle,
  menuOpen,
}) => {
  const updateStatus = useUpdateStore((s) => s.status);
  const updateVersion = useUpdateStore((s) => s.info?.version);
  const updateProgress = useUpdateStore((s) => s.progress);
  const startupCheck = useUpdateStore((s) => s.startupCheck);
  const installUpdate = useUpdateStore((s) => s.installUpdate);

  // 应用启动后静默检查一次更新（仅 Tauri 环境生效，store 内部有去重）
  useEffect(() => {
    void startupCheck();
  }, [startupCheck]);

  const [isDark, setIsDark] = useState(() => {
    if (typeof window !== 'undefined') {
      return document.documentElement.classList.contains('dark');
    }
    return true;
  });

  const toggleTheme = () => {
    const root = document.documentElement;
    const newIsDark = !isDark;
    setIsDark(newIsDark);
    if (newIsDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('pyforge-theme', newIsDark ? 'dark' : 'light');
  };

  return (
    <header className="fixed left-0 right-0 top-0 z-40 flex h-14 items-center justify-between border-b border-pf-border bg-pf-card/80 backdrop-blur-sm px-4">
      {/* 左侧：移动端菜单按钮 */}
      <div className="flex items-center gap-3">
        {onMenuToggle && (
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={onMenuToggle}
            aria-label={menuOpen ? '关闭菜单' : '打开菜单'}
            aria-expanded={menuOpen}
          >
            <span className="text-pf-foreground">☰</span>
          </Button>
        )}
      </div>

      {/* 中间：搜索框（桌面端显示） */}
      <div className="hidden md:flex flex-1 max-w-md mx-8">
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-pf-muted-foreground" />
          <input
            type="text"
            placeholder="搜索功能、包名、项目..."
            className="w-full rounded-lg border border-pf-border bg-pf-muted/50 py-1.5 pl-9 pr-16 text-sm text-pf-foreground placeholder:text-pf-muted-foreground focus:outline-none focus:ring-2 focus:ring-pf-ring focus:border-transparent transition-all"
          />
          <kbd className="absolute right-3 top-1/2 -translate-y-1/2 rounded border border-pf-border bg-pf-card px-1.5 py-0.5 text-[10px] font-mono text-pf-muted-foreground">
            ⌘K
          </kbd>
        </div>
      </div>

      {/* 右侧：操作按钮 */}
      <div className="flex items-center gap-1">
        {/* 更新入口：发现新版本时出现，点击直接下载安装 */}
        {updateStatus === 'available' && updateVersion && (
          <button
            type="button"
            onClick={() => void installUpdate()}
            title={`发现新版本 ${updateVersion}，点击下载并安装`}
            className="mr-1 inline-flex h-7 items-center gap-1.5 rounded-full bg-pf-primary/10 px-2.5 text-[11px] font-medium text-pf-primary transition-colors hover:bg-pf-primary/20"
          >
            <Download className="h-3 w-3" />
            更新 {updateVersion}
          </button>
        )}

        {/* 更新下载进度 */}
        {updateStatus === 'downloading' && (
          <div
            className="mr-1 inline-flex h-7 items-center gap-1.5 rounded-full bg-pf-primary/10 px-2.5 text-[11px] font-medium text-pf-primary"
            title={`正在下载更新 ${Math.round(updateProgress)}%`}
          >
            <Loader2 className="h-3 w-3 animate-spin" />
            {Math.round(updateProgress)}%
          </div>
        )}

        {/* 更新安装中 */}
        {updateStatus === 'installing' && (
          <div
            className="mr-1 inline-flex h-7 items-center gap-1.5 rounded-full bg-pf-primary/10 px-2.5 text-[11px] font-medium text-pf-primary"
            title="正在安装更新，完成后将自动重启"
          >
            <Loader2 className="h-3 w-3 animate-spin" />
            安装中
          </div>
        )}

        {/* 通知按钮 */}
        <button
          type="button"
          className="relative inline-flex h-7 w-8 items-center justify-center rounded text-pf-muted-foreground hover:bg-pf-muted hover:text-pf-foreground transition-colors"
          aria-label="通知"
        >
          <Bell className="h-3.5 w-3.5" />
          <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-state-error" />
        </button>

        {/* 主题切换按钮 */}
        <button
          type="button"
          onClick={toggleTheme}
          className="inline-flex h-7 w-8 items-center justify-center rounded text-pf-muted-foreground hover:bg-pf-muted hover:text-pf-foreground transition-colors"
          aria-label={isDark ? '切换到浅色模式' : '切换到深色模式'}
        >
          {isDark ? (
            <Sun className="h-3.5 w-3.5" />
          ) : (
            <Moon className="h-3.5 w-3.5" />
          )}
        </button>

        {/* 环境状态指示器 */}
        <div className="ml-2 flex items-center gap-1.5 rounded-full bg-pf-muted/50 px-2.5 py-1">
          <span className="h-1.5 w-1.5 rounded-full bg-state-success animate-pulse" />
          <span className="text-[11px] font-medium text-pf-muted-foreground">已连接</span>
        </div>
      </div>
    </header>
  );
};
