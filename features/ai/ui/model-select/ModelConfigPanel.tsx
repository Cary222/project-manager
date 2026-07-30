"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import {
  ModelSelectionProvider,
  useModelSelection,
} from "@/features/ai/ui/model-select/ModelSelectionContext";
import { useApiKeys } from "@/features/ai/ui/model-select/useApiKeys";
import { useModelSortAndFilter } from "@/features/ai/ui/model-select/useModelSortAndFilter";
import { useModelCatalog } from "@/features/ai/ui/model-select/useModelCatalog";
import { SearchInput } from "@/shared/ui/SearchInput";
import { IconCheck, IconLoader, IconSettings, IconTrash } from "@/shared/ui/icons";
import type { AiModel } from "@/features/ai/ui/model-select/types";

/* ------------------------------------------------------------------ */
/*  Provider display names                                             */
/* ------------------------------------------------------------------ */
const PROVIDER_LABELS: Record<string, string> = {
  agnes: "Agnes",
  deepseek: "DeepSeek",
  openai: "OpenAI",
  anthropic: "Anthropic",
};

function getProviderLabel(provider: string) {
  return PROVIDER_LABELS[provider] ?? provider;
}

/* ------------------------------------------------------------------ */
/*  Inner — must be inside ModelSelectionProvider                      */
/* ------------------------------------------------------------------ */
function ModelConfigPanelInner() {
  const { data: session } = useSession();
  const isRoot = session?.user?.role === "ROOT";

  const { state, configurableModels, toggleModel, toggleProvider, toggleCategory,
    selectAll, deselectAll, resetToDefault } = useModelSelection();
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState<"user" | "system">("user");

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
    getKeyLast4,
    getSystemKeyLast4,
    reload,
  } = useApiKeys();

  const { sortedProviderEntries } = useModelSortAndFilter(
    configurableModels,
    state.selectedModelIds,
    searchTerm
  );

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
                    {getProviderLabel(provider)}
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
                              {category}
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
          getKeyLast4={getKeyLast4}
          getSystemKeyLast4={getSystemKeyLast4}
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
  onDelete: (provider: string, ownerType?: "USER" | "SYSTEM") => Promise<boolean>;
  hasKey: (provider: string) => boolean;
  hasSystemKey: (provider: string) => boolean;
  getKeyLast4: (provider: string) => string | undefined;
  getSystemKeyLast4: (provider: string) => string | undefined;
  onReload: () => void;
}

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
  getKeyLast4,
  getSystemKeyLast4,
  onReload,
}: ApiKeyConfigPanelProps) {
  const [activeProvider, setActiveProvider] = useState<string | null>(null);
  const [inputKey, setInputKey] = useState("");
  const [inputBaseURL, setInputBaseURL] = useState("");
  const [inputTransport, setInputTransport] = useState<"proxy" | "direct">("direct");
  const [inputApiFormat, setInputApiFormat] = useState<string>("openai-chat");
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  const editableProviders = Object.entries(PROVIDER_LABELS);

  // Determine which keys to show based on active tab
  const activeKeys = activeTab === "system" ? systemKeys : userKeys;
  const activeHasKey = activeTab === "system" ? hasSystemKey : hasKey;
  const activeGetLast4 = activeTab === "system" ? getSystemKeyLast4 : getKeyLast4;

  const handleProviderClick = (provider: string) => {
    const existingKey = activeKeys.find((k) => k.provider === provider);
    setActiveProvider(provider === activeProvider ? null : provider);
    setInputKey("");
    setInputBaseURL(existingKey?.baseURL ?? "");
    setInputTransport(
      "transport" in (existingKey ?? {})
        ? (existingKey as any).transport === "proxy" ? "proxy" : "direct"
        : provider === "deepseek" || provider === "siliconflow" ? "direct" : "proxy"
    );
    setInputApiFormat(
      "apiFormat" in (existingKey ?? {})
        ? String((existingKey as any).apiFormat)
        : provider === "anthropic" ? "anthropic" : "openai-chat"
    );
    setTestResult(null);
  };

  const handleTest = async () => {
    if (!activeProvider || !inputKey) return;
    setIsTesting(true);
    setTestResult(null);
    const result = await onTest(
      activeProvider,
      inputKey,
      inputBaseURL || undefined
    );
    setTestResult(result);
    setIsTesting(false);
  };

  const handleSave = async () => {
    if (!activeProvider || !inputKey) return;
    const name = PROVIDER_LABELS[activeProvider] + " Key";
    const ownerType: "USER" | "SYSTEM" = activeTab === "system" ? "SYSTEM" : "USER";
    const success = await onSave(
      activeProvider,
      name,
      inputKey,
      inputBaseURL || undefined,
      { transport: inputTransport, apiFormat: inputApiFormat, ownerType }
    );
    if (success) {
      setInputKey("");
      setInputBaseURL("");
      setTestResult(null);
      setActiveProvider(null);
      onReload();
    }
  };

  const handleDelete = async (provider: string) => {
    const prefix = activeTab === "system" ? "[系统]" : "";
    if (!confirm(`${prefix}确定删除 ${PROVIDER_LABELS[provider]} 的 API Key？`)) return;
    const ownerType: "USER" | "SYSTEM" = activeTab === "system" ? "SYSTEM" : "USER";
    await onDelete(provider, ownerType);
    onReload();
  };

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
            onClick={() => { onTabChange("user"); setActiveProvider(null); }}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition ${
              activeTab === "user"
                ? "bg-brand-500 text-white"
                : "text-ink-500 hover:bg-ink-100"
            }`}
          >
            用户配置
          </button>
          <button
            onClick={() => { onTabChange("system"); setActiveProvider(null); }}
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

      {/* 已配置的 Keys */}
      <div className="space-y-2">
        {editableProviders.map(([id, label]) => {
          const configured = activeHasKey(id);
          const last4 = activeGetLast4(id);
          const isSystem = activeTab === "system";
          const systemRecord = isSystem ? systemKeys.find((k) => k.provider === id) : null;
          const activeRecord = activeKeys.find((k) => k.provider === id);

          return (
            <div key={id}>
              {configured ? (
                /* 已配置状态 */
                <div className="flex flex-col gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-ink-700">{label}</span>
                      <span className="rounded bg-brand-100 px-1.5 py-0.5 text-xs text-brand-700">
                        ···{last4}
                      </span>
                      <span className="rounded bg-ink-200 px-1.5 py-0.5 text-xs text-ink-600">
                        {(activeRecord as any)?.apiFormat ?? "—"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleProviderClick(id)}
                        className="rounded px-2 py-1 text-xs text-ink-500 transition hover:bg-ink-100 hover:text-ink-700"
                      >
                        更新
                      </button>
                      <button
                        onClick={() => handleDelete(id)}
                        className="rounded p-1 text-danger-500 transition hover:bg-danger-50"
                        title="删除"
                      >
                        <IconTrash className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  {activeRecord && (
                    <div className="flex gap-3 text-xs text-ink-500">
                      <span>传输：{(activeRecord as any).transport ?? "—"}</span>
                      <span>协议：{(activeRecord as any).apiFormat ?? "—"}</span>
                    </div>
                  )}
                </div>
              ) : (
                /* 未配置状态 */
                <button
                  onClick={() => handleProviderClick(id)}
                  className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left transition ${
                    activeProvider === id
                      ? "border-brand-500 bg-brand-50"
                      : "border-ink-200 hover:border-ink-300 hover:bg-ink-50"
                  }`}
                >
                  <span className="text-xs font-medium text-ink-600">{label}</span>
                  <span className="text-xs text-ink-400">点击配置</span>
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* 输入表单（展开时显示） */}
      {activeProvider && (
        <div className="mt-3 space-y-3 rounded-lg border border-brand-200 bg-brand-50 p-3">
          <div className="text-xs font-medium text-ink-700">
            配置 {PROVIDER_LABELS[activeProvider]}
            {activeTab === "system" && (
              <span className="ml-2 rounded bg-ink-200 px-1.5 py-0.5 text-xs text-ink-600">
                系统级
              </span>
            )}
          </div>

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

          {/* System-only: Transport + ApiFormat — always shown */}
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
              测试连接
            </button>
            <button
              onClick={handleSave}
              disabled={!inputKey || isSaving}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-brand-500 px-3 py-2 text-xs font-medium text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSaving ? (
                <IconLoader className="h-3 w-3 animate-spin" />
              ) : (
                <IconCheck className="h-3 w-3" />
              )}
              保存
            </button>
          </div>
        </div>
      )}

      <p className="mt-3 flex items-start gap-2 rounded-lg bg-ink-100 px-3 py-2 text-xs text-ink-500">
        <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-ink-200 text-ink-600">
          <IconCheck className="h-2.5 w-2.5" />
        </span>
        {activeTab === "system"
          ? "系统配置对所有用户生效，仅 ROOT 管理员可修改"
          : "Key 加密存储，仅显示后 4 位"}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Public component                                                   */
/* ------------------------------------------------------------------ */
export function ModelConfigPanel() {
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
      <ModelConfigPanelInner />
    </ModelSelectionProvider>
  );
}
