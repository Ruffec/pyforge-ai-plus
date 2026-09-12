/**
 * 通知系统组件
 *
 * 全局通知展示组件，支持 success/error/warning/info 四种类型，
 * 自动消失，可手动关闭。
 */

import { useNotificationStore } from '@/store/useAppStore';
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';
import { useEffect } from 'react';

const notificationStyles = {
  success: {
    bg: 'bg-green-50 dark:bg-green-900/20',
    border: 'border-green-200 dark:border-green-800',
    text: 'text-green-800 dark:text-green-200',
    icon: CheckCircle,
    iconColor: 'text-green-500',
  },
  error: {
    bg: 'bg-red-50 dark:bg-red-900/20',
    border: 'border-red-200 dark:border-red-800',
    text: 'text-red-800 dark:text-red-200',
    icon: XCircle,
    iconColor: 'text-red-500',
  },
  warning: {
    bg: 'bg-yellow-50 dark:bg-yellow-900/20',
    border: 'border-yellow-200 dark:border-yellow-800',
    text: 'text-yellow-800 dark:text-yellow-200',
    icon: AlertTriangle,
    iconColor: 'text-yellow-500',
  },
  info: {
    bg: 'bg-blue-50 dark:bg-blue-900/20',
    border: 'border-blue-200 dark:border-blue-800',
    text: 'text-blue-800 dark:text-blue-200',
    icon: Info,
    iconColor: 'text-blue-500',
  },
};

interface NotificationItemProps {
  id: string;
  title: string;
  message: string;
  type: keyof typeof notificationStyles;
  onClose: (id: string) => void;
}

function NotificationItem({ id, title, message, type, onClose }: NotificationItemProps) {
  const style = notificationStyles[type];
  const Icon = style.icon;

  return (
    <div
      className={`
        flex items-start gap-3 p-4 rounded-lg border shadow-lg
        ${style.bg} ${style.border} ${style.text}
        animate-slide-in
        min-w-[320px] max-w-[480px]
      `}
      role="alert"
    >
      <Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${style.iconColor}`} />
      <div className="flex-1 min-w-0">
        <h4 className="font-semibold text-sm">{title}</h4>
        <p className="text-sm mt-1 opacity-90 break-words">{message}</p>
      </div>
      <button
        onClick={() => onClose(id)}
        className="flex-shrink-0 p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
        aria-label="关闭通知"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

export function NotificationContainer() {
  const notifications = useNotificationStore((s) => s.notifications);
  const removeNotification = useNotificationStore((s) => s.removeNotification);

  // 监听键盘事件，ESC 关闭所有通知
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        useNotificationStore.getState().clearNotifications();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (notifications.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      <div className="flex flex-col gap-2 pointer-events-auto">
        {notifications.map((notification) => (
          <NotificationItem
            key={notification.id}
            id={notification.id}
            title={notification.title}
            message={notification.message}
            type={notification.notification_type as keyof typeof notificationStyles}
            onClose={removeNotification}
          />
        ))}
      </div>
    </div>
  );
}

export default NotificationContainer;
