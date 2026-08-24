"use client";

/**
 * ProjectHubAdapter — ProjectHub DB-backed 的 ModelSettingsAdapter 实现（Stage 6）
 *
 * 数据边界：
 * - UI → 本 Adapter → ProjectHub API（/api/ai/providers* + /api/ai/model-preferences）→ UserApiKey DB
 * - 不写 models.json（Workspace Source of Truth 不受 ProjectHub UI 影响）
 *
 * 语义差异（相对 Pi Workspace）：
 * - load() 从 DB 凭证 + 动态 Discovery 合成配置视图（不含明文 key）
 * - save() 只持久化凭证（Provider CRUD），模型可用性来自 Discovery，
 *   模型启停/收藏/thinking 由 /api/ai/model-preferences 负责
 */

import { useMemo } from "react";
import type {
  CatalogResult,
  DiscoverResult,
  ModelSettingsAdapter,
  TestOutcome,
} from "@/features/ai/ui/model-settings/adapter";
import type { ModelsJson, ProviderEntry } from "@/features/ai/ui/model-settings/types";
import { getProviderPreset, getProviderPresetDisplayName } from "@/features/ai/llm/providers/presets";
import type { ApiFormat } from "@/features/ai/llm/providers/types";

/** Pi models.json api 字符串 → ProjectHub ApiFormat。 */
function piApiToApiFormat(api: string | undefined): ApiFormat {
  if (api === "anthropic-messages") return "anthropic";
  if (api === "openai-responses") return "openai-responses";
  return "openai-chat";
}

function apiFormatToPiApi(apiFormat: ApiFormat): string {
  return apiFormat === "anthropic" ? "anthropic-messages" : "openai-completions";
}

interface UserKeyView {
  id: string;
  provider: string;
  name: string;
  baseURL: string | null;
  keyLast4: string;
  apiFormat: string;
}

interface ModelView {
  modelRef: string;
  modelName: string;
  displayName: string;
  provider?: string;
  apiFormat?: string;
}

export interface ProjectHubAdapterDeps {
  /** 读取最新用户 keys（GET /api/ai/providers）。 */
  fetchUserKeys?: () => Promise<UserKeyView[]>;
  /** 读取最新可用模型（GET /api/ai/models）。 */
  fetchModels?: () => Promise<ModelView[]>;
}

async function defaultFetchUserKeys(): Promise<UserKeyView[]> {
  const res = await fetch("/api/ai/providers");
  const json = await res.json().catch(() => ({})) as { data?: { userKeys?: UserKeyView[] } };
  return json.data?.userKeys ?? [];
}

async function defaultFetchModels(): Promise<ModelView[]> {
  const res = await fetch("/api/ai/models");
  const json = await res.json().catch(() => ({})) as { data?: ModelView[] };
  return json.data ?? [];
}

