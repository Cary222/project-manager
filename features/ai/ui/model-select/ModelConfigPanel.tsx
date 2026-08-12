"use client";

import { useState, useMemo } from "react";
import { useSession } from "next-auth/react";
import {
  ModelSelectionProvider,
  useModelSelection,
} from "@/features/ai/ui/model-select/ModelSelectionContext";
import { useApiKeys } from "@/features/ai/ui/model-select/useApiKeys";
import { useModelSortAndFilter } from "@/features/ai/ui/model-select/useModelSortAndFilter";
import { useModelCatalog } from "@/features/ai/ui/model-select/useModelCatalog";
import { SearchInput } from "@/shared/ui/SearchInput";
import { IconCheck, IconLoader, IconSettings, IconTrash, IconPlus, IconX } from "@/shared/ui/icons";
import { updatePreferredAiModelAction } from "@/features/admin/settings";
import type { AiModel } from "@/features/ai/ui/model-select/types";
import { ConfigPanelModelSelect } from "./ConfigPanelModelSelect";
import { getProviderDisplayName, CATEGORY_CONFIG, PROVIDER_DISPLAY_NAMES } from "./model-labels";

/* ------------------------------------------------------------------ */
/*  Helper functions                                                     */
/* ------------------------------------------------------------------ */
function getCategoryLabel(category: string) {
  return CATEGORY_CONFIG[category]?.label
    ? `${CATEGORY_CONFIG[category].icon} ${CATEGORY_CONFIG[category].label}`
    : category;
}

/* ------------------------------------------------------------------ */
/*  Inner — must be inside ModelSelectionProvider                      */
/* ------------------------------------------------------------------ */
interface ModelConfigPanelInnerProps {
  preferredAiModel?: string | null;
  availableModels: AiModel[];
}

