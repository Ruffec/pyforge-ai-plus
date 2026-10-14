import { isTauri } from '@/lib/tauri-api';
import type { ThemeMode } from '@/types/settings';
import { useCallback, useSyncExternalStore } from 'react';

type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'pyforge-theme';

/** 主题过渡动画时长（ms），与 index.css 中 html.theme-transitioning 匹配 */
const THEME_TRANSITION_MS = 300;

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') {
    return 'light';
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveTheme(theme: ThemeMode): ResolvedTheme {
  return theme === 'system' ? getSystemTheme() : theme;
}

function applyTheme(theme: ResolvedTheme): void {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

/** 切换期间启用全局颜色过渡动画，结束后移除避免常驻开销 */
function playThemeTransition(): void {
  const root = document.documentElement;
  root.classList.add('theme-transitioning');
  window.setTimeout(() => root.classList.remove('theme-transitioning'), THEME_TRANSITION_MS);
}

/**
 * 将前端主题同步到原生窗口：Windows/macOS 原生标题栏随主题深浅联动。
 * system 模式传 null 交回系统跟随；同步失败静默降级，不影响前端主题。
 */
async function syncNativeTheme(theme: ThemeMode): Promise<void> {
  if (!isTauri()) {
    return;
  }
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().setTheme(theme === 'system' ? null : theme);
  } catch {
    // 原生窗口主题接口不可用（权限缺失或平台差异）时忽略
  }
}

// ---------------------------------------------------------------------------
// 模块级单例主题状态：所有 useTheme() 消费者共享同一状态源（TopBar/Settings 等）
// ---------------------------------------------------------------------------

function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'light';
  }

  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (isThemeMode(stored)) {
    return stored;
  }

  // 默认明亮主题（规范要求）
  return 'light';
}

let currentTheme: ThemeMode = getInitialTheme();
const listeners = new Set<() => void>();

let mediaQueryBound = false;

/** system 模式下跟随系统深浅切换（全局只绑定一次） */
function bindSystemThemeListener(): void {
  if (mediaQueryBound || typeof window === 'undefined') {
    return;
  }
  mediaQueryBound = true;
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener('change', () => {
    if (currentTheme === 'system') {
      applyTheme(getSystemTheme());
    }
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  bindSystemThemeListener();
  return () => listeners.delete(listener);
}

function commitTheme(next: ThemeMode, options?: { animate?: boolean }): void {
  currentTheme = next;
  if (options?.animate) {
    playThemeTransition();
  }
  applyTheme(resolveTheme(next));
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // localStorage 不可用时仅内存生效
  }
  void syncNativeTheme(next);
  listeners.forEach((notify) => notify());
}

// 首次加载立即应用主题（与 index.html 内联脚本一致，双保险）
if (typeof window !== 'undefined') {
  applyTheme(resolveTheme(currentTheme));
}

export interface UseThemeReturn {
  theme: ThemeMode;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
}

export function useTheme(): UseThemeReturn {
  const theme = useSyncExternalStore(subscribe, () => currentTheme, () => 'light' as ThemeMode);

  const setTheme = useCallback((next: ThemeMode) => {
    if (next === currentTheme) {
      return;
    }
    commitTheme(next, { animate: true });
  }, []);

  const toggleTheme = useCallback(() => {
    const resolved = resolveTheme(currentTheme);
    commitTheme(resolved === 'dark' ? 'light' : 'dark', { animate: true });
  }, []);

  return { theme, resolvedTheme: resolveTheme(theme), setTheme, toggleTheme };
}
