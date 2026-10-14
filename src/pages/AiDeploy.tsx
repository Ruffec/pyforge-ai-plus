import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles,
  Rocket,
  FileSearch,
  Check,
  Loader2,
  Circle,
  Send,
  Terminal,
  Zap,
  Layers,
  MessageCircle,
  CheckCircle2,
  X,
  Play,
  ScrollText,
  Package,
  Square,
  Brain,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Badge } from '@/components/ui/Badge';
import {
  createVenv,
  detectProject,
  generateDeploymentPlan,
  getCurrentMirror,
  installFromRequirements,
  scanPythonVersions,
  streamChat,
  type AiConfig,
  type DeploymentPlan as ApiDeploymentPlan,
  type StreamChatCallbacks,
} from '@/lib/tauri-api';
import { CAPABILITY_LABELS, PROVIDER_DEFAULT_BASE_URL } from '@/lib/custom-models';
import type { ChatMessage, DeploymentStep } from '@/types/ai-deploy';
import type { PipMirror } from '@/types/packages';
import { getActiveCustomModel, useConfigStore, useCustomModelsStore, useErrorNotification } from '@/store/useAppStore';

/** 欢迎语（静态 UI 文案，非数据） */
const WELCOME_MESSAGE =
  '您好！我是 PyForge AI 部署助手。我可以帮您分析项目依赖、推荐 Python 版本、生成部署方案并一键完成环境搭建。请填写左侧项目路径点击「分析项目」，或在下方描述您的项目。';

/** 快捷提示词（纯 UI 文案，点击后走真实 AI 对话） */
const QUICK_PROMPTS = [
  '帮我分析一个 Flask 项目的部署方案',
  'FastAPI 项目推荐什么 Python 版本？',
  '如何为项目选择合适的镜像源？',
];

/** 项目分析结果（来自后端 detect_project 真实扫描） */
interface ProjectAnalysisResult {
  path: string;
  name: string;
  projectType: string;
  pythonVersion: string;
  dependencyFile: string;
  dependencyCount: number;
  dependencies: Array<{ name: string; version_constraint: string }>;
  associatedVenv: string;
}

const PROJECT_TYPE_LABELS: Record<string, string> = {
  requirements: 'requirements 项目',
  poetry: 'Poetry 项目',
  pipenv: 'Pipenv 项目',
  pdm: 'PDM 项目',
  conda: 'Conda 项目',
  setuptools: 'Setuptools 项目',
  flask: 'Flask Web 应用',
  django: 'Django Web 应用',
  fastapi: 'FastAPI Web 应用',
  data_science: '数据科学项目',
  unknown: '未识别类型',
};

const recommendationIcons: Record<string, React.ElementType> = {
  Layers,
  Package,
  ScrollText,
  CheckCircle2,
  Zap,
};

type DeployPhase = 'idle' | 'creating' | 'installing' | 'done' | 'failed';

