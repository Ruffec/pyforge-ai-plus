/**
 * 前端用户交互/异常日志上报（fire-and-forget）
 *
 * 经 `frontend_log_command` 写入统一结构化日志文件（桌面 IPC 与网页桥接双通道自适应），
 * 与后端全链路埋点共同构成完整操作审计。任何失败静默吞掉，绝不影响交互主流程。
 */
import { invokeCommand } from '@/lib/tauri-api';

function emit(level: 'info' | 'warn' | 'error', action: string, detail?: Record<string, unknown>) {
  const message = detail
    ? `[${action}] ${JSON.stringify(detail)}`
    : `[${action}]`;
  // 非阻塞上报；桥接不可达（如网页端后端未启动）时静默忽略
  invokeCommand('frontend_log_command', { level, message, target: 'pyforge_ai::ui' }).catch(
    () => {}
  );
}

/** 记录用户交互动作（按钮点击、对话框打开等） */
export function logUserAction(action: string, detail?: Record<string, unknown>): void {
  emit('info', action, detail);
}

/** 记录前端捕获的异常/操作失败 */
export function logUserError(action: string, detail?: Record<string, unknown>): void {
  emit('error', action, detail);
}
