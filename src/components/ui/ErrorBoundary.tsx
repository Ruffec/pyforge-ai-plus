/**
 * 错误边界组件
 *
 * 捕获 React 渲染错误，展示符合桌面应用设计规范的错误页面，并提供重试功能。
 * 样式全部取自应用设计令牌（pf-* / state-*），跟随亮暗主题自动适配，
 * 不使用浏览器默认控件样式与网页端特有措辞。
 */

import React from 'react';
import { AlertTriangle, RotateCcw, RefreshCw } from 'lucide-react';
import { Button } from './Button';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({
      error,
      errorInfo,
    });

    // 记录错误到控制台
    console.error('[ErrorBoundary] 捕获到错误:', error);
    console.error('[ErrorBoundary] 组件栈:', errorInfo.componentStack);
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
    this.props.onReset?.();
  };

  /** 重新加载应用（WebView 环境下等价于重启渲染进程，桌面端标准恢复手段） */
  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex min-h-screen items-center justify-center bg-pf-background p-4">
          <div className="w-full max-w-md rounded-xl border border-pf-border bg-pf-card p-8 shadow-lg">
            <div className="flex flex-col items-center text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-state-error/10">
                <AlertTriangle className="h-8 w-8 text-state-error" />
              </div>

              <h2 className="mb-2 text-xl font-bold text-pf-foreground">应用运行出错</h2>

              <p className="mb-6 text-sm text-pf-muted-foreground">
                应用在运行过程中遇到了意外错误，可以尝试重试，或重新加载应用。
              </p>

              {this.state.error && (
                <div className="mb-6 w-full rounded-lg bg-pf-muted/50 p-3 text-left">
                  <p className="break-words font-mono text-xs text-state-error">
                    {this.state.error.message}
                  </p>
                </div>
              )}

              <div className="flex w-full gap-3">
                <Button onClick={this.handleReset} className="flex-1">
                  <RotateCcw className="mr-2 h-4 w-4" />
                  重试
                </Button>
                <Button variant="outline" onClick={this.handleReload} className="flex-1">
                  <RefreshCw className="mr-2 h-4 w-4" />
                  重新加载
                </Button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
