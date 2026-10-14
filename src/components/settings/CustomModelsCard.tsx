import { Braces, Brain, Download, Loader2, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import React, { useRef, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select, SelectItem } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import {
  ALL_CAPABILITIES,
  CAPABILITY_LABELS,
  PROVIDER_DEFAULT_BASE_URL,
  PROVIDER_LABELS,
  createEmptyModel,
  downloadModelsJson,
  parseModelsFromJson,
} from '@/lib/custom-models';
import { useCustomModelsStore } from '@/store/useAppStore';
import type { CustomAiModel, ModelCapability } from '@/types/settings';

/**
 * AI 自定义模型配置卡片：
 * 智能体模式的完整配置项（服务商、模型、能力参数），
 * 支持本地保存、JSON 导入导出，所有变更经 store 实时生效。
 */
export const CustomModelsCard: React.FC = () => {
  const models = useCustomModelsStore((s) => s.models);
  const addModel = useCustomModelsStore((s) => s.addModel);
  const updateModel = useCustomModelsStore((s) => s.updateModel);
  const removeModel = useCustomModelsStore((s) => s.removeModel);
  const setModelEnabled = useCustomModelsStore((s) => s.setModelEnabled);
  const importModels = useCustomModelsStore((s) => s.importModels);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CustomAiModel | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const startCreate = () => {
    const model = createEmptyModel();
    setDraft(model);
    setEditingId(model.id);
    addModel(model);
  };

  const startEdit = (model: CustomAiModel) => {
    setDraft({ ...model });
    setEditingId(model.id);
  };

  const cancelEdit = () => {
    if (editingId && draft && !models.some((m) => m.id === editingId && m.name === draft.name && m.model === draft.model)) {
      // 新增未保存即取消：无需回滚，字段保存即生效
    }
    setDraft(null);
    setEditingId(null);
  };

  const saveDraft = () => {
    if (!draft) return;
    updateModel(draft);
    setDraft(null);
    setEditingId(null);
    setNotice({ type: 'success', text: '模型配置已保存并实时生效' });
    window.setTimeout(() => setNotice(null), 2500);
  };

  const patchDraft = (patch: Partial<CustomAiModel>) => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const toggleCapability = (cap: ModelCapability) => {
    if (!draft) return;
    const has = draft.capabilities.includes(cap);
    patchDraft({
      capabilities: has
        ? draft.capabilities.filter((c) => c !== cap)
        : [...draft.capabilities, cap],
    });
  };

  const handleExport = () => {
    downloadModelsJson(models);
    setNotice({ type: 'success', text: '已导出模型配置 JSON' });
    window.setTimeout(() => setNotice(null), 2500);
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseModelsFromJson(text);
      importModels(parsed, 'merge');
      setNotice({ type: 'success', text: `已导入 ${parsed.length} 个模型配置（同 ID 覆盖合并）` });
    } catch (err) {
      setNotice({
        type: 'error',
        text: err instanceof Error ? err.message : '导入失败',
      });
    }
    window.setTimeout(() => setNotice(null), 3000);
  };

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-6">
        <div className="mb-3 flex items-center gap-2">
          <Brain className="h-4 w-4 text-pf-primary" />
          <h2 className="pf-text-heading text-base text-pf-foreground">AI 自定义模型（智能体模式）</h2>
        </div>
        <p className="mb-4 text-xs leading-relaxed text-pf-muted-foreground">
          配置自定义模型供 AI 部署、对话等智能体功能使用：启用后实时生效，无需重启应用。支持本地保存与 JSON 导入导出。
        </p>

        {notice && (
          <div
            className={`mb-3 rounded-lg border px-3 py-2 text-xs ${
              notice.type === 'success'
                ? 'border-state-success/40 bg-state-success/10 text-state-success'
                : 'border-state-error/40 bg-state-error/10 text-state-error'
            }`}
          >
            {notice.text}
          </div>
        )}

        {/* 模型列表 */}
        <div className="space-y-2">
          {models.length === 0 && (
            <div className="rounded-lg border border-dashed border-pf-border px-4 py-6 text-center text-xs text-pf-muted-foreground">
              暂无自定义模型，点击「新增模型」创建，或导入已有 JSON 配置。
            </div>
          )}

          {models.map((model) => {
            const isEditing = model.id === editingId;
            return (
              <div
                key={model.id}
                className={`rounded-lg border px-3 py-2.5 transition-colors ${
                  model.enabled ? 'border-pf-primary/40 bg-pf-primary/5' : 'border-pf-border'
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Switch
                    checked={model.enabled}
                    onCheckedChange={(checked) => setModelEnabled(model.id, checked)}
                    aria-label={model.enabled ? '停用该模型' : '启用该模型'}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium text-pf-foreground">{model.name}</span>
                      {model.enabled && (
                        <Badge className="px-1.5 py-0 text-[9px]">生效中</Badge>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-pf-muted-foreground">
                      <span>{PROVIDER_LABELS[model.provider]}</span>
                      {model.model && (
                        <>
                          <span className="text-pf-border">·</span>
                          <span className="font-mono">{model.model}</span>
                        </>
                      )}
                      <span className="text-pf-border">·</span>
                      <span>max {model.maxTokens}</span>
                      <span className="text-pf-border">·</span>
                      <span>T {model.temperature.toFixed(1)}</span>
                      <span className="text-pf-border">·</span>
                      <span>top_p {model.topP.toFixed(2)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {model.capabilities.map((cap) => (
                        <span
                          key={cap}
                          className="rounded bg-pf-muted px-1.5 py-0.5 text-[10px] text-pf-muted-foreground"
                        >
                          {CAPABILITY_LABELS[cap]}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      aria-label="编辑模型"
                      onClick={() => (isEditing ? cancelEdit() : startEdit(model))}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-state-error hover:bg-state-error/10"
                      aria-label="删除模型"
                      onClick={() => {
                        removeModel(model.id);
                        if (isEditing) cancelEdit();
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {/* 编辑表单 */}
                {isEditing && draft && (
                  <div className="mt-3 space-y-3 border-t border-pf-border pt-3">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-pf-foreground">名称</label>
                        <Input
                          value={draft.name}
                          onChange={(e) => patchDraft({ name: e.target.value })}
                          placeholder="例如：DeepSeek 主力模型"
                          className="h-8 text-sm"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-pf-foreground">服务商</label>
                        <Select
                          value={draft.provider}
                          onChange={(e) => {
                            const provider = e.target.value as CustomAiModel['provider'];
                            patchDraft({
                              provider,
                              // 预置服务商自动补全默认端点，可手动覆盖
                              baseUrl: PROVIDER_DEFAULT_BASE_URL[provider] ?? draft.baseUrl,
                            });
                          }}
                          className="h-8 text-sm"
                        >
                          {(Object.keys(PROVIDER_LABELS) as Array<keyof typeof PROVIDER_LABELS>).map(
                            (p) => (
                              <SelectItem key={p} value={p}>
                                {PROVIDER_LABELS[p]}
                              </SelectItem>
                            )
                          )}
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-pf-foreground">模型标识</label>
                        <Input
                          value={draft.model}
                          onChange={(e) => patchDraft({ model: e.target.value })}
                          placeholder="例如：deepseek-chat"
                          className="h-8 font-mono text-sm"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-pf-foreground">API 地址（可选）</label>
                        <Input
                          value={draft.baseUrl ?? ''}
                          onChange={(e) => patchDraft({ baseUrl: e.target.value })}
                          placeholder="https://api.example.com/v1"
                          className="h-8 font-mono text-xs"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-pf-foreground">API 密钥（仅本地保存）</label>
                        <Input
                          type="password"
                          value={draft.apiKey ?? ''}
                          onChange={(e) => patchDraft({ apiKey: e.target.value })}
                          placeholder="sk-..."
                          className="h-8 text-sm"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-pf-foreground">最大输出 Token</label>
                        <Input
                          type="number"
                          min={1}
                          max={1000000}
                          value={draft.maxTokens}
                          onChange={(e) => patchDraft({ maxTokens: Number(e.target.value) || 4096 })}
                          className="h-8 font-mono text-sm"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-pf-foreground">
                          温度（{draft.temperature.toFixed(1)}）
                        </label>
                        <input
                          type="range"
                          min={0}
                          max={2}
                          step={0.1}
                          value={draft.temperature}
                          onChange={(e) => patchDraft({ temperature: parseFloat(e.target.value) })}
                          className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-pf-muted accent-pf-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-pf-ring"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-pf-foreground">
                          top_p（{draft.topP.toFixed(2)}）
                        </label>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          value={draft.topP}
                          onChange={(e) => patchDraft({ topP: parseFloat(e.target.value) })}
                          className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-pf-muted accent-pf-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-pf-ring"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-pf-foreground">模型能力</label>
                      <div className="flex flex-wrap gap-1.5">
                        {ALL_CAPABILITIES.map((cap) => {
                          const active = draft.capabilities.includes(cap);
                          return (
                            <button
                              key={cap}
                              type="button"
                              onClick={() => toggleCapability(cap)}
                              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                                active
                                  ? 'border-pf-primary bg-pf-primary/10 text-pf-primary'
                                  : 'border-pf-border text-pf-muted-foreground hover:border-pf-muted-foreground'
                              }`}
                            >
                              {CAPABILITY_LABELS[cap]}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={cancelEdit}>
                        取消
                      </Button>
                      <Button size="sm" onClick={saveDraft} disabled={!draft.name.trim() || !draft.model.trim()}>
                        保存
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* 操作区 */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={startCreate}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            新增模型
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleExport}
            disabled={models.length === 0}
          >
            <Download className="mr-1 h-3.5 w-3.5" />
            导出 JSON
          </Button>
          <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
            <Upload className="mr-1 h-3.5 w-3.5" />
            导入 JSON
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => void handleImportFile(e)}
          />
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-pf-muted-foreground">
            <Braces className="h-3 w-3" />
            配置仅保存在本机
          </span>
        </div>
      </CardContent>
    </Card>
  );
};

/** 骨架占位：配置读取为同步 localStorage，无需异步 loading */
export const CustomModelsCardFallback: React.FC = () => (
  <Card className="overflow-hidden">
    <CardContent className="flex items-center gap-2 p-6 text-sm text-pf-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      正在加载模型配置...
    </CardContent>
  </Card>
);
