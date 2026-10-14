import React, { useEffect, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import {
  getBridgeStatus,
  isTauri,
  onBridgeStatusChange,
  pingBridge,
  type BridgeStatus,
} from '@/lib/tauri-api';

/**
 * 网页端桥接连接状态横幅：
 * 仅在「网页模式且桌面端 HTTP 桥接不可达」时显示真实告警，
 * 持续轮询探活，桥接恢复后自动消失。桌面端（Tauri）永不显示。
 */
export const BridgeBanner: React.FC = () => {
  const [status, setStatus] = useState<BridgeStatus>(() => getBridgeStatus());
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(isTauri());

  useEffect(() => {
    const off = onBridgeStatusChange(setStatus);

    if (isTauri()) {
      setChecked(true);
      return off;
    }

    let timer: number | undefined;
    const probe = async () => {
      setChecking(true);
      try {
        await pingBridge();
      } finally {
        setChecking(false);
        setChecked(true);
      }
    };
    void probe();
    timer = window.setInterval(() => void probe(), 5000);

    return () => {
      off();
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, []);

  // 首次探活完成前不渲染，避免已连接用户看到横幅闪烁
  if (!checked || status !== 'disconnected') return null;

  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-2 border-b border-state-warning/40 bg-state-warning/10 px-4 py-2 text-xs text-state-warning"
    >
      {checking ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
      ) : (
        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
      )}
      <span>
        未连接到桌面端数据桥接服务，页面数据暂不可用。请启动 PyForge AI
        桌面应用（桥接默认端口 21880）后自动恢复连接。
      </span>
    </div>
  );
};
