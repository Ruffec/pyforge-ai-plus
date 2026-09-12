import React, { useState } from 'react';
import { TopBar } from './TopBar';
import { SidebarNav } from './SidebarNav';

export interface AppShellProps {
  children: React.ReactNode;
}

const SIDEBAR_WIDTH = 240;
const TOP_BAR_HEIGHT = 56;

export const AppShell: React.FC<AppShellProps> = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-pf-background text-pf-foreground">
      <TopBar onMenuToggle={() => setSidebarOpen((prev) => !prev)} menuOpen={sidebarOpen} />

      {/* Desktop sidebar */}
      <aside
        className="fixed bottom-0 left-0 top-14 z-30 hidden lg:block"
        style={{ width: SIDEBAR_WIDTH }}
      >
        <SidebarNav />
      </aside>

      {/* Mobile overlay sidebar */}
      {sidebarOpen && (
        <>
          <div
            className="fixed inset-0 z-30 bg-black/50 lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
          <aside
            className="fixed bottom-0 left-0 top-14 z-40 w-[240px] lg:hidden"
            style={{ width: SIDEBAR_WIDTH }}
          >
            <SidebarNav onItemClick={() => setSidebarOpen(false)} />
          </aside>
        </>
      )}

      <main
        className="min-h-screen pt-14 transition-all lg:pl-[240px]"
        style={{ paddingLeft: 0 }}
      >
        <div
          className="min-h-[calc(100vh-3.5rem)] overflow-auto p-4 sm:p-6"
          style={{ minHeight: `calc(100vh - ${TOP_BAR_HEIGHT}px)` }}
        >
          {children}
        </div>
      </main>
    </div>
  );
};
