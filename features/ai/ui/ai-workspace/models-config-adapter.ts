"use client";

/**
 * PiWorkspaceAdapter — Pi Workspace 的 ModelSettingsAdapter 实现
 *
 * 核心规则（Phase 2+）：
 * 1. Site DB 是站点模型的唯一主数据源（只读；连接元数据 / 模型发现结果）
 * 2. 本地 model.json 是本地配置（可读写；per-model override + 自定义 provider）
 * 3. 合并规则：Local 覆盖 Site（同名 provider 时 local 优先）
 *
 * Save 语义：
 * - 写入 model.json 的目标 payload **不包含** Site providers 的 provider 级系统元数据
 *   （baseURL / api / apiKey 等由 Site DB 管理）
 * - 保留 Site provider 下**用户实际修改过的 model**（整段 model 写入），由 Site + Local
 *   merge 优先 Local 的字段；未改动的 Site model 不写入，避免污染 model.json
 * - Local provider 完整写入
 *
 * 检测"用户实际修改"靠 ModelSettingsPanel 设置的 `__dirtyModelKeys` 内部标记。
 *
 * 数据流：
 * - load() → GET /api/ai/models/registry（服务端统一 registry，包含 Site + Local 合并结果）
 * - save() → PUT /api/models-config
 * - discover/test/catalog → /api/models-config/discover|test|catalog（辅助端点，不作数据源）
 */

import { useMemo } from "react";
import type {
  CatalogResult,
  DiscoverResult,
  ModelSettingsAdapter,
  TestOutcome,
} from "@/features/ai/ui/model-settings/adapter";
import type { ModelEntry, ModelsJson, ProviderEntry } from "@/features/ai/ui/model-settings/types";

/** Site provider 写 model.json 时需剥离的系统字段（Site DB 管理）。 */
const SITE_PROVIDER_LOCKED_FIELDS = ["__source", "apiKey"] as const;

interface ProviderWithDirty extends ProviderEntry {
  __source?: "site" | "local";
  __dirtyModelKeys?: string[];
}

/**
 * 准备写入 model.json 的 payload：
 * - Local providers → 完整保留（保留所有用户编辑）
 * - Site providers → 仅在用户实际修改时提取 dirty models 写入；
 *   provider 级 system 元数据由 Site DB 管理，不写入
 */
function prepareWritablePayload(config: ModelsJson): ModelsJson {
  const providers = config.providers ?? {};
  const next: Record<string, ProviderEntry> = {};

  for (const [name, rawEntry] of Object.entries(providers) as [string, ProviderWithDirty][]) {
    if (rawEntry.__source === "site") {
      // Site provider：仅保留用户实际修改过的 model，其余不写入
      const dirtySet = new Set(rawEntry.__dirtyModelKeys ?? []);
      const dirtyModels: ModelEntry[] = (rawEntry.models ?? []).filter(
        (model) => model.id && dirtySet.has(model.id),
      );

      if (dirtyModels.length === 0) {
        // 未修改 → 不写入
        continue;
      }

      // Site provider 写 model.json 时不允许带 system 字段
      const cleanEntry: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rawEntry)) {
        if (SITE_PROVIDER_LOCKED_FIELDS.includes(k as typeof SITE_PROVIDER_LOCKED_FIELDS[number])) continue;
        cleanEntry[k] = v;
      }
      cleanEntry.models = dirtyModels;
      next[name] = cleanEntry as ProviderEntry;
    } else {
      // Local provider：去除内部标记后完整保留
      const cleanEntry: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rawEntry)) {
        if (k === "__source" || k === "__dirtyModelKeys") continue;
        cleanEntry[k] = v;
      }
      next[name] = cleanEntry as ProviderEntry;
    }
  }
  return { providers: next };
}

export function createPiWorkspaceAdapter(): ModelSettingsAdapter {
  return {
    /**
     * 读取统一合并后的 Provider/Model 配置。
     * 服务端 getUnifiedModels(userId) 已在 /api/ai/models/registry 中完成 Site + Local 合并。
     */
    async load(): Promise<ModelsJson> {
      try {
        const res = await fetch("/api/ai/models/registry");
        if (!res.ok) {
          console.warn("[PiWorkspaceAdapter.load] registry endpoint failed, falling back to local config");
          const local = await loadLocalOnly();
          return local ?? { providers: {} };
        }
        const payload = await res.json() as { data?: ModelsJson | null };
        if (!payload.data) return { providers: {} };
        return payload.data;
      } catch (err) {
        console.warn("[PiWorkspaceAdapter.load] registry endpoint threw, falling back to local config:", err instanceof Error ? err.message : String(err));
        const local = await loadLocalOnly();
        return local ?? { providers: {} };
      }
    },

    /**
     * 保存配置：剥离内部标记 + 仅持久化 dirty Site models。
     */
    async save(config: ModelsJson): Promise<void> {
      const writableConfig = prepareWritablePayload(config);
      const res = await fetch("/api/models-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(writableConfig),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
    },

    /**
     * 删除 provider：Site providers 不允许删除，Local provider 可删除。
     */
    async remove(providerName: string): Promise<boolean> {
      const res = await fetch("/api/models-config");
      if (!res.ok) return false;
      const current = await res.json() as ModelsJson;
      const providers = current.providers ?? {};

      if ((providers[providerName] as ProviderWithDirty)?.__source === "site") {
        console.warn(`[PiWorkspaceAdapter.remove] cannot remove site provider "${providerName}"`);
        return false;
      }

      if (!(providerName in providers)) {
        return false;
      }

      const next = { ...providers };
      delete next[providerName];

      const putRes = await fetch("/api/models-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...current, providers: next }),
      });
      return putRes.ok;
    },

    /**
     * Site providers 只读标记。由 ModelSettingsPanel 用 __source 直接判断，
     * 此方法保留作为 adapter 接口兜底（参数废弃前缀表示未来可能存储本地缓存）。
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    isInherited(_providerName: string): boolean {
      return false;
    },

    async discover(providerName: string, provider: ProviderEntry): Promise<DiscoverResult> {
      const res = await fetch("/api/models-config/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerName, provider: { ...provider, models: undefined } }),
      });
      const data = await res.json().catch(() => ({})) as { models?: DiscoverResult["models"]; endpoint?: string; error?: string };
      if (!res.ok || data.error || !data.models) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      return { models: data.models, endpoint: data.endpoint };
    },

    async test(input: { providerName: string; provider: ProviderEntry; model: ModelEntry }): Promise<TestOutcome> {
      const res = await fetch("/api/models-config/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const d = await res.json().catch(() => ({})) as {
        ok?: boolean;
        error?: string;
        latencyMs?: number;
        status?: number;
        responseText?: string;
      };
      if (!res.ok && d.error === undefined) {
        return { ok: false, error: `HTTP ${res.status}`, latencyMs: d.latencyMs, status: d.status };
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

/**
 * 回退方案：仅读取本地 model.json（registry 端点失败时使用）。
 */
async function loadLocalOnly(): Promise<ModelsJson> {
  try {
    const res = await fetch("/api/models-config");
    if (res.ok) {
      return await res.json() as ModelsJson;
    }
  } catch {
    // ignore
  }
  return { providers: {} };
}

/** React hook：返回稳定的 PiWorkspaceAdapter 实例 */
export function usePiWorkspaceAdapter(): ModelSettingsAdapter {
  return useMemo(() => createPiWorkspaceAdapter(), []);
}
