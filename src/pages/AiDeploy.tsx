import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  Sparkles,
  Rocket,
  BookOpen,
  FileSearch,
  Check,
  Loader2,
  Circle,
  Send,
  Terminal,
  Zap,
  Globe,
  Layers,
  Shield,
  Gauge,
  MessageCircle,
  CheckCircle2,
  X,
  Play,
  ScrollText,
  Package,
  Square,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Textarea';
import { Badge } from '@/components/ui/Badge';
import {
  aiDeployQuickActions,
  mockDeploymentPlan,
  mockProjectAnalysis,
  mockRecommendations,
  mockInitialMessages,
  mockTerminalLines,
  streamChat,
  type AiConfig,
  type StreamChatCallbacks,
} from '@/lib/tauri-api';
import type { ChatMessage, DeploymentStep } from '@/types/ai-deploy';
import { useConfigStore } from '@/store/useAppStore';
import { useErrorNotification } from '@/store/useAppStore';

const recommendationIcons: Record<string, React.ElementType> = {
  Zap,
  Globe,
  Layers,
  Shield,
  Gauge,
};

function formatTime(date: Date): string {
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function renderMarkdownLike(content: string): React.ReactNode {
  return content.split('\n').map((line, lineIndex) => {
    const key = `${line}-${lineIndex}`;
    const trimmed = line.trim();

    if (trimmed.startsWith('```') && trimmed.endsWith('```') && trimmed.length > 6) {
      const code = trimmed.slice(3, -3).trim();
      return (
        <pre
          key={key}
          className="mt-2 overflow-x-auto rounded bg-pf-muted p-2 font-mono text-xs text-pf-foreground"
        >
          {code}
        </pre>
      );
    }

    if (trimmed.startsWith('- ')) {
      return (
        <li key={key} className="ml-4 list-disc text-sm leading-relaxed">
          {renderInline(trimmed.slice(2))}
        </li>
      );
    }

    return (
      <p key={key} className="text-sm leading-relaxed">
        {renderInline(line)}
      </p>
    );
  });
}

function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const value = match[0];
    if (value.startsWith('**') && value.endsWith('**')) {
      parts.push(
        <strong key={match.index} className="font-semibold text-pf-foreground">
          {value.slice(2, -2)}
        </strong>
      );
    } else if (value.startsWith('`') && value.endsWith('`')) {
      parts.push(
        <code
          key={match.index}
          className="rounded bg-pf-muted px-1 py-0.5 font-mono text-xs text-pf-primary"
        >
          {value.slice(1, -1)}
        </code>
      );
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

function getStepIcon(step: DeploymentStep): React.ReactNode {
  if (step.status === 'completed') {
    return <Check className="h-4 w-4" />;
  }
  if (step.status === 'in-progress') {
    return <Loader2 className="h-4 w-4 animate-spin" />;
  }
  return <Circle className="h-4 w-4" />;
}

export const AiDeploy: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>(mockInitialMessages);
  const [input, setInput] = useState('');
  const [isDeploying, setIsDeploying] = useState(false);
  const [progress, setProgress] = useState(65);
  const [terminalLines, setTerminalLines] = useState<string[]>(mockTerminalLines);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingTaskId, setStreamingTaskId] = useState<string | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const config = useConfigStore((s) => s.config);
  const showError = useErrorNotification();

  // 构建 AI 配置
  const aiConfig: AiConfig = useMemo(() => ({
    api_provider: config?.ai.provider ?? 'openai',
    api_key: config?.ai.api_key ?? '',
    model: config?.ai.model ?? 'gpt-4o-mini',
    base_url: config?.ai.base_url ?? undefined,
    temperature: config?.ai.temperature ?? 0.7,
    use_local_llm: config?.ai.use_local_llm ?? false,
  }), [config]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  useEffect(() => {
    if (!isDeploying) return;

    const timer = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(timer);
          setIsDeploying(false);
          return 100;
        }
        return prev + 5;
      });
    }, 800);

    return () => clearInterval(timer);
  }, [isDeploying]);

  // 组件卸载时取消流式监听
  useEffect(() => {
    return () => {
      if (unlistenRef.current) {
        unlistenRef.current();
      }
    };
  }, []);

  const addTerminalLine = (line: string) => {
    setTerminalLines((prev) => [...prev, line]);
  };

  const handleCancelStream = useCallback(() => {
    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }
    if (streamingContent) {
      // 将已生成的内容保存为消息
      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: streamingContent + '\n\n（已取消生成）',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMessage]);
    }
    setIsStreaming(false);
    setStreamingContent('');
    setStreamingTaskId(null);
  }, [streamingContent]);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsStreaming(true);
    setStreamingContent('');

    const callbacks: StreamChatCallbacks = {
      onStart: (taskId) => {
        setStreamingTaskId(taskId);
        addTerminalLine(`→ AI 对话已启动 (任务: ${taskId})`);
      },
      onChunk: (chunk) => {
        setStreamingContent((prev) => prev + chunk);
      },
      onDone: (fullContent) => {
        const assistantMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: fullContent,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, assistantMessage]);
        setIsStreaming(false);
        setStreamingContent('');
        setStreamingTaskId(null);
        addTerminalLine('✓ AI 回复生成完成');
      },
      onError: (error) => {
        showError('AI 对话失败', error);
        addTerminalLine(`✗ AI 对话错误: ${error}`);
        setIsStreaming(false);
        setStreamingContent('');
        setStreamingTaskId(null);
      },
    };

    try {
      const chatHistory = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      chatHistory.push({ role: 'user', content: trimmed });

      const unlisten = await streamChat(chatHistory, aiConfig, callbacks);
      unlistenRef.current = unlisten;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      showError('启动对话失败', errorMsg);
      setIsStreaming(false);
    }
  }, [input, isStreaming, messages, aiConfig, showError]);

  const handleQuickAction = (action: string) => {
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: action,
      timestamp: new Date(),
    };

    const replies: Record<string, string> = {
      '部署 Flask 项目':
        '已识别 Flask 项目模板。推荐方案：Python 3.12.4 + Gunicorn + 清华镜像源。点击「开始部署」即可自动创建虚拟环境并安装依赖。',
      '部署 FastAPI 项目':
        'FastAPI 项目推荐使用 Python 3.12+ 并搭配 Uvicorn 作为 ASGI 服务器。我将为您生成包含 `uvicorn[standard]` 的部署方案。',
      '分析 requirements.txt':
        '已读取 requirements.txt，共识别 23 个依赖包。关键依赖：`flask==3.0.3`、`sqlalchemy==2.0.30`、`redis==5.0.7`。无版本冲突。',
    };

    const assistantMessage: ChatMessage = {
      id: `assistant-${Date.now() + 1}`,
      role: 'assistant',
      content: replies[action] ?? '收到，请稍候，我正在为您分析项目。',
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
  };

  const handleGeneratePlan = () => {
    const assistantMessage: ChatMessage = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content:
        '已为您生成部署方案：\n- Python 版本：**3.12.4**\n- 虚拟环境：`web-api-env`\n- 镜像源：清华镜像源\n- 关键依赖：Flask 3.0.3、SQLAlchemy 2.0.30、Redis 5.0.7\n\n点击「开始部署」即可执行。',
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, assistantMessage]);
  };

  const handleStartDeploy = () => {
    setIsDeploying(true);
    setProgress(0);

    const assistantMessage: ChatMessage = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: '开始执行部署... 您可以在右侧「部署日志」面板中查看实时输出。',
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, assistantMessage]);

    // Real Tauri streaming integration will replace this placeholder.
    addTerminalLine('→ 正在连接 AI 部署引擎...');
  };

  const handleCancel = () => {
    setIsDeploying(false);
    setProgress(0);

    const assistantMessage: ChatMessage = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: '部署已取消。如需重新部署，请点击「开始部署」。',
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, assistantMessage]);
  };

  const progressSteps = useMemo<DeploymentStep[]>(
    () =>
      mockDeploymentPlan.steps.map((step) =>
        step.id === '3'
          ? {
              ...step,
              status: isDeploying
                ? 'in-progress'
                : progress >= 100
                  ? 'completed'
                  : 'pending',
            }
          : step
      ),
    [isDeploying, progress]
  );

  return (
    <div className="space-y-6">
      {/* Page header */}
      <section className="flex flex-col gap-5 rounded-lg border border-pf-border border-l-4 border-l-pf-primary bg-pf-card p-6 shadow-sm sm:flex-row sm:items-center">
        <div className="flex-1 space-y-2">
          <Badge variant="outline" className="gap-1 text-pf-primary">
            <Sparkles className="h-3 w-3" />
            AI 驱动
          </Badge>
          <h1 className="pf-text-display text-2xl text-pf-foreground sm:text-3xl">AI 智能部署</h1>
          <p className="text-sm text-pf-muted-foreground">
            智能分析项目依赖，一键构建最优 Python 开发环境
          </p>
          <p className="max-w-xl text-xs leading-relaxed text-pf-muted-foreground">
            AI 助手将扫描您的项目文件，自动识别依赖关系，推荐最佳 Python
            版本、虚拟环境配置和镜像源方案。
          </p>
          <div className="flex flex-wrap gap-3 pt-1">
            <Button onClick={handleStartDeploy} disabled={isDeploying}>
              <Rocket className="mr-1.5 h-4 w-4" />
              开始智能部署
            </Button>
            <Button variant="outline">
              <BookOpen className="mr-1.5 h-4 w-4" />
              查看文档
            </Button>
          </div>
        </div>

        <div className="relative mx-auto flex h-32 w-32 shrink-0 items-center justify-center sm:mx-0 sm:h-40 sm:w-40">
          <div className="absolute inset-0 animate-[spin_14s_linear_infinite]">
            {[0, 90, 180, 270].map((deg) => (
              <span
                key={deg}
                className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-pf-primary shadow-[0_0_10px_rgba(45,212,191,0.6)]"
                style={{ transform: `translate(-50%, -50%) rotate(${deg}deg) translateY(-52px)` }}
              />
            ))}
          </div>
          <div className="relative z-10 flex h-20 w-20 items-center justify-center rounded-full border border-pf-primary/25 bg-pf-primary/10 text-pf-primary shadow-[0_0_40px_rgba(45,212,191,0.15)] animate-[pulse_3s_ease-in-out_infinite]">
            <Sparkles className="h-8 w-8" />
          </div>
        </div>
      </section>

      {/* Deployment stepper */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-start overflow-x-auto pb-2">
            {progressSteps.map((step, index) => {
              const isLast = index === progressSteps.length - 1;
              return (
                <React.Fragment key={step.id}>
                  <div className="flex w-[108px] shrink-0 flex-col items-center gap-2 text-center sm:w-[118px]">
                    <div
                      className={`flex h-9 w-9 items-center justify-center rounded-full border text-sm ${
                        step.status === 'completed'
                          ? 'border-pf-primary/40 bg-pf-primary/10 text-pf-primary'
                          : step.status === 'in-progress'
                            ? 'border-pf-primary bg-pf-primary text-pf-primary-foreground shadow-[0_0_0_4px_rgba(45,212,191,0.15)]'
                            : 'border-pf-border bg-pf-muted text-pf-muted-foreground'
                      }`}
                    >
                      {getStepIcon(step)}
                    </div>
                    <div>
                      <div
                        className={`text-xs font-semibold ${
                          step.status === 'in-progress'
                            ? 'text-pf-primary'
                            : step.status === 'pending'
                              ? 'text-pf-muted-foreground'
                              : 'text-pf-foreground'
                        }`}
                      >
                        {step.label}
                      </div>
                      <div className="text-[11px] text-pf-muted-foreground">{step.description}</div>
                    </div>
                  </div>
                  {!isLast && (
                    <div
                      className={`mx-1 mt-[18px] h-0.5 min-w-[20px] flex-1 rounded-full ${
                        index < progressSteps.findIndex((s) => s.status === 'pending') ||
                        (index === 1 && progress >= 100)
                          ? 'bg-pf-primary'
                          : 'bg-pf-border'
                      }`}
                    />
                  )}
                </React.Fragment>
              );
            })}
          </div>

          <div className="mt-5">
            <div className="h-1.5 overflow-hidden rounded-full bg-pf-muted">
              <div
                className="h-full rounded-full bg-pf-primary shadow-[0_0_12px_rgba(45,212,191,0.4)] transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-pf-muted-foreground">
              <span className="font-mono text-pf-primary">{progress}%</span>
              <span>{isDeploying ? '正在安装依赖包...' : progress >= 100 ? '部署完成' : '等待开始部署'}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main two-column layout */}
      <div className="grid gap-6 lg:grid-cols-5">
        {/* Left: Chat panel */}
        <div className="flex flex-col gap-6 lg:col-span-3">
          <Card className="flex flex-1 flex-col">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageCircle className="h-5 w-5 text-pf-primary" />
                  <CardTitle className="text-base">AI 助手对话</CardTitle>
                </div>
                <Badge variant="outline" className="gap-1.5 text-pf-primary">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-pf-primary shadow-[0_0_8px_rgba(45,212,191,0.6)]" />
                  在线
                </Badge>
              </div>
              <CardDescription>与 AI 助手交流以获取部署建议</CardDescription>
            </CardHeader>

            <CardContent className="flex flex-1 flex-col space-y-4">
              <div className="flex max-h-[420px] min-h-[260px] flex-col gap-3 overflow-y-auto rounded-lg bg-pf-muted/30 p-3">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex max-w-[88%] flex-col gap-1 rounded-xl border px-3.5 py-2.5 text-sm leading-relaxed ${
                      message.role === 'user'
                        ? 'self-end border-pf-border bg-pf-muted text-pf-foreground'
                        : 'self-start border-pf-primary/20 bg-pf-primary/5 text-pf-foreground'
                    }`}
                  >
                    {renderMarkdownLike(message.content)}
                    <span className="text-[10px] text-pf-muted-foreground">{formatTime(message.timestamp)}</span>
                  </div>
                ))}
                {/* 流式输出消息 */}
                {isStreaming && (
                  <div className="flex max-w-[88%] flex-col gap-1 self-start rounded-xl border border-pf-primary/20 bg-pf-primary/5 px-3.5 py-2.5 text-sm leading-relaxed text-pf-foreground">
                    <div className="relative">
                      {streamingContent ? (
                        renderMarkdownLike(streamingContent)
                      ) : (
                        <div className="flex items-center gap-2 text-pf-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span>正在思考...</span>
                        </div>
                      )}
                      {streamingContent && (
                        <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-pf-primary align-middle" />
                      )}
                    </div>
                    <span className="text-[10px] text-pf-muted-foreground">
                      {streamingTaskId ? `生成中... ${streamingContent.length} 字符` : '连接中...'}
                    </span>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {aiDeployQuickActions.map((action) => (
                    <Button
                      key={action}
                      variant="outline"
                      size="sm"
                      onClick={() => handleQuickAction(action)}
                      disabled={isDeploying}
                    >
                      <Zap className="mr-1 h-3 w-3" />
                      {action}
                    </Button>
                  ))}
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                  <Textarea
                    placeholder={isStreaming ? 'AI 正在回复中...' : '询问 AI 助手，例如：帮我分析这个项目...'}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        if (!isStreaming) handleSend();
                      }
                    }}
                    className="min-h-[56px] flex-1 resize-none"
                    disabled={isStreaming || isDeploying}
                  />
                  {isStreaming ? (
                    <Button
                      size="icon"
                      onClick={handleCancelStream}
                      variant="destructive"
                      aria-label="停止生成"
                      className="shrink-0"
                    >
                      <Square className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Button
                      size="icon"
                      onClick={handleSend}
                      disabled={!input.trim() || isDeploying}
                      aria-label="发送"
                      className="shrink-0 shadow-[0_0_16px_rgba(45,212,191,0.25)]"
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right: Deployment wizard summary */}
        <div className="flex flex-col gap-6 lg:col-span-2">
          {/* Project analysis */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileSearch className="h-5 w-5 text-pf-primary" />
                  <CardTitle className="text-base">项目分析结果</CardTitle>
                </div>
                <Badge variant="outline" className="gap-1 text-state-success">
                  <CheckCircle2 className="h-3 w-3" />
                  已完成
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {[
                  { label: '项目名称', value: mockProjectAnalysis.name, mono: true },
                  { label: '项目类型', value: mockProjectAnalysis.type, mono: false },
                  { label: 'Python 版本', value: mockProjectAnalysis.pythonVersion, mono: true },
                  { label: '依赖文件', value: mockProjectAnalysis.dependencyFile, mono: true },
                  { label: '依赖包数', value: `${mockProjectAnalysis.dependencyCount} 个`, mono: false },
                  { label: '项目大小', value: mockProjectAnalysis.size, mono: false },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="flex flex-col gap-1 rounded-lg border border-pf-border bg-pf-muted p-2.5"
                  >
                    <span className="text-[11px] text-pf-muted-foreground">{item.label}</span>
                    <span className={`text-sm font-semibold text-pf-foreground ${item.mono ? 'font-mono' : ''}`}>
                      {item.value}
                    </span>
                  </div>
                ))}
              </div>

              <div>
                <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-pf-muted-foreground">
                  <Package className="h-3 w-3" />
                  检测到的依赖
                </div>
                <div className="flex flex-col gap-1.5">
                  {mockDeploymentPlan.dependencies.map((dep) => (
                    <div
                      key={dep.name}
                      className="rounded-md border border-pf-border bg-pf-muted px-2.5 py-1.5 font-mono text-xs text-pf-foreground"
                    >
                      <span className="text-pf-primary">{dep.name}</span>
                      <span className="text-pf-muted-foreground">=={dep.version}</span>
                    </div>
                  ))}
                  <span className="px-1 pt-1 font-mono text-[11px] text-pf-muted-foreground">
                    ...还有 {mockProjectAnalysis.dependencyCount - mockDeploymentPlan.dependencies.length} 个
                  </span>
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-pf-muted-foreground">
                  <ScrollText className="h-3 w-3" />
                  部署命令
                </div>
                <div className="space-y-1.5 rounded-lg border border-pf-border bg-pf-muted p-3">
                  {mockDeploymentPlan.commands.map((cmd, index) => (
                    <code
                      key={index}
                      className="block font-mono text-xs text-pf-foreground"
                    >
                      <span className="text-pf-primary">$</span> {cmd}
                    </code>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Recommendations */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-pf-primary drop-shadow-[0_0_5px_rgba(45,212,191,0.55)]" />
                  <CardTitle className="text-base">AI 智能推荐</CardTitle>
                </div>
                <Badge variant="secondary">{mockRecommendations.length} 项推荐</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {mockRecommendations.map((rec) => {
                const Icon = recommendationIcons[rec.icon] ?? Zap;
                return (
                  <div
                    key={rec.id}
                    className="flex items-center gap-3 rounded-lg border border-pf-border bg-pf-muted p-3"
                  >
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-pf-primary/10 text-pf-primary ${
                        rec.applied ? 'shadow-[0_0_16px_rgba(45,212,191,0.18)]' : ''
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-pf-foreground">{rec.title}</div>
                      <div className="text-xs text-pf-muted-foreground">{rec.description}</div>
                    </div>
                    <span
                      className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold ${
                        rec.applied
                          ? 'border border-state-success/25 bg-state-success/10 text-state-success'
                          : 'border border-pf-primary bg-transparent text-pf-primary'
                      }`}
                    >
                      {rec.applied ? (
                        <span className="flex items-center gap-1">
                          <Check className="h-3 w-3" /> 已应用
                        </span>
                      ) : (
                        '应用'
                      )}
                    </span>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Terminal output */}
      <Card className="overflow-hidden">
        <CardHeader className="flex-row items-center justify-between pb-3">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-pf-muted-foreground" />
            <CardTitle className="text-sm font-semibold text-pf-muted-foreground">部署日志</CardTitle>
          </div>
          <Badge variant="outline" className="gap-1.5 text-pf-primary">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-pf-primary" />
            实时
          </Badge>
        </CardHeader>
        <CardContent className="bg-pf-card">
          <pre className="max-h-80 overflow-y-auto overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-pf-muted p-4 font-mono text-xs leading-7 text-pf-muted-foreground">
            {terminalLines.map((line, index) => {
              if (line.startsWith('$')) {
                return (
                  <div key={index}>
                    <span className="text-pf-primary">{line}</span>
                  </div>
                );
              }
              if (line.startsWith('✓')) {
                return (
                  <div key={index}>
                    <span className="text-state-success">{line}</span>
                  </div>
                );
              }
              if (line.includes('AI 推荐')) {
                return (
                  <div key={index}>
                    <span className="text-pf-primary">{line}</span>
                  </div>
                );
              }
              return <div key={index}>{line}</div>;
            })}
            <span className="animate-pulse font-bold text-pf-primary">▌</span>
          </pre>
        </CardContent>
      </Card>

      {/* Action buttons */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-pf-border bg-pf-card p-4">
        <Button onClick={handleGeneratePlan} disabled={isDeploying} variant="outline">
          <ScrollText className="mr-1.5 h-4 w-4" />
          生成方案
        </Button>
        <Button onClick={handleStartDeploy} disabled={isDeploying}>
          <Play className="mr-1.5 h-4 w-4" />
          开始部署
        </Button>
        <Button variant="destructive" onClick={handleCancel} disabled={!isDeploying}>
          <X className="mr-1.5 h-4 w-4" />
          取消
        </Button>
      </div>
    </div>
  );
};
