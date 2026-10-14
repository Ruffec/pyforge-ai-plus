import { Suspense, lazy, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { PageLoader } from '@/components/ui/PageLoader';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { NotificationContainer } from '@/components/ui/Notification';
import { TopBar } from '@/components/layout/TopBar';
import { SidebarNav } from '@/components/layout/SidebarNav';
import { BridgeBanner } from '@/components/layout/BridgeBanner';
import { useScrollbarAutoHide } from '@/hooks/useScrollbarAutoHide';

const Dashboard = lazy(() => import('@/pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const PythonVersions = lazy(() => import('@/pages/PythonVersions').then((m) => ({ default: m.PythonVersions })));
const Environments = lazy(() => import('@/pages/Environments').then((m) => ({ default: m.Environments })));
const Packages = lazy(() => import('@/pages/Packages').then((m) => ({ default: m.Packages })));
const AiDeploy = lazy(() => import('@/pages/AiDeploy').then((m) => ({ default: m.AiDeploy })));
const Projects = lazy(() => import('@/pages/Projects').then((m) => ({ default: m.Projects })));
const Settings = lazy(() => import('@/pages/Settings').then((m) => ({ default: m.Settings })));

const SIDEBAR_WIDTH = 240;

function AppContent() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // 全局细柱滚动条 3 秒自动渐隐
  useScrollbarAutoHide();

  return (
    <div className="min-h-screen bg-pf-background text-pf-foreground">
      <TopBar onMenuToggle={() => setSidebarOpen((prev) => !prev)} menuOpen={sidebarOpen} />
      <BridgeBanner />

      {/* Desktop sidebar */}
      <aside
        className="fixed bottom-0 left-0 top-12 z-30 hidden lg:block"
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
            className="fixed bottom-0 left-0 top-12 z-40 w-[240px] lg:hidden"
            style={{ width: SIDEBAR_WIDTH }}
          >
            <SidebarNav onItemClick={() => setSidebarOpen(false)} />
          </aside>
        </>
      )}

      <main className="min-h-screen pt-12 transition-all lg:pl-[240px]">
        <div
          className="min-h-[calc(100vh-3rem)] overflow-auto p-3 sm:p-4"
        >
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/python-versions" element={<PythonVersions />} />
              <Route path="/environments" element={<Environments />} />
              <Route path="/packages" element={<Packages />} />
              <Route path="/projects" element={<Projects />} />
              <Route path="/ai-deploy" element={<AiDeploy />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </Suspense>
        </div>
      </main>
      <NotificationContainer />
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AppContent />
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
