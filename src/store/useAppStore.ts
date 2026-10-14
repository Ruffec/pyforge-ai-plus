/**
 * PyForge AI 全局状态管理
 *
 * 使用 Zustand 管理应用全局状态，包括：
 * - 应用配置
 * - 通知系统
 * - 任务进度
 * - 当前选中的 Python 版本/虚拟环境/项目
 * - 主题设置
 */

import { create } from 'zustand';
import type {
  AppConfig,
  NotificationEvent,
  TaskInfo,
  PythonVersionInfo,
  VirtualEnvironment,
  ProjectInfo,
} from '@/types/app-types';
import type { CustomAiModel } from '@/types/settings';
import { loadCustomModels, saveCustomModels } from '@/lib/custom-models';

// ============================================================================
// 通知 Store
// ============================================================================

interface NotificationState {
  notifications: NotificationEvent[];
  addNotification: (notification: Omit<NotificationEvent, 'id' | 'timestamp'>) => void;
  removeNotification: (id: string) => void;
  clearNotifications: () => void;
}

export const useNotificationStore = create<NotificationState>()((set) => ({
  notifications: [],

  addNotification: (notification) => {
    const id = `notif-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newNotification: NotificationEvent = {
      ...notification,
      id,
      timestamp: Date.now(),
    };
    set((state) => ({
      notifications: [...state.notifications, newNotification].slice(-50),
    }));
    // 5秒后自动移除
    setTimeout(() => {
      set((state) => ({
        notifications: state.notifications.filter((n) => n.id !== id),
      }));
    }, 5000);
  },

  removeNotification: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    })),

  clearNotifications: () => set({ notifications: [] }),
}));

// ============================================================================
// 任务进度 Store
// ============================================================================

interface TaskState {
  tasks: Map<string, TaskInfo>;
  activeTaskId: string | null;
  updateTask: (task: TaskInfo) => void;
  removeTask: (taskId: string) => void;
  setActiveTask: (taskId: string | null) => void;
  clearCompletedTasks: () => void;
  getActiveTasks: () => TaskInfo[];
}

export const useTaskStore = create<TaskState>()((set, get) => ({
  tasks: new Map(),
  activeTaskId: null,

  updateTask: (task) =>
    set((state) => {
      const newTasks = new Map(state.tasks);
      newTasks.set(task.id, task);
      return { tasks: newTasks };
    }),

  removeTask: (taskId) =>
    set((state) => {
      const newTasks = new Map(state.tasks);
      newTasks.delete(taskId);
      return {
        tasks: newTasks,
        activeTaskId: state.activeTaskId === taskId ? null : state.activeTaskId,
      };
    }),

  setActiveTask: (taskId) => set({ activeTaskId: taskId }),

  clearCompletedTasks: () =>
    set((state) => {
      const newTasks = new Map();
      state.tasks.forEach((task, id) => {
        if (task.status === 'running' || task.status === 'pending') {
          newTasks.set(id, task);
        }
      });
      return { tasks: newTasks };
    }),

  getActiveTasks: () => {
    const { tasks } = get();
    return Array.from(tasks.values()).filter(
      (t) => t.status === 'running' || t.status === 'pending'
    );
  },
}));

// ============================================================================
// 应用配置 Store
// ============================================================================

interface AppConfigState {
  config: AppConfig | null;
  isLoading: boolean;
  error: string | null;
  setConfig: (config: AppConfig) => void;
  updateConfig: (patch: Partial<AppConfig>) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useConfigStore = create<AppConfigState>()((set) => ({
  config: null,
  isLoading: false,
  error: null,

  setConfig: (config) => set({ config, isLoading: false, error: null }),

  updateConfig: (patch) =>
    set((state) => ({
      config: state.config ? { ...state.config, ...patch } : null,
    })),

  setLoading: (loading) => set({ isLoading: loading }),

  setError: (error) => set({ error }),
}));

// ============================================================================
// 导航/选中状态 Store
// ============================================================================

interface SelectionState {
  selectedPythonVersion: PythonVersionInfo | null;
  selectedVenv: VirtualEnvironment | null;
  selectedProject: ProjectInfo | null;
  setSelectedPythonVersion: (version: PythonVersionInfo | null) => void;
  setSelectedVenv: (venv: VirtualEnvironment | null) => void;
  setSelectedProject: (project: ProjectInfo | null) => void;
}

export const useSelectionStore = create<SelectionState>()((set) => ({
  selectedPythonVersion: null,
  selectedVenv: null,
  selectedProject: null,

  setSelectedPythonVersion: (version) => set({ selectedPythonVersion: version }),
  setSelectedVenv: (venv) => set({ selectedVenv: venv }),
  setSelectedProject: (project) => set({ selectedProject: project }),
}));

// ============================================================================
// 主题 Store
// ============================================================================

interface ThemeState {
  theme: 'light' | 'dark' | 'system';
  accentColor: string;
  fontSize: 'small' | 'medium' | 'large';
  sidebarCollapsed: boolean;
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  setAccentColor: (color: string) => void;
  setFontSize: (size: 'small' | 'medium' | 'large') => void;
  toggleSidebar: () => void;
  applyTheme: () => void;
}

export const useThemeStore = create<ThemeState>()((set, get) => ({
  theme: 'system',
  accentColor: '#3b82f6',
  fontSize: 'medium',
  sidebarCollapsed: false,

  setTheme: (theme) => {
    set({ theme });
    get().applyTheme();
  },

  setAccentColor: (color) => {
    set({ accentColor: color });
    document.documentElement.style.setProperty('--accent-color', color);
  },

  setFontSize: (fontSize) => set({ fontSize }),

  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  applyTheme: () => {
    const { theme } = get();
    const isDark =
      theme === 'dark' ||
      (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  },
}));

// ============================================================================
// AI 自定义模型 Store（设置页维护，AI 功能实时消费，无需重启应用）
// ============================================================================

interface CustomModelsState {
  models: CustomAiModel[];
  addModel: (model: CustomAiModel) => void;
  updateModel: (model: CustomAiModel) => void;
  removeModel: (id: string) => void;
  /** 启用/停用：启用互斥（同一时刻至多一个生效） */
  setModelEnabled: (id: string, enabled: boolean) => void;
  /** 导入（替换/合并）模型列表 */
  importModels: (models: CustomAiModel[], mode: 'replace' | 'merge') => void;
}

/** 仅取 id/name/provider/model/baseUrl/apiKey 的启用模型（AiConfig 注入用） */
export function getActiveCustomModel(models: CustomAiModel[]): CustomAiModel | null {
  return models.find((m) => m.enabled) ?? null;
}

export const useCustomModelsStore = create<CustomModelsState>()((set) => ({
  models: loadCustomModels(),

  addModel: (model) =>
    set((state) => {
      const models = [...state.models, model];
      saveCustomModels(models);
      return { models };
    }),

  updateModel: (model) =>
    set((state) => {
      const models = state.models.map((m) => (m.id === model.id ? model : m));
      saveCustomModels(models);
      return { models };
    }),

  removeModel: (id) =>
    set((state) => {
      const models = state.models.filter((m) => m.id !== id);
      saveCustomModels(models);
      return { models };
    }),

  setModelEnabled: (id, enabled) =>
    set((state) => {
      // 启用互斥：启用某模型时自动停用其他模型
      const models = state.models.map((m) =>
        m.id === id ? { ...m, enabled } : { ...m, enabled: enabled ? false : m.enabled }
      );
      saveCustomModels(models);
      return { models };
    }),

  importModels: (incoming, mode) =>
    set((state) => {
      if (mode === 'replace') {
        saveCustomModels(incoming);
        return { models: incoming };
      }
      // merge：按 id 去重，导入条目覆盖同 id 旧条目
      const merged = new Map(state.models.map((m) => [m.id, m]));
      incoming.forEach((m) => merged.set(m.id, m));
      const models = Array.from(merged.values());
      saveCustomModels(models);
      return { models };
    }),
}));

// ============================================================================
// 界面偏好 Store（每页条数等，localStorage 持久化）
// ============================================================================

const PAGE_SIZE_STORAGE_KEY = 'pyforge-page-size';
export const DEFAULT_PAGE_SIZE = 10;
export const ALLOWED_PAGE_SIZES = [10, 20, 30, 50];

function loadInitialPageSize(): number {
  if (typeof window === 'undefined') {
    return DEFAULT_PAGE_SIZE;
  }
  const stored = Number(window.localStorage.getItem(PAGE_SIZE_STORAGE_KEY));
  return ALLOWED_PAGE_SIZES.includes(stored) ? stored : DEFAULT_PAGE_SIZE;
}

interface PrefsState {
  /** 列表每页显示条数（初始默认 10） */
  pageSize: number;
  setPageSize: (size: number) => void;
}

export const usePrefsStore = create<PrefsState>()((set) => ({
  pageSize: loadInitialPageSize(),

  setPageSize: (size) => {
    const next = ALLOWED_PAGE_SIZES.includes(size) ? size : DEFAULT_PAGE_SIZE;
    try {
      window.localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(next));
    } catch {
      // localStorage 不可用时仅内存生效
    }
    set({ pageSize: next });
  },
}));

// ============================================================================
// 便捷 Hook
// ============================================================================

/** 显示成功通知 */
export function useSuccessNotification() {
  const addNotification = useNotificationStore((s) => s.addNotification);
  return (title: string, message: string) =>
    addNotification({ title, message, notification_type: 'success' });
}

/** 显示错误通知 */
export function useErrorNotification() {
  const addNotification = useNotificationStore((s) => s.addNotification);
  return (title: string, message: string) =>
    addNotification({ title, message, notification_type: 'error' });
}

/** 显示警告通知 */
export function useWarningNotification() {
  const addNotification = useNotificationStore((s) => s.addNotification);
  return (title: string, message: string) =>
    addNotification({ title, message, notification_type: 'warning' });
}

/** 显示信息通知 */
export function useInfoNotification() {
  const addNotification = useNotificationStore((s) => s.addNotification);
  return (title: string, message: string) =>
    addNotification({ title, message, notification_type: 'info' });
}
