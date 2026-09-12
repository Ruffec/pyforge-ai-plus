/**
 * 任务进度反馈组件
 *
 * 展示后台任务的执行进度，支持进度条、状态指示、取消操作。
 */

import { useTaskStore } from '@/store/useAppStore';
import { Loader2, CheckCircle, XCircle, X, Play } from 'lucide-react';
import type { TaskStatus } from '@/types/app-types';

const statusConfig: Record<
  TaskStatus,
  { label: string; color: string; bgColor: string; icon: typeof Play }
> = {
  pending: {
    label: '等待中',
    color: 'text-gray-600 dark:text-gray-400',
    bgColor: 'bg-gray-400',
    icon: Play,
  },
  running: {
    label: '执行中',
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-500',
    icon: Loader2,
  },
  completed: {
    label: '已完成',
    color: 'text-green-600 dark:text-green-400',
    bgColor: 'bg-green-500',
    icon: CheckCircle,
  },
  failed: {
    label: '失败',
    color: 'text-red-600 dark:text-red-400',
    bgColor: 'bg-red-500',
    icon: XCircle,
  },
  cancelled: {
    label: '已取消',
    color: 'text-gray-600 dark:text-gray-400',
    bgColor: 'bg-gray-400',
    icon: X,
  },
};

interface TaskProgressItemProps {
  taskId: string;
  onClose?: (taskId: string) => void;
}

function TaskProgressItem({ taskId, onClose }: TaskProgressItemProps) {
  const task = useTaskStore((s) => s.tasks.get(taskId));

  if (!task) return null;

  const config = statusConfig[task.status];
  const StatusIcon = config.icon;
  const isRunning = task.status === 'running' || task.status === 'pending';

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3 shadow-md min-w-[320px] max-w-[400px]">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <StatusIcon
            className={`w-4 h-4 ${config.color} ${task.status === 'running' ? 'animate-spin' : ''}`}
          />
          <span className={`text-xs font-medium ${config.color}`}>{config.label}</span>
        </div>
        {onClose && (
          <button
            onClick={() => onClose(taskId)}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            aria-label="关闭"
          >
            <X className="w-3 h-3 text-gray-400" />
          </button>
        )}
      </div>

      <div className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-1 truncate">
        {task.message}
      </div>

      <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
        任务类型: {task.task_type}
      </div>

      {/* 进度条 */}
      <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full ${config.bgColor} transition-all duration-300 ease-out`}
          style={{ width: `${isRunning ? Math.max(task.progress, 5) : task.progress}%` }}
        />
      </div>

      <div className="flex justify-between mt-1">
        <span className="text-xs text-gray-500 dark:text-gray-400">{task.progress}%</span>
        <span className="text-xs text-gray-400">
          {new Date(task.updated_at).toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
}

interface TaskProgressContainerProps {
  /** 是否只显示运行中的任务 */
  showOnlyActive?: boolean;
}

export function TaskProgressContainer({ showOnlyActive = true }: TaskProgressContainerProps) {
  const tasks = useTaskStore((s) => Array.from(s.tasks.values()));
  const removeTask = useTaskStore((s) => s.removeTask);

  const displayTasks = showOnlyActive
    ? tasks.filter((t) => t.status === 'running' || t.status === 'pending')
    : tasks;

  if (displayTasks.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {displayTasks.map((task) => (
        <TaskProgressItem key={task.id} taskId={task.id} onClose={removeTask} />
      ))}
    </div>
  );
}

/**
 * 内联进度条组件，用于页面内展示单个任务进度。
 */
interface InlineProgressProps {
  progress: number;
  status?: TaskStatus;
  label?: string;
  showPercentage?: boolean;
}

export function InlineProgress({
  progress,
  status = 'running',
  label,
  showPercentage = true,
}: InlineProgressProps) {
  const config = statusConfig[status];

  return (
    <div className="w-full">
      {label && (
        <div className="flex justify-between mb-1">
          <span className="text-sm text-gray-600 dark:text-gray-400">{label}</span>
          {showPercentage && (
            <span className="text-sm text-gray-500 dark:text-gray-400">{progress}%</span>
          )}
        </div>
      )}
      <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full ${config.bgColor} transition-all duration-300`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

export default TaskProgressContainer;
