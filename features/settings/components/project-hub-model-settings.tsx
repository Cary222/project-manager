"use client";

/**
 * ProjectHub AI Model Settings（Stage 6）— 统一的 ProjectHub-native 模型配置 UI
 *
 * 架构：Pi 成熟 UX（共享 model-settings 套件）+ ProjectHub 数据层
 *   UI → ProjectHubAdapter → /api/ai/providers*（UserApiKey DB / CredentialService）
 *   模型启停/收藏/thinking → /api/ai/model-preferences（UnifiedModelSelector 消费）
 *
 * 不写 models.json（Workspace Source of Truth 不受影响）。
 */

import { useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import useSWR, { mutate } from "swr";
import {
  CredentialForm,
  ModelSettingsPanel,
  ProviderIcon,
  type ApiKeyProvider,
} from "@/features/ai/ui/model-settings";
import { PROVIDER_PRESETS, getProviderPresetDisplayName } from "@/features/ai/llm/providers/presets";
import { useApiKeys } from "@/features/ai/ui/model-select/useApiKeys";
import { useProjectHubAdapter } from "../lib/project-hub-model-adapter";
import { IconPlus, IconTrash } from "@/shared/ui/icons";
import "./model-settings-theme.css";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface DiscoveredModelView {
  modelRef: string;
  modelName: string;
  displayName: string;
  provider?: string;
}

export function ProjectHubModelSettings() {
  const { data: session } = useSession();
  const isRoot = session?.user?.role === "ROOT";

  const {
    userKeys,
    systemKeys,
    saveApiKey,
    deleteApiKey,
    hasKey,
  } = useApiKeys();

  const { data: modelsData } = useSWR<{ data: DiscoveredModelView[] }>(
    "/api/ai/models",
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );
  const models = useMemo(() => modelsData?.data ?? [], [modelsData]);

  const modelCountByProvider = useMemo(() => {
    const counts = new Map<string, number>();
    for (const model of models) {
      const provider = model.provider ?? model.modelRef.split(":")[0];
      if (!provider) continue;
      counts.set(provider, (counts.get(provider) ?? 0) + 1);
    }
    return counts;
  }, [models]);

  // Picker / API Key 分区：预设目录 + 已配置的自定义 provider
  const apiKeyProviders = useMemo<ApiKeyProvider[]>(() => {
    const list: ApiKeyProvider[] = PROVIDER_PRESETS.map((preset) => ({
      id: preset.id,
      displayName: preset.displayName,
      configured: hasKey(preset.id),
      modelCount: modelCountByProvider.get(preset.id) ?? 0,
    }));
    // 已配置但不在预设里的自定义 provider
    for (const key of userKeys) {
      if (!list.some((p) => p.id === key.provider)) {
        list.push({
          id: key.provider,
          displayName: key.name || key.provider,
          configured: true,
          modelCount: modelCountByProvider.get(key.provider) ?? 0,
        });
      }
    }
    return list;
  }, [userKeys, hasKey, modelCountByProvider]);

  const adapter = useProjectHubAdapter();
  const [settingsOpen, setSettingsOpen] = useState(false);

  // CredentialForm 落库（CredentialService，加密/掩码语义不变）
  const makeSaveCredential = (providerId: string, displayName: string) =>
    async (apiKey: string) => {
      const ok = await saveApiKey(providerId, displayName, apiKey);
      if (!ok) throw new Error("保存失败，请检查 API Key 与网络");
      mutate("/api/ai/models");
    };

  const makeRemoveCredential = (providerId: string) =>
    async () => {
      const ok = await deleteApiKey(undefined, providerId, "USER");
      if (!ok) throw new Error("删除失败");
      mutate("/api/ai/models");
    };

  const configuredKeys = userKeys;

  return (
    <div className="model-settings-theme space-y-4">
      {/* 已配置 Provider 概览（Pi UX：图标 + 展示名 + 掩码 key + 模型数） */}
      <div className="rounded-xl border border-ink-100 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink-900">我的 Provider</h3>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-brand-700"
          >
            <IconPlus className="h-3.5 w-3.5" />
            配置 Provider 与模型
          </button>
        </div>

        {configuredKeys.length === 0 ? (
          <p className="rounded-lg border border-dashed border-ink-200 px-4 py-6 text-center text-xs text-ink-400">
            尚未配置任何 Provider。点击右上角按钮，选择 Provider 并填入 API Key。
          </p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {configuredKeys.map((key) => (
              <li key={key.id} className="flex items-center gap-3 py-2.5">
                <ProviderIcon id={key.provider} size={22} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink-800">
                    {getProviderPresetDisplayName(key.provider) ?? key.name}
                  </p>
                  <p className="truncate font-mono text-[11px] text-ink-400">
                    sk-…{key.keyLast4}
                    {key.baseURL ? ` · ${key.baseURL}` : ""}
                    {` · ${modelCountByProvider.get(key.provider) ?? 0} 个模型`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void deleteApiKey(key.id, undefined, "USER").then(() => mutate("/api/ai/models"))}
                  className="rounded-md p-1.5 text-ink-300 transition hover:bg-red-50 hover:text-red-500"
                  title="删除凭证"
                >
                  <IconTrash className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ROOT：SYSTEM Provider 管理（平台默认凭证，保留原能力） */}
      {isRoot && (
        <SystemProvidersSection
          systemKeys={systemKeys}
          onSave={saveApiKey}
          onDelete={deleteApiKey}
        />
      )}

      {/* Pi 风格配置对话框（DB-backed Adapter） */}
      {settingsOpen && (
        <ModelSettingsPanel
          adapter={adapter}
          onClose={() => {
            setSettingsOpen(false);
            mutate("/api/ai/providers");
            mutate("/api/ai/models");
          }}
          title="AI 模型配置"
          subtitle={<span className="text-[11px] text-ink-400">ProjectHub 账号凭证（加密存储）</span>}
          sections={{
            apikey: {
              providers: apiKeyProviders,
              renderDetail: (p) => (
                <CredentialForm
                  key={p.id}
                  provider={p}
                  onSave={makeSaveCredential(p.id, p.displayName)}
                  onRemove={p.configured ? makeRemoveCredential(p.id) : undefined}
                />
              ),
            },
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SYSTEM Providers（ROOT 专用，保留旧面板能力）                        */
/* ------------------------------------------------------------------ */

interface SystemProvidersSectionProps {
  systemKeys: Array<{
    id: string;
    provider: string;
    name: string;
    baseURL: string | null;
    keyLast4: string;
    apiFormat?: string;
    transport?: string;
  }>;
  onSave: (
    provider: string,
    name: string,
    apiKey: string,
    baseURL?: string,
    options?: { transport?: string; apiFormat?: string; ownerType?: "USER" | "SYSTEM" },
  ) => Promise<boolean>;
  onDelete: (id?: string, provider?: string, ownerType?: "USER" | "SYSTEM") => Promise<boolean>;
}

function SystemProvidersSection({ systemKeys, onSave, onDelete }: SystemProvidersSectionProps) {
  const [provider, setProvider] = useState("");
  const [name, setName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseURL, setBaseURL] = useState("");
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const inputClass =
    "w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-800 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100";

  async function handleAdd() {
    if (!provider.trim() || !apiKey.trim()) {
      setFlash({ type: "error", message: "Provider 与 API Key 必填" });
      return;
    }
    setSaving(true);
    setFlash(null);
    const ok = await onSave(provider.trim(), name.trim() || provider.trim(), apiKey.trim(), baseURL.trim() || undefined, {
      ownerType: "SYSTEM",
    });
    setSaving(false);
    if (ok) {
      setFlash({ type: "success", message: "SYSTEM Provider 已保存" });
      setProvider("");
      setName("");
      setApiKey("");
      setBaseURL("");
      mutate("/api/ai/models");
    } else {
      setFlash({ type: "error", message: "保存失败" });
    }
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
      <h3 className="mb-1 text-sm font-semibold text-amber-800">SYSTEM Providers（ROOT）</h3>
      <p className="mb-3 text-xs text-amber-700/80">平台级默认凭证：所有用户可用，USER 自有凭证优先。</p>

      {systemKeys.length > 0 && (
        <ul className="mb-3 divide-y divide-amber-100 rounded-lg border border-amber-100 bg-white">
          {systemKeys.map((key) => (
            <li key={key.id} className="flex items-center gap-3 px-3 py-2">
              <ProviderIcon id={key.provider} size={20} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink-800">{key.name}</p>
                <p className="truncate font-mono text-[11px] text-ink-400">
                  {key.provider} · sk-…{key.keyLast4} · {key.apiFormat}
                  {key.baseURL ? ` · ${key.baseURL}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void onDelete(key.id, undefined, "SYSTEM").then(() => mutate("/api/ai/models"))}
                className="rounded-md p-1.5 text-ink-300 transition hover:bg-red-50 hover:text-red-500"
                title="删除 SYSTEM Provider"
              >
                <IconTrash className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <input className={inputClass} value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="provider id（如 deepseek）" />
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="名称" />
        <input className={inputClass} type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="API Key" />
        <input className={inputClass} value={baseURL} onChange={(e) => setBaseURL(e.target.value)} placeholder="Base URL（可选）" />
      </div>
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void handleAdd()}
          disabled={saving}
          className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-medium text-white transition hover:bg-amber-700 disabled:opacity-50"
        >
          {saving ? "保存中…" : "添加 SYSTEM Provider"}
        </button>
        {flash && (
          <span className={`text-xs ${flash.type === "success" ? "text-emerald-600" : "text-red-600"}`}>
            {flash.message}
          </span>
        )}
      </div>
    </div>
  );
}