function ModelConfigPanelInner({ preferredAiModel, availableModels }: ModelConfigPanelInnerProps) {
  const { data: session } = useSession();
  const isRoot = session?.user?.role === "ROOT";

  const { state, configurableModels, toggleModel, toggleProvider, toggleCategory,
    selectAll, deselectAll, resetToDefault } = useModelSelection();
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState<"user" | "system">("user");

  // 对话总结用模型偏好
  const [selectedPreferredModel, setSelectedPreferredModel] = useState<string>(
    preferredAiModel ?? ""
  );
  const [preferredFlash, setPreferredFlash] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [preferredSaving, setPreferredSaving] = useState(false);

  const {
    userKeys,
    systemKeys,
    isLoaded,
    isSaving,
    error,
    saveApiKey,
    testApiKey,
    deleteApiKey,
    hasKey,
    hasSystemKey,
    getKeysByProvider,
    getSystemKeysByProvider,
    reload,
  } = useApiKeys();

  const { sortedProviderEntries } = useModelSortAndFilter(
    configurableModels,
    state.selectedModelIds,
    searchTerm
  );

  async function handlePreferredModelSave() {
    setPreferredSaving(true);
    setPreferredFlash(null);
    // 空字符串表示使用默认（Agnes）
    const modelToSave = selectedPreferredModel === "" ? null : selectedPreferredModel;
    const result = await updatePreferredAiModelAction(modelToSave);
    setPreferredSaving(false);
    if (result.error) {
      setPreferredFlash({ type: "error", message: result.error });
    } else {
      setPreferredFlash({ type: "success", message: "AI 模型偏好已保存" });
    }
  }

  const handleToggleProvider = (provider: string, checked: boolean) => {
    toggleProvider(provider, checked);
  };

  const handleToggleCategory = (provider: string, category: string, checked: boolean) => {
    toggleCategory(provider, category, checked);
  };

  if (!state.isLoaded || !isLoaded) {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-400">
        <IconLoader className="h-4 w-4 animate-spin" />
        加载模型中…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* 对话总结用 AI 模型偏好 — 放在配置面板顶部 */}
      <div className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wide text-brand-600">对话总结模型</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <ConfigPanelModelSelect
              value={selectedPreferredModel === "default" ? "" : selectedPreferredModel}
              onChange={(modelRef) => setSelectedPreferredModel(modelRef)}
            />
          </div>
          <button
            type="button"
            onClick={handlePreferredModelSave}
            disabled={preferredSaving}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {preferredSaving ? "保存中…" : "保存"}
          </button>
        </div>
        {preferredFlash && (
          <p
            className={`mt-2 rounded-md border px-3 py-2 text-xs ${
              preferredFlash.type === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-red-200 bg-red-50 text-red-700"
            }`}
          >
            {preferredFlash.message}
          </p>
        )}
        <p className="mt-2 text-xs text-ink-500">
          {selectedPreferredModel === "default" || selectedPreferredModel === ""
            ? "使用系统默认的 Agnes 模型进行对话总结"
            : "使用选中的模型进行对话总结"}
        </p>
      </div>

      <SearchInput
        value={searchTerm}
        onChange={setSearchTerm}
        placeholder="搜索模型或厂商…"
      />

      {/* Bulk actions */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-ink-500">
          {searchTerm
            ? `「${searchTerm}」：${sortedProviderEntries.length} 个厂商`
            : `已选 ${state.selectedModelIds.size} / ${configurableModels.length} 个模型`}
        </span>
        <div className="ml-auto flex gap-1">
          <button
            onClick={selectAll}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-ink-500 transition hover:bg-ink-100 hover:text-ink-700"
          >
            全选
          </button>
          <button
            onClick={deselectAll}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-ink-500 transition hover:bg-ink-100 hover:text-ink-700"
          >
            取消
          </button>
          <button
            onClick={resetToDefault}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-ink-500 transition hover:bg-ink-100 hover:text-ink-700"
          >
            重置
          </button>
        </div>
      </div>

      {/* Two-column layout: Models + API Keys */}
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {/* Model list */}
        <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
          {sortedProviderEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-ink-300 bg-white p-8 text-center">
              <p className="text-sm text-ink-400">{searchTerm ? "没有匹配的模型" : "暂无可用模型"}</p>
            </div>
          ) : (
            sortedProviderEntries.map(([provider, categories]) => {
              const providerModels = Object.values(categories as Record<string, AiModel[]>).flat();
              const selectedProviderModels = providerModels.filter((m) =>
                state.selectedModelIds.has(m.value)
              );
              const isAllSelected =
                selectedProviderModels.length > 0 &&
                selectedProviderModels.length === providerModels.length;

              return (
                <div key={provider} className="rounded-xl border border-ink-100 bg-ink-50/50 p-3">
                  {/* Provider row */}
                  <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-ink-900">
                    <input
                      type="checkbox"
                      checked={isAllSelected}
                      onChange={(e) => handleToggleProvider(provider, e.target.checked)}
                      className="h-4 w-4 rounded border-ink-300 text-brand-500 focus:ring-brand-500"
                    />
                    {getProviderDisplayName(provider)}
                    <span className="ml-auto rounded bg-ink-100 px-2 py-0.5 text-xs font-normal text-ink-500">
                      {selectedProviderModels.length}/{providerModels.length}
                    </span>
                  </label>

                  {/* Category rows */}
                  <div className="ml-6 mt-2 space-y-2">
                    {Object.entries(categories as Record<string, AiModel[]>).map(
                      ([category, models]) => {
                        const selectedInCategory = models.filter((m) =>
                          state.selectedModelIds.has(m.value)
                        );
                        const isAllCategorySelected =
                          selectedInCategory.length > 0 &&
                          selectedInCategory.length === models.length;

                        return (
                          <div key={category}>
                            <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-ink-600">
                              <input
                                type="checkbox"
                                checked={isAllCategorySelected}
                                onChange={(e) =>
                                  handleToggleCategory(provider, category, e.target.checked)
                                }
                                className="h-3.5 w-3.5 rounded border-ink-300 text-brand-500 focus:ring-brand-500"
                              />
                              {getCategoryLabel(category)}
                            </label>
                            <div className="ml-5 space-y-1">
                              {models.map((model) => (
                                <label
                                  key={model.value}
                                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink-700 transition hover:bg-white"
                                >
                                  <input
                                    type="checkbox"
                                    checked={state.selectedModelIds.has(model.value)}
                                    onChange={() => toggleModel(model.value)}
                                    className="h-3.5 w-3.5 rounded border-ink-300 text-brand-500 focus:ring-brand-500"
                                  />
                                  <span className="flex-1">{model.model}</span>
                                  {state.selectedModelIds.has(model.value) && (
                                    <IconCheck className="h-3.5 w-3.5 text-brand-500" />
                                  )}
                                </label>
                              ))}
                            </div>
                          </div>
                        );
                      }
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* API Key section */}
        <ApiKeyConfigPanel
          userKeys={userKeys}
          systemKeys={systemKeys}
          isRoot={isRoot}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          isSaving={isSaving}
          error={error}
          onSave={saveApiKey}
          onTest={testApiKey}
          onDelete={deleteApiKey}
          hasKey={hasKey}
          hasSystemKey={hasSystemKey}
          getKeysByProvider={getKeysByProvider}
          getSystemKeysByProvider={getSystemKeysByProvider}
          onReload={reload}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  API Key Config Panel                                               */
/* ------------------------------------------------------------------ */
import type { UserKeyInfo } from "./useApiKeys";

interface ApiKeyConfigPanelProps {
  userKeys: UserKeyInfo[];
  systemKeys: UserKeyInfo[];
  isRoot: boolean;
  activeTab: "user" | "system";
  onTabChange: (tab: "user" | "system") => void;
  isSaving: boolean;
  error: string | null;
  onSave: (
    provider: string,
    name: string,
    apiKey: string,
    baseURL?: string,
    options?: { transport?: string; apiFormat?: string; ownerType?: "USER" | "SYSTEM" }
  ) => Promise<boolean>;
  onTest: (
    provider: string,
    apiKey: string,
    baseURL?: string
  ) => Promise<{ success: boolean; message: string }>;
  onDelete: (id?: string, provider?: string, ownerType?: "USER" | "SYSTEM") => Promise<boolean>;
  hasKey: (provider: string) => boolean;
  hasSystemKey: (provider: string) => boolean;
  getKeysByProvider: (provider: string) => UserKeyInfo[];
  getSystemKeysByProvider: (provider: string) => UserKeyInfo[];
  onReload: () => void;
}

/** 所有预定义 provider id */
const BUILTIN_PROVIDER_IDS = Object.keys(PROVIDER_DISPLAY_NAMES);

function ApiKeyConfigPanel({
  userKeys,
  systemKeys,
  isRoot,
  activeTab,
  onTabChange,
  isSaving,
  error,
  onSave,
  onTest,
  onDelete,
  hasKey,
  hasSystemKey,
  getKeysByProvider,
  getSystemKeysByProvider,
  onReload,
}: ApiKeyConfigPanelProps) {
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [addingCustomProvider, setAddingCustomProvider] = useState(false);

  // Form state
  const [inputProvider, setInputProvider] = useState("");
  const [inputKey, setInputKey] = useState("");
  const [inputBaseURL, setInputBaseURL] = useState("");
  const [inputTransport, setInputTransport] = useState<"proxy" | "direct">("direct");
  const [inputApiFormat, setInputApiFormat] = useState<string>("openai-chat");
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [savingKey, setSavingKey] = useState(false);

  const activeKeys = activeTab === "system" ? systemKeys : userKeys;
  const activeHasKey = activeTab === "system" ? hasSystemKey : hasKey;
  const activeGetKeys = activeTab === "system" ? getSystemKeysByProvider : getKeysByProvider;
  const isSystem = activeTab === "system";

  // 所有已出现的 provider（包括预定义 + 自定义）
  const allProviders = useMemo(() => {
    const seen = new Set<string>();
    activeKeys.forEach((k) => seen.add(k.provider));
    return seen;
  }, [activeKeys]);

  // 预定义但未配置的 provider
  const unconfiguredBuiltin = useMemo(
    () => BUILTIN_PROVIDER_IDS.filter((id) => !allProviders.has(id)),
    [allProviders]
  );

  function handleSelectProvider(provider: string) {
    setAddingCustomProvider(false);
    setExpandedProvider(provider === expandedProvider ? null : provider);
    setInputProvider(provider);
    setInputKey("");
    setInputBaseURL("");
    setTestResult(null);
    setSavingKey(false);
    const existingKeys = activeGetKeys(provider);
    if (existingKeys.length > 0) {
      const first = existingKeys[0];
      setInputTransport(
        first.transport === "proxy" ? "proxy" : "direct"
      );
      setInputApiFormat(
        first.apiFormat ? String(first.apiFormat) : provider === "anthropic" ? "anthropic" : "openai-chat"
      );
    } else {
      setInputTransport(
        provider === "deepseek" || provider === "siliconflow" ? "direct" : "proxy"
      );
      setInputApiFormat(provider === "anthropic" ? "anthropic" : "openai-chat");
    }
  }

  function handleAddCustomProvider() {
    setAddingCustomProvider(true);
    setExpandedProvider(null);
    setInputProvider("");
    setInputKey("");
    setInputBaseURL("");
    setInputTransport("direct");
    setInputApiFormat("openai-chat");
    setTestResult(null);
    setSavingKey(false);
  }

  function handleCancelAdd() {
    setAddingCustomProvider(false);
    setExpandedProvider(null);
  }

  async function handleTest() {
    if (!inputProvider || !inputKey) return;
    setIsTesting(true);
    setTestResult(null);
    const result = await onTest(inputProvider, inputKey, inputBaseURL || undefined);
    setTestResult(result);
    setIsTesting(false);
  }

  async function handleSave() {
    if (!inputProvider || !inputKey) return;
    setSavingKey(true);
    // name 默认用用户输入的 provider id
    const name = inputProvider;
    const ownerType: "USER" | "SYSTEM" = isSystem ? "SYSTEM" : "USER";
    const success = await onSave(
      inputProvider,
      name,
      inputKey,
      inputBaseURL || undefined,
      { transport: inputTransport, apiFormat: inputApiFormat, ownerType }
    );
    setSavingKey(false);
    if (success) {
      setInputKey("");
      setInputBaseURL("");
      setTestResult(null);
      setExpandedProvider(null);
      setAddingCustomProvider(false);
      onReload();
    }
  }

  async function handleDeleteById(id: string) {
    if (!confirm("确定删除此 API Key？")) return;
    const ownerType: "USER" | "SYSTEM" = isSystem ? "SYSTEM" : "USER";
    await onDelete(id, undefined, ownerType);
    onReload();
  }

  // 按 provider 分组已配置的 keys
  const groupedByProvider = useMemo(() => {
    const map = new Map<string, UserKeyInfo[]>();
    for (const k of activeKeys) {
      const list = map.get(k.provider) ?? [];
      list.push(k);
      map.set(k.provider, list);
    }
    return Array.from(map.entries());
  }, [activeKeys]);

  return (
    <div className="rounded-xl border border-ink-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <IconSettings className="h-4 w-4 text-ink-500" />
        <p className="text-sm font-medium text-ink-900">API Key 管理</p>
      </div>

      {/* ROOT Tab: User / System switch */}
      {isRoot && (
        <div className="mb-3 flex rounded-lg border border-ink-200 p-0.5">
          <button
            onClick={() => { onTabChange("user"); setExpandedProvider(null); setAddingCustomProvider(false); }}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition ${
              activeTab === "user"
                ? "bg-brand-500 text-white"
                : "text-ink-500 hover:bg-ink-100"
            }`}
          >
            用户配置
          </button>
          <button
            onClick={() => { onTabChange("system"); setExpandedProvider(null); setAddingCustomProvider(false); }}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition ${
              activeTab === "system"
                ? "bg-brand-500 text-white"
                : "text-ink-500 hover:bg-ink-100"
            }`}
          >
            系统配置
          </button>
        </div>
      )}

      {/* 已配置的 Keys — 按 provider 分组 */}
      <div className="space-y-2">
        {groupedByProvider.map(([provider, keys]) => {
          const isExpanded = expandedProvider === provider;
          return (
            <div key={provider}>
              <div
                className={`flex items-center justify-between rounded-lg border px-3 py-2 transition ${
                  isExpanded
                    ? "border-brand-300 bg-brand-50"
                    : "border-ink-200 bg-white hover:border-ink-300"
                }`}
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <button
                    onClick={() => handleSelectProvider(provider)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <span className="truncate text-xs font-medium text-ink-700">
                      {getProviderDisplayName(provider)}
                    </span>
                    {keys.length > 1 && (
                      <span className="flex-shrink-0 rounded bg-brand-100 px-1.5 py-0.5 text-xs text-brand-700">
                        ×{keys.length}
                      </span>
                    )}
                  </button>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleSelectProvider(provider)}
                    className="rounded px-2 py-1 text-xs text-ink-400 transition hover:bg-ink-100 hover:text-ink-600"
                  >
                    {isExpanded ? "收起" : "编辑"}
                  </button>
                </div>
              </div>

              {/* Provider 展开：显示 key 列表 + 输入表单 */}
              {isExpanded && (
                <div className="mt-1.5 space-y-2 rounded-lg border border-brand-200 bg-brand-50 p-3">
                  {/* Key 列表 */}
                  <div className="space-y-1.5">
                    {keys.map((k) => (
                      <div
                        key={k.id}
                        className="flex items-center justify-between rounded-md border border-ink-100 bg-white px-3 py-2"
                      >
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <div className="flex items-center gap-2">
                            <span className="rounded bg-ink-100 px-1.5 py-0.5 text-xs text-ink-600">
                              ···{k.keyLast4}
                            </span>
                            <span className="rounded bg-ink-200 px-1.5 py-0.5 text-xs text-ink-600">
                              {k.apiFormat ?? "—"}
                            </span>
                            <span className="rounded bg-ink-200 px-1.5 py-0.5 text-xs text-ink-600">
                              {k.transport ?? "—"}
                            </span>
                          </div>
                          {k.baseURL && (
                            <span className="truncate text-xs text-ink-400">{k.baseURL}</span>
                          )}
                        </div>
                        <button
                          onClick={() => handleDeleteById(k.id)}
                          className="flex-shrink-0 rounded p-1 text-danger-400 transition hover:bg-danger-50 hover:text-danger-600"
                          title="删除此 Key"
                        >
                          <IconTrash className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* 输入表单 */}
                  <div className="space-y-2 border-t border-brand-200 pt-2">
                    <p className="text-xs font-medium text-ink-600">
                      {isSystem && (
                        <span className="mr-2 rounded bg-ink-200 px-1.5 py-0.5 text-xs text-ink-600">
                          系统级
                        </span>
                      )}
                      添加新 Key
                    </p>

                    <input
                      type="password"
                      value={inputKey}
                      onChange={(e) => setInputKey(e.target.value)}
                      placeholder="输入 API Key（sk-...）"
                      className="w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-xs text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
                      autoComplete="off"
                    />

                    <input
                      type="url"
                      value={inputBaseURL}
                      onChange={(e) => setInputBaseURL(e.target.value)}
                      placeholder="Base URL（可选，留空使用默认值）"
                      className="w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-xs text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
                    />

                    {/* System-only: Transport + ApiFormat */}
                    {isSystem && (
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="mb-1 block text-xs text-ink-600">传输方式</label>
                          <select
                            value={inputTransport}
                            onChange={(e) => setInputTransport(e.target.value as "proxy" | "direct")}
                            className="w-full rounded-md border border-ink-300 bg-white px-2 py-1.5 text-xs text-ink-900 focus:border-brand-500 focus:outline-none"
                          >
                            <option value="proxy">代理 (proxy)</option>
                            <option value="direct">直连 (direct)</option>
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-ink-600">API 协议</label>
                          <select
                            value={inputApiFormat}
                            onChange={(e) => setInputApiFormat(e.target.value)}
                            className="w-full rounded-md border border-ink-300 bg-white px-2 py-1.5 text-xs text-ink-900 focus:border-brand-500 focus:outline-none"
                          >
                            <option value="openai-chat">OpenAI Chat</option>
                            <option value="openai-responses">OpenAI Responses</option>
                            <option value="anthropic">Anthropic</option>
                          </select>
                        </div>
                      </div>
                    )}

                    {testResult && (
                      <div
                        className={`flex items-center gap-2 rounded-md px-3 py-2 text-xs ${
                          testResult.success
                            ? "bg-success-50 text-success-700"
                            : "bg-danger-50 text-danger-700"
                        }`}
                      >
                        {testResult.success ? (
                          <IconCheck className="h-3.5 w-3.5 flex-shrink-0" />
                        ) : (
                          <span className="flex-shrink-0">✕</span>
                        )}
                        {testResult.message}
                      </div>
                    )}

                    {error && (
                      <div className="flex items-center gap-2 rounded-md bg-danger-50 px-3 py-2 text-xs text-danger-700">
                        {error}
                      </div>
                    )}

                    <div className="flex gap-2">
                      <button
                        onClick={handleTest}
                        disabled={!inputKey || isTesting}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-ink-300 bg-white px-3 py-2 text-xs font-medium text-ink-700 transition hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <IconLoader className="h-3 w-3" />
                        测试
                      </button>
                      <button
                        onClick={handleSave}
                        disabled={!inputKey || savingKey}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-brand-500 px-3 py-2 text-xs font-medium text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {savingKey ? (
                          <IconLoader className="h-3 w-3 animate-spin" />
                        ) : (
                          <IconCheck className="h-3 w-3" />
                        )}
                        保存
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* 未配置的预定义 provider */}
        {unconfiguredBuiltin.map((id) => (
          <button
            key={id}
            onClick={() => handleSelectProvider(id)}
            className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left transition ${
              expandedProvider === id
                ? "border-brand-500 bg-brand-50"
                : "border-ink-200 hover:border-ink-300 hover:bg-ink-50"
            }`}
          >
            <span className="text-xs font-medium text-ink-600">{getProviderDisplayName(id)}</span>
            <span className="text-xs text-ink-400">点击配置</span>
          </button>
        ))}

        {/* 添加自定义 Provider */}
        {addingCustomProvider ? (
          <div className="rounded-lg border border-brand-300 bg-brand-50 p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-medium text-ink-700">自定义 Provider</p>
              <button onClick={handleCancelAdd} className="text-ink-400 hover:text-ink-600">
                <IconX className="h-4 w-4" />
              </button>
            </div>

            <input
              type="text"
              value={inputProvider}
              onChange={(e) => setInputProvider(e.target.value.toLowerCase().replace(/\s+/g, "-"))}
              placeholder="Provider ID（如 my-azure）"
              className="mb-2 w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-xs text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
            />

            <input
              type="password"
              value={inputKey}
              onChange={(e) => setInputKey(e.target.value)}
              placeholder="API Key（sk-...）"
              className="mb-2 w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-xs text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
              autoComplete="off"
            />

            <input
              type="url"
              value={inputBaseURL}
              onChange={(e) => setInputBaseURL(e.target.value)}
              placeholder="Base URL（必填，自定义 Provider 需要）"
              className="mb-2 w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-xs text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
            />

            {isSystem && (
              <div className="mb-2 grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-xs text-ink-600">传输方式</label>
                  <select
                    value={inputTransport}
                    onChange={(e) => setInputTransport(e.target.value as "proxy" | "direct")}
                    className="w-full rounded-md border border-ink-300 bg-white px-2 py-1.5 text-xs text-ink-900 focus:border-brand-500 focus:outline-none"
                  >
                    <option value="proxy">代理 (proxy)</option>
                    <option value="direct">直连 (direct)</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-ink-600">API 协议</label>
                  <select
                    value={inputApiFormat}
                    onChange={(e) => setInputApiFormat(e.target.value)}
                    className="w-full rounded-md border border-ink-300 bg-white px-2 py-1.5 text-xs text-ink-900 focus:border-brand-500 focus:outline-none"
                  >
                    <option value="openai-chat">OpenAI Chat</option>
                    <option value="openai-responses">OpenAI Responses</option>
                    <option value="anthropic">Anthropic</option>
                  </select>
                </div>
              </div>
            )}

            {testResult && (
              <div
                className={`mb-2 flex items-center gap-2 rounded-md px-3 py-2 text-xs ${
                  testResult.success ? "bg-success-50 text-success-700" : "bg-danger-50 text-danger-700"
                }`}
              >
                {testResult.success ? <IconCheck className="h-3.5 w-3.5 flex-shrink-0" /> : <span className="flex-shrink-0">✕</span>}
                {testResult.message}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={handleTest}
                disabled={!inputProvider || !inputKey || isTesting}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-ink-300 bg-white px-3 py-2 text-xs font-medium text-ink-700 transition hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <IconLoader className="h-3 w-3" />
                测试
              </button>
              <button
                onClick={handleSave}
                disabled={!inputProvider || !inputKey || !inputBaseURL || savingKey}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-brand-500 px-3 py-2 text-xs font-medium text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingKey ? <IconLoader className="h-3 w-3 animate-spin" /> : <IconCheck className="h-3 w-3" />}
                保存
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={handleAddCustomProvider}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-ink-300 px-3 py-2 text-xs text-ink-500 transition hover:border-brand-400 hover:text-brand-600"
          >
            <IconPlus className="h-3.5 w-3.5" />
            添加自定义 Provider
          </button>
        )}
      </div>

      <p className="mt-3 flex items-start gap-2 rounded-lg bg-ink-100 px-3 py-2 text-xs text-ink-500">
        <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-ink-200 text-ink-600">
          <IconCheck className="h-2.5 w-2.5" />
        </span>
        {activeTab === "system"
          ? "系统配置对所有用户生效，仅 ROOT 管理员可修改"
          : "Key 加密存储，仅显示后 4 位 · 支持同 Provider 配置多个 Key"}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Public component                                                   */
/* ------------------------------------------------------------------ */
export function ModelConfigPanel(props: { preferredAiModel?: string | null }) {
  const { models, loading, error } = useModelCatalog();

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-400">
        <IconLoader className="h-4 w-4 animate-spin" />
        从服务器加载模型列表…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-600">加载失败：{error}</p>
      </div>
    );
  }

  if (models.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-ink-300 bg-white p-8 text-center">
        <p className="text-sm text-ink-400">暂无可用模型，请检查环境变量配置</p>
      </div>
    );
  }

  const defaultModel = models[0]?.value ?? "";

  return (
    <ModelSelectionProvider
      configurableModels={models}
      initialModel={defaultModel}
    >
      <ModelConfigPanelInner
        preferredAiModel={props.preferredAiModel}
        availableModels={models}
      />
    </ModelSelectionProvider>
  );
}