export function createProjectHubAdapter(deps: ProjectHubAdapterDeps = {}): ModelSettingsAdapter {
  const fetchUserKeys = deps.fetchUserKeys ?? defaultFetchUserKeys;
  const fetchModels = deps.fetchModels ?? defaultFetchModels;

  return {
    async load(): Promise<ModelsJson> {
      const [keys, models] = await Promise.all([fetchUserKeys(), fetchModels()]);

      const providers: Record<string, ProviderEntry> = {};
      for (const key of keys) {
        const preset = getProviderPreset(key.provider);
        providers[key.provider] = {
          baseUrl: key.baseURL ?? preset?.baseUrl,
          api: apiFormatToPiApi((key.apiFormat as ApiFormat) ?? preset?.apiFormat ?? "openai-chat"),
          // 凭证不出库：不携带明文 key，UI 仅展示/替换
          models: [],
        };
      }

      // Discovery 结果作为 provider 的模型视图
      for (const model of models) {
        const provider = model.provider ?? model.modelRef.split(":")[0];
        if (!provider) continue;
        const entry = providers[provider] ??= {
          api: apiFormatToPiApi((model.apiFormat as ApiFormat) ?? "openai-chat"),
          models: [],
        };
        entry.models = entry.models ?? [];
        if (!entry.models.some((m) => m.id === model.modelName)) {
          entry.models.push({
            id: model.modelName,
            name: model.displayName !== model.modelName ? model.displayName : undefined,
          });
        }
      }

      return { providers };
    },

    async save(config: ModelsJson): Promise<void> {
      // ProjectHub 侧 save = 持久化凭证（Provider CRUD）。
      // 仅当表单里有草稿 apiKey 时才写 DB；其余字段（baseURL/api）随凭证一并更新。
      const entries = Object.entries(config.providers ?? {}).filter(
        ([, provider]) => provider.apiKey && provider.apiKey.trim(),
      );
      for (const [providerId, provider] of entries) {
        const res = await fetch("/api/ai/providers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: providerId,
            name: getProviderPresetDisplayName(providerId) ?? providerId,
            apiKey: provider.apiKey!.trim(),
            baseURL: provider.baseUrl?.trim() || undefined,
            apiFormat: piApiToApiFormat(provider.api),
          }),
        });
        const d = await res.json().catch(() => ({})) as { error?: string };
        if (!res.ok || d.error) {
          throw new Error(d.error ?? `保存 "${providerId}" 凭证失败（HTTP ${res.status}）`);
        }
      }
    },

    async remove(providerName: string): Promise<boolean> {
      // 查找 DB 中匹配 providerName 的 key（USER 优先，ROOT 可见 SYSTEM）
      const keys = await fetchUserKeys();
      const match = keys.find((k) => k.provider === providerName);
      if (!match) return false;
      const res = await fetch("/api/ai/providers", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: match.id }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(d.error ?? `删除 "${providerName}" 凭证失败（HTTP ${res.status}）`);
      }
      return true;
    },

    async discover(providerName: string, provider: ProviderEntry): Promise<DiscoverResult> {
      const res = await fetch("/api/ai/providers/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: providerName,
          baseURL: provider.baseUrl,
          apiFormat: piApiToApiFormat(provider.api),
          apiKey: provider.apiKey,
        }),
      });
      const json = await res.json().catch(() => ({})) as { data?: DiscoverResult; error?: string };
      if (!res.ok || json.error || !json.data) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      return json.data;
    },

    async test(input: { providerName: string; provider: ProviderEntry; model: { id: string } }): Promise<TestOutcome> {
      const res = await fetch("/api/ai/providers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: input.providerName,
          modelId: input.model.id,
          baseURL: input.provider.baseUrl,
          apiFormat: piApiToApiFormat(input.provider.api),
          apiKey: input.provider.apiKey,
        }),
      });
      const d = await res.json().catch(() => ({})) as {
        ok?: boolean;
        error?: string;
        latencyMs?: number;
        status?: number;
        responseText?: string;
      };
      if (!res.ok && d.error === undefined) {
        return { ok: false, error: `HTTP ${res.status}` };
      }
      return {
        ok: Boolean(d.ok),
        error: d.error,
        latencyMs: d.latencyMs,
        status: d.status,
        responseText: d.responseText,
      };
    },

    async catalog(params: { query: string; provider: string; baseUrl?: string; limit?: number }): Promise<CatalogResult> {
      // models.dev 目录是共享公共元数据，复用现有 /api/models-config/catalog（契约不变）
      const search = new URLSearchParams({ q: params.query, provider: params.provider, limit: String(params.limit ?? 50) });
      if (params.baseUrl) search.set("baseUrl", params.baseUrl);
      const res = await fetch(`/api/models-config/catalog?${search}`);
      const data = await res.json().catch(() => ({})) as { recommendation?: CatalogResult["recommendation"]; error?: string };
      if (!res.ok || data.error) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      return { recommendation: data.recommendation };
    },
  };
}

/** React hook：返回稳定的 ProjectHubAdapter 实例。 */
export function useProjectHubAdapter(deps: ProjectHubAdapterDeps = {}): ModelSettingsAdapter {
  const fetchUserKeys = deps.fetchUserKeys;
  const fetchModels = deps.fetchModels;
  return useMemo(
    () => createProjectHubAdapter({ ...(fetchUserKeys ? { fetchUserKeys } : {}), ...(fetchModels ? { fetchModels } : {}) }),
    [fetchUserKeys, fetchModels],
  );
}