interface DeployPoint {
  icon: string;
  title: string;
  description: string;
  ready: boolean;
}

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
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: 'welcome', role: 'assistant', content: WELCOME_MESSAGE, timestamp: new Date() },
  ]);
  const [input, setInput] = useState('');
  const [terminalLines, setTerminalLines] = useState<string[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingTaskId, setStreamingTaskId] = useState<string | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // 真实项目分析 / 方案 / 部署状态
  const [projectPathInput, setProjectPathInput] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<ProjectAnalysisResult | null>(null);
  const [plan, setPlan] = useState<ApiDeploymentPlan | null>(null);
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [deployPhase, setDeployPhase] = useState<DeployPhase>('idle');
  const [deployedVenvPath, setDeployedVenvPath] = useState<string | null>(null);
  const [currentMirror, setCurrentMirror] = useState<PipMirror | null>(null);
  const cancelDeployRef = useRef(false);

  const config = useConfigStore((s) => s.config);
  const showError = useErrorNotification();
  // 启用的自定义模型（设置页维护，store 变更实时生效，无需重启）
  const customModels = useCustomModelsStore((s) => s.models);
  const activeCustomModel = getActiveCustomModel(customModels);

  // 构建 AI 配置：启用自定义模型时其参数整体优先（实时生效）
  const aiConfig: AiConfig = useMemo(() => {
    const base: AiConfig = {
      api_provider: config?.ai.provider ?? 'openai',
      api_key: config?.ai.api_key ?? '',
      model: config?.ai.model ?? 'gpt-4o-mini',
      base_url: config?.ai.base_url ?? undefined,
      temperature: config?.ai.temperature ?? 0.7,
      use_local_llm: config?.ai.use_local_llm ?? false,
    };
    if (!activeCustomModel) {
      return base;
    }
    return {
      ...base,
      api_provider: activeCustomModel.provider === 'local' ? base.api_provider : activeCustomModel.provider,
      api_key: activeCustomModel.apiKey ?? base.api_key,
      model: activeCustomModel.model || base.model,
      base_url: activeCustomModel.baseUrl || PROVIDER_DEFAULT_BASE_URL[activeCustomModel.provider] || base.base_url,
      temperature: activeCustomModel.temperature,
      max_tokens: activeCustomModel.maxTokens,
      top_p: activeCustomModel.topP,
      use_local_llm: activeCustomModel.provider === 'local' ? true : base.use_local_llm,
    };
  }, [config, activeCustomModel]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  // 挂载：读取当前镜像源（真实配置）+ 卸载时取消流式监听
  useEffect(() => {
    let mounted = true;
    getCurrentMirror()
      .then((m) => {
        if (mounted) setCurrentMirror(m);
      })
      .catch(() => {});
    return () => {
      mounted = false;
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    };
  }, []);

  const isDeploying = deployPhase === 'creating' || deployPhase === 'installing';
  const progress =
    deployPhase === 'done'
      ? 100
      : deployPhase === 'installing'
        ? 70
        : deployPhase === 'creating'
          ? 30
          : 0;
  const deployStatusText =
    deployPhase === 'creating'
      ? '正在创建虚拟环境...'
      : deployPhase === 'installing'
        ? '正在安装依赖包...'
        : deployPhase === 'done'
          ? '部署完成'
          : deployPhase === 'failed'
            ? '部署失败，请查看部署日志'
            : analysis
              ? '就绪，可开始部署'
              : '请先分析项目';

  const addTerminalLine = useCallback((line: string) => {
    setTerminalLines((prev) => [...prev, line]);
  }, []);

  const appendAssistantMessage = useCallback((content: string) => {
    setMessages((prev) => [
      ...prev,
      { id: `assistant-${Date.now()}`, role: 'assistant', content, timestamp: new Date() },
    ]);
  }, []);

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

  const handleSend = useCallback(
    async (text?: string) => {
      const trimmed = (text ?? input).trim();
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
        const chatHistory: Array<{ role: string; content: string }> = messages.map((m) => ({
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
    },
    [input, isStreaming, messages, aiConfig, showError, addTerminalLine]
  );

  /** 分析项目：调用后端 detect_project 真实扫描依赖清单 */
  const handleAnalyze = useCallback(async () => {
    const path = projectPathInput.trim();
    if (!path || isAnalyzing) return;

    setIsAnalyzing(true);
    addTerminalLine(`$ pyforge detect "${path}"`);
    try {
      const resp = await detectProject(path);
      if (!resp) {
        addTerminalLine('✗ 未识别到 Python 项目');
        showError('未识别到 Python 项目', '该目录下未找到 requirements.txt / pyproject.toml 等依赖清单文件');
        return;
      }
      const associated = (resp as { associated_venv?: string | null }).associated_venv;
      const result: ProjectAnalysisResult = {
        path: resp.path,
        name: resp.name,
        projectType: resp.project_type,
        pythonVersion: resp.python_version ?? '未指定',
        dependencyFile: resp.dependency_files[0] ?? '未找到',
        dependencyCount: resp.dependencies.length,
        dependencies: resp.dependencies.map((d) => ({
          name: d.name,
          version_constraint: d.version_constraint,
        })),
        associatedVenv: associated ?? '',
      };
      setAnalysis(result);
      // 新分析结果生成后，旧的方案/部署状态不再适用
      setPlan(null);
      setDeployedVenvPath(null);
      setDeployPhase('idle');
      addTerminalLine(`✓ 识别为 ${PROJECT_TYPE_LABELS[result.projectType] ?? result.projectType}，发现 ${result.dependencyCount} 个依赖`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addTerminalLine(`✗ 项目分析失败：${msg}`);
      showError('项目分析失败', msg);
    } finally {
      setIsAnalyzing(false);
    }
  }, [projectPathInput, isAnalyzing, showError, addTerminalLine]);

  /** 生成部署方案：调用真实 AI 服务 */
  const handleGeneratePlan = useCallback(async () => {
    if (!analysis) {
      showError('无法生成方案', '请先填写项目路径并点击「分析项目」');
      return;
    }
    if (isGeneratingPlan || isDeploying) return;

    setIsGeneratingPlan(true);
    addTerminalLine(`$ pyforge plan --project "${analysis.path}"`);
    try {
      const result = await generateDeploymentPlan(
        { user_input: `为项目 ${analysis.path} 生成部署方案`, project_path: analysis.path },
        aiConfig
      );
      setPlan(result);
      addTerminalLine(`✓ 方案已生成：Python ${result.python_version}，${result.dependencies.length} 个依赖`);
      appendAssistantMessage(
        `已基于真实扫描结果生成部署方案：\n- Python 版本：**${result.python_version}**\n- 依赖数量：${result.dependencies.length} 个\n- 部署命令：\n${result.commands.map((c) => `  - \`${c}\``).join('\n')}\n\n${result.explanation}\n\n点击「开始部署」即可执行。`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addTerminalLine(`✗ 方案生成失败：${msg}`);
      showError('方案生成失败', msg);
    } finally {
      setIsGeneratingPlan(false);
    }
  }, [analysis, isGeneratingPlan, isDeploying, aiConfig, showError, addTerminalLine, appendAssistantMessage]);

  /** 一键部署：扫描 Python → 创建虚拟环境 → 安装依赖（全真实命令，逐步校验取消请求） */
  const handleStartDeploy = useCallback(async () => {
    if (!analysis) {
      showError('无法开始部署', '请先填写项目路径并点击「分析项目」');
      return;
    }
    if (isDeploying) return;

    cancelDeployRef.current = false;
    setDeployedVenvPath(null);
    setDeployPhase('creating');
    addTerminalLine(`$ pyforge deploy --project "${analysis.path}"`);

    try {
      // 1. 选择 Python 解释器（真实扫描本机版本）
      const versions = await scanPythonVersions();
      if (cancelDeployRef.current) throw new Error('__cancelled__');
      if (versions.length === 0) {
        throw new Error('未检测到可用的 Python 版本，请先在「Python 版本」页安装');
      }
      const wanted = (plan?.python_version ?? analysis.pythonVersion).trim();
      const minor = wanted.split('.').slice(0, 2).join('.');
      const chosen =
        versions.find((v) => v.version === wanted) ??
        versions.find((v) => minor && v.version.startsWith(minor)) ??
        versions[0];
      addTerminalLine(`→ 使用 Python ${chosen.version}（${chosen.path}）`);

      // 2. 创建虚拟环境（后端广播 venv_changed，其他页面实时同步）
      const venv = await createVenv(`${analysis.name}-env`, chosen.path, '');
      if (cancelDeployRef.current) throw new Error('__cancelled__');
      setDeployedVenvPath(venv.path);
      addTerminalLine(`✓ 虚拟环境已创建：${venv.path}`);

      // 3. 安装依赖（requirements 由真实分析结果拼接）
      setDeployPhase('installing');
      const deps = plan?.dependencies ?? analysis.dependencies;
      if (deps.length === 0) {
        addTerminalLine('→ 未发现依赖声明，跳过依赖安装');
      } else {
        const requirements = deps
          .map((d) => (d.version_constraint ? `${d.name}${d.version_constraint}` : d.name))
          .join('\n');
        addTerminalLine('$ pip install -r requirements.txt');
        const output = await installFromRequirements(venv.path, requirements);
        if (cancelDeployRef.current) throw new Error('__cancelled__');
        const trimmed = output.trim();
        if (trimmed) addTerminalLine(trimmed);
        addTerminalLine(`✓ ${deps.length} 个依赖安装完成`);
      }

      setDeployPhase('done');
      appendAssistantMessage(
        `部署完成！虚拟环境 \`${venv.path}\` 已就绪，共安装 ${deps.length} 个依赖。可在「环境管理」页查看详情。`
      );
    } catch (err) {
      if (cancelDeployRef.current) {
        setDeployPhase('idle');
        addTerminalLine('✗ 部署已取消');
        appendAssistantMessage('部署已取消。如需重新部署，请点击「开始部署」。');
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        setDeployPhase('failed');
        addTerminalLine(`✗ 部署失败：${msg}`);
        showError('部署失败', msg);
      }
    }
  }, [analysis, plan, isDeploying, showError, addTerminalLine, appendAssistantMessage]);

  const handleCancel = useCallback(() => {
    if (!isDeploying) return;
    cancelDeployRef.current = true;
    addTerminalLine('→ 收到取消请求，将在当前步骤结束后停止...');
  }, [isDeploying, addTerminalLine]);

  /** 部署流程步骤条：完全由真实状态派生 */
  const progressSteps = useMemo<DeploymentStep[]>(
    () => [
      {
        id: '1',
        label: '项目分析',
        description: analysis ? PROJECT_TYPE_LABELS[analysis.projectType] ?? '已完成' : '待分析',
        status: analysis ? 'completed' : 'pending',
      },
      {
        id: '2',
        label: '生成方案',
        description: plan ? 'AI 方案已生成' : '可选步骤',
        status: plan ? 'completed' : 'pending',
      },
      {
        id: '3',
        label: '创建环境',
        description: deployedVenvPath
          ? `${analysis?.name ?? ''}-env`
          : deployPhase === 'creating'
            ? '创建中'
            : '待创建',
        status: deployedVenvPath
          ? 'completed'
          : deployPhase === 'creating'
            ? 'in-progress'
            : deployPhase === 'failed'
              ? 'failed'
              : 'pending',
      },
      {
        id: '4',
        label: '安装依赖',
        description:
          deployPhase === 'done'
            ? '已完成'
            : deployPhase === 'installing'
              ? '安装中'
              : analysis && analysis.dependencyCount > 0
                ? `${analysis.dependencyCount} 个依赖`
                : '待安装',
        status:
          deployPhase === 'done'
            ? 'completed'
            : deployPhase === 'installing'
              ? 'in-progress'
              : 'pending',
      },
      {
        id: '5',
        label: '部署完成',
        description: deployedVenvPath ? '环境已就绪' : '等待部署',
        status: deployPhase === 'done' ? 'completed' : 'pending',
      },
    ],
    [analysis, plan, deployPhase, deployedVenvPath]
  );

  /** 部署要点：由真实分析结果 / AI 方案 / 当前镜像源配置派生 */
  const deployPoints = useMemo<DeployPoint[]>(() => {
    if (!analysis) return [];
    const depSource = plan?.dependencies ?? analysis.dependencies;
    const topDeps = depSource
      .slice(0, 3)
      .map((d) => d.name)
      .join('、');
    const points: DeployPoint[] = [
      {
        icon: 'Layers',
        title: 'Python 版本',
        description: plan?.python_version ?? analysis.pythonVersion,
        ready: true,
      },
      {
        icon: 'Package',
        title: '虚拟环境',
        description: deployedVenvPath ?? `${analysis.name}-env（待创建）`,
        ready: !!deployedVenvPath,
      },
      {
        icon: 'ScrollText',
        title: '依赖清单',
        description: analysis.dependencyFile,
        ready: analysis.dependencyFile !== '未找到',
      },
      {
        icon: 'CheckCircle2',
        title: '镜像源',
        description: currentMirror
          ? `${currentMirror.name} · ${currentMirror.url}`
          : 'PyPI 官方源（未自定义）',
        ready: !!currentMirror,
      },
    ];
    if (topDeps) {
      points.push({ icon: 'Zap', title: '关键依赖', description: topDeps, ready: true });
    }
    return points;
  }, [analysis, plan, currentMirror, deployedVenvPath]);

  /** 部署命令展示：优先 AI 方案命令，否则由分析结果派生 */
  const deployCommands = useMemo<string[]>(() => {
    if (plan?.commands?.length) return plan.commands;
    if (!analysis) return [];
    const cmds = [`python -m venv ${analysis.name}-env`];
    if (analysis.dependencyFile !== '未找到') {
      cmds.push(`pip install -r ${analysis.dependencyFile}`);
    }
    return cmds;
  }, [plan, analysis]);

  const analysisFields = [
    { label: '项目名称', value: analysis?.name ?? '—', mono: true },
    {
      label: '项目类型',
      value: analysis ? PROJECT_TYPE_LABELS[analysis.projectType] ?? analysis.projectType : '—',
      mono: false,
    },
    { label: 'Python 版本', value: analysis?.pythonVersion ?? '—', mono: true },
    { label: '依赖文件', value: analysis?.dependencyFile ?? '—', mono: true },
    { label: '依赖包数', value: analysis ? `${analysis.dependencyCount} 个` : '—', mono: false },
    { label: '关联虚拟环境', value: analysis?.associatedVenv || '无', mono: true },
  ];

  return (
    <div className="space-y-5">
      {/* Page header */}
      <section className="flex flex-col gap-5 rounded-lg border border-pf-border border-l-4 border-l-pf-primary bg-pf-card p-5 shadow-sm sm:flex-row sm:items-center">
        <div className="flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="gap-1 text-pf-primary">
              <Sparkles className="h-3 w-3" />
              AI 驱动
            </Badge>
            {/* 当前生效模型指示器：点击跳转设置页模型配置 */}
            <button
              type="button"
              onClick={() => navigate('/settings?tab=ai')}
              className="inline-flex items-center gap-1.5 rounded-full border border-pf-border bg-pf-muted/60 px-2.5 py-0.5 text-[11px] text-pf-muted-foreground transition-colors hover:border-pf-primary/40 hover:text-pf-primary"
              title="前往设置调整模型"
            >
              <Brain className="h-3 w-3" />
              {activeCustomModel ? (
                <span className="max-w-[180px] truncate font-medium text-pf-foreground">
                  {activeCustomModel.name}
                </span>
              ) : (
                <span>{aiConfig.model}</span>
              )}
              {activeCustomModel && (
                <span className="flex flex-wrap gap-0.5">
                  {activeCustomModel.capabilities.slice(0, 3).map((cap) => (
                    <span key={cap} className="rounded bg-pf-primary/10 px-1 text-[9px] text-pf-primary">
                      {CAPABILITY_LABELS[cap]}
                    </span>
                  ))}
                </span>
              )}
            </button>
          </div>
          <h1 className="pf-text-display text-2xl text-pf-foreground sm:text-3xl">AI 智能部署</h1>
          <p className="text-sm text-pf-muted-foreground">
            智能分析项目依赖，一键构建最优 Python 开发环境
          </p>
          <p className="max-w-xl text-xs leading-relaxed text-pf-muted-foreground">
            AI 助手将扫描您的项目文件，自动识别依赖关系，推荐最佳 Python
            版本、虚拟环境配置和镜像源方案。
          </p>
          <div className="flex flex-wrap gap-3 pt-1">
            <Button onClick={() => void handleStartDeploy()} disabled={!analysis || isDeploying}>
              <Rocket className="mr-1.5 h-4 w-4" />
              开始智能部署
            </Button>
          </div>
        </div>

        <div className="relative mx-auto flex h-28 w-28 shrink-0 items-center justify-center sm:mx-0 sm:h-36 sm:w-36">
          <div className="absolute inset-0 animate-[spin_14s_linear_infinite]">
            {[0, 90, 180, 270].map((deg) => (
              <span
                key={deg}
                className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-pf-primary shadow-[0_0_10px_rgba(45,212,191,0.6)]"
                style={{ transform: `translate(-50%, -50%) rotate(${deg}deg) translateY(-48px)` }}
              />
            ))}
          </div>
          <div className="relative z-10 flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full border border-pf-primary/25 bg-pf-primary/10 text-pf-primary shadow-[0_0_40px_rgba(45,212,191,0.15)] animate-[pulse_3s_ease-in-out_infinite]">
            <Sparkles className="h-7 w-7" />
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
                            : step.status === 'failed'
                              ? 'border-destructive/50 bg-destructive/10 text-destructive'
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
                              : step.status === 'failed'
                                ? 'text-destructive'
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
                        step.status === 'completed' ? 'bg-pf-primary' : 'bg-pf-border'
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
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 text-xs text-pf-muted-foreground">
                <span className="font-mono text-pf-primary">{progress}%</span>
                <span>{deployStatusText}</span>
              </div>
              {/* 部署操作：与流程进度同卡片，操作动线更集中 */}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  onClick={() => void handleGeneratePlan()}
                  disabled={isDeploying || isGeneratingPlan || !analysis}
                  variant="outline"
                  size="sm"
                >
                  {isGeneratingPlan ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ScrollText className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {isGeneratingPlan ? '生成中...' : '生成方案'}
                </Button>
                <Button
                  onClick={() => void handleStartDeploy()}
                  disabled={isDeploying || !analysis}
                  size="sm"
                >
                  <Play className="mr-1.5 h-3.5 w-3.5" />
                  开始部署
                </Button>
                <Button variant="destructive" onClick={handleCancel} disabled={!isDeploying} size="sm">
                  <X className="mr-1.5 h-3.5 w-3.5" />
                  取消
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main two-column layout：AI 助手对话固定于右侧列，分析/推荐居左 */}
      <div className="grid gap-6 lg:grid-cols-5">
        {/* Right side: Chat panel（窄列固定区，视觉重心与左侧内容平衡） */}
        <div className="flex flex-col gap-6 lg:order-2 lg:col-span-2">
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
                  {QUICK_PROMPTS.map((prompt) => (
                    <Button
                      key={prompt}
                      variant="outline"
                      size="sm"
                      onClick={() => void handleSend(prompt)}
                      disabled={isStreaming || isDeploying}
                    >
                      <Zap className="mr-1 h-3 w-3" />
                      {prompt}
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
                        if (!isStreaming) void handleSend();
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
                      onClick={() => void handleSend()}
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

        {/* Left: Deployment wizard summary（宽列：项目分析 + 部署要点） */}
        <div className="flex flex-col gap-6 lg:order-1 lg:col-span-3">
          {/* Project analysis */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileSearch className="h-5 w-5 text-pf-primary" />
                  <CardTitle className="text-base">项目分析结果</CardTitle>
                </div>
                {analysis ? (
                  <Badge variant="outline" className="gap-1 text-state-success">
                    <CheckCircle2 className="h-3 w-3" />
                    已完成
                  </Badge>
                ) : (
                  <Badge variant="secondary">待分析</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  placeholder="输入项目根目录绝对路径，例如 D:\code\my-project"
                  value={projectPathInput}
                  onChange={(e) => setProjectPathInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !isAnalyzing) void handleAnalyze();
                  }}
                  className="flex-1 font-mono text-xs"
                />
                <Button
                  onClick={() => void handleAnalyze()}
                  disabled={isAnalyzing || !projectPathInput.trim()}
                  className="shrink-0"
                >
                  {isAnalyzing ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <FileSearch className="mr-1.5 h-4 w-4" />
                  )}
                  {isAnalyzing ? '分析中...' : '分析项目'}
                </Button>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {analysisFields.map((item) => (
                  <div
                    key={item.label}
                    className="flex flex-col gap-1 rounded-lg border border-pf-border bg-pf-muted p-2.5"
                  >
                    <span className="text-[11px] text-pf-muted-foreground">{item.label}</span>
                    <span
                      className={`truncate text-sm font-semibold text-pf-foreground ${item.mono ? 'font-mono' : ''}`}
                      title={item.value}
                    >
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
                {analysis && analysis.dependencies.length > 0 ? (
                  <div className="flex flex-col gap-1.5">
                    {analysis.dependencies.slice(0, 8).map((dep) => (
                      <div
                        key={dep.name}
                        className="rounded-md border border-pf-border bg-pf-muted px-2.5 py-1.5 font-mono text-xs text-pf-foreground"
                      >
                        <span className="text-pf-primary">{dep.name}</span>
                        {dep.version_constraint && (
                          <span className="text-pf-muted-foreground">{dep.version_constraint}</span>
                        )}
                      </div>
                    ))}
                    {analysis.dependencies.length > 8 && (
                      <span className="px-1 pt-1 font-mono text-[11px] text-pf-muted-foreground">
                        ...还有 {analysis.dependencies.length - 8} 个
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-pf-border bg-pf-muted/40 p-4 text-center text-xs text-pf-muted-foreground">
                    {analysis ? '未检测到依赖声明' : '完成项目分析后，这里将展示真实检测到的依赖'}
                  </div>
                )}
              </div>

              <div>
                <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-pf-muted-foreground">
                  <ScrollText className="h-3 w-3" />
                  部署命令
                </div>
                {deployCommands.length > 0 ? (
                  <div className="space-y-1.5 rounded-lg border border-pf-border bg-pf-muted p-3">
                    {deployCommands.map((cmd, index) => (
                      <code key={index} className="block font-mono text-xs text-pf-foreground">
                        <span className="text-pf-primary">$</span> {cmd}
                      </code>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-pf-border bg-pf-muted/40 p-4 text-center text-xs text-pf-muted-foreground">
                    完成项目分析后，这里将展示部署命令
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Deploy points（由真实扫描结果派生，替代原硬编码推荐列表） */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-pf-primary drop-shadow-[0_0_5px_rgba(45,212,191,0.55)]" />
                  <CardTitle className="text-base">部署要点</CardTitle>
                </div>
                <Badge variant="secondary">
                  {deployPoints.length ? `${deployPoints.length} 项` : '待分析'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {deployPoints.length === 0 ? (
                <div className="rounded-lg border border-dashed border-pf-border bg-pf-muted/40 p-6 text-center text-xs text-pf-muted-foreground">
                  完成项目分析后，这里将展示基于真实扫描结果的部署要点（Python 版本、虚拟环境、依赖与镜像源）。
                </div>
              ) : (
                deployPoints.map((point) => {
                  const Icon = recommendationIcons[point.icon] ?? Zap;
                  return (
                    <div
                      key={point.title}
                      className="flex items-center gap-3 rounded-lg border border-pf-border bg-pf-muted p-3"
                    >
                      <div
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-pf-primary ${
                          point.ready ? 'bg-pf-primary/10 shadow-[0_0_16px_rgba(45,212,191,0.18)]' : 'bg-pf-muted'
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-pf-foreground">{point.title}</div>
                        <div className="truncate text-xs text-pf-muted-foreground" title={point.description}>
                          {point.description}
                        </div>
                      </div>
                      <span
                        className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold ${
                          point.ready
                            ? 'border border-state-success/25 bg-state-success/10 text-state-success'
                            : 'border border-pf-border bg-transparent text-pf-muted-foreground'
                        }`}
                      >
                        {point.ready ? (
                          <span className="flex items-center gap-1">
                            <Check className="h-3 w-3" /> 就绪
                          </span>
                        ) : (
                          '待确认'
                        )}
                      </span>
                    </div>
                  );
                })
              )}
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
            {terminalLines.length === 0 ? (
              <div className="text-pf-muted-foreground/60">等待操作... 分析项目或开始部署后，此处将输出真实执行日志。</div>
            ) : (
              terminalLines.map((line, index) => {
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
                if (line.startsWith('✗')) {
                  return (
                    <div key={index}>
                      <span className="text-destructive">{line}</span>
                    </div>
                  );
                }
                return <div key={index}>{line}</div>;
              })
            )}
            <span className="animate-pulse font-bold text-pf-primary">▌</span>
          </pre>
        </CardContent>
      </Card>
    </div>
  );
};
