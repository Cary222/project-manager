/**
 * Unified Model Registry — 站点 DB + 本地 model.json 合并层
 *
 * 合并规则：
 * 1. Site DB models（只读）：来自 UserApiKey + Discovery
 * 2. Local model.json（本地覆盖）：用户本地配置的 Provider/Model
 * 3. 优先级：Local > Site（同名 provider 时 local 覆盖）
 *
 * 数据流：
 * - Site DB（UserApiKey + discovered models）→ getSiteModels(userId)
 * - Local model.json → getLocalModels()
 * - 合并 → getUnifiedModels()
 *
 * =============================================================================
 * 缓存策略
 * =============================================================================
 * getSiteModels() 结果通过 /lib/unified-models-cache.ts 缓存（TTL 5min）。
 * 调用方（/api/ai/models/registry、/api/models）使用 loadUnifiedModelsWithCache()
 * 确保 site models discovery 结果在多个端点间共享，避免重复 HTTP 请求。
 */

import { getEnabledModels } from "@/features/ai/llm/providers/registry";
import { readModelsConfig } from "@/lib/models-config-store";
import { inferCapabilities } from "@/features/ai/llm/capabilities";
import type { ModelCatalogEntry } from "@/features/ai/llm/providers/types";
import type { ProviderEntry, ModelEntry, ModelsJson } from "@/features/ai/ui/model-settings/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UnifiedModelEntry {
  provider: string;
  modelName: string;
  modelRef: string; // "provider:modelName"
  displayName: string;
  capabilities: string[];
  apiFormat: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  source: "site" | "local";
}

export interface UnifiedProviderEntry {
  provider: string;
  baseURL: string | null;
  apiFormat: string;
  /** Local-only: apiKey from models.json (Site DB credentials not reflected here). */
  apiKey?: string;
  models: UnifiedModelEntry[];
  source: "site" | "local";
}

// ---------------------------------------------------------------------------
// Site Models（只读，来自 DB）
// ---------------------------------------------------------------------------

/**
 * 获取站点 DB 中的所有模型（UserApiKey 凭证对应的已发现模型）
 * 返回按 provider 分组的模型列表
 */
export async function getSiteModels(userId: string | null): Promise<UnifiedProviderEntry[]> {
  if (!userId) return [];

  const catalogModels = await getEnabledModels(userId);
  return catalogModelsToProviders(catalogModels, "site");
}

// ---------------------------------------------------------------------------
// Local Models（来自 model.json）
// ---------------------------------------------------------------------------

/**
 * 读取本地 model.json 中的 Provider/Model 配置
 */
export async function getLocalModels(): Promise<ModelsJson> {
  const raw = await readModelsConfig();
  if (!raw || typeof raw !== "object") return { providers: {} };
  return raw as ModelsJson;
}

// ---------------------------------------------------------------------------
// Merge Logic
// ---------------------------------------------------------------------------

/**
 * 合并 Site DB 和 Local model.json
 *
 * 规则：
 * 1. Site models 按 provider 分组，local models 也按 provider 分组
 * 2. Local provider 覆盖 Site provider（同名时）
 * 3. 模型列表合并（去重，优先使用 local 的 displayName）
 */
export async function getUnifiedModels(
  userId: string | null
): Promise<UnifiedProviderEntry[]> {
  const [siteProviders, localConfig] = await Promise.all([
    getSiteModels(userId),
    getLocalModels(),
  ]);

  const localProviders = localConfig.providers ?? {};
  const result = new Map<string, UnifiedProviderEntry>();

  // 先加入 site providers（标记为 site）
  for (const provider of siteProviders) {
    result.set(provider.provider, provider);
  }

  // local 覆盖或新增（标记为 local）
  for (const [providerName, providerConfig] of Object.entries(localProviders)) {
    const localModels = (providerConfig.models ?? []).map(
      modelToUnifiedModel(providerName, "local")
    );

    if (result.has(providerName)) {
      // 合并：site + local models，去重；local 的 apiKey 覆盖 site
      const existing = result.get(providerName)!;
      const mergedModels = mergeModelLists(existing.models, localModels);
      result.set(providerName, {
        provider: providerName,
        baseURL: providerConfig.baseUrl ?? null,
        apiFormat: providerConfig.api ?? "openai-completions",
        apiKey: providerConfig.apiKey,
        models: mergedModels,
        source: "local", // local 覆盖，标记为 local
      });
    } else {
      // 新增 local provider
      result.set(providerName, {
        provider: providerName,
        baseURL: providerConfig.baseUrl ?? null,
        apiFormat: providerConfig.api ?? "openai-completions",
        apiKey: providerConfig.apiKey,
        models: localModels,
        source: "local",
      });
    }
  }

  return Array.from(result.values());
}

/**
 * 将 ModelCatalogEntry 列表转换为 UnifiedProviderEntry 列表
 */
function catalogModelsToProviders(
  models: ModelCatalogEntry[],
  source: "site" | "local"
): UnifiedProviderEntry[] {
  const providerMap = new Map<string, UnifiedProviderEntry>();

  for (const model of models) {
    const provider = model.provider ?? "";
    if (!provider) continue;

    if (!providerMap.has(provider)) {
      providerMap.set(provider, {
        provider,
        baseURL: null, // site models 从凭证获取
        apiFormat: model.apiFormat ?? "openai-chat",
        models: [],
        source,
      });
    }

    const entry = providerMap.get(provider)!;
    entry.models.push({
      provider,
      modelName: model.modelName,
      modelRef: model.modelRef,
      displayName: model.displayName ?? model.modelName,
      capabilities: model.capabilities ?? [],
      apiFormat: model.apiFormat ?? "openai-chat",
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      reasoning: model.reasoning,
      source,
    });
  }

  return Array.from(providerMap.values());
}

/**
 * 将 ModelEntry 转换为 UnifiedModelEntry
 */
function modelToUnifiedModel(
  provider: string,
  source: "site" | "local"
): (m: ModelEntry) => UnifiedModelEntry {
  return (m: ModelEntry) => ({
    provider,
    modelName: m.id,
    modelRef: `${provider}:${m.id}`, // 规范格式
    displayName: m.name ?? m.id,
    capabilities: inferCapabilities(m.id),
    apiFormat: m.api ?? "openai-completions",
    contextWindow: m.contextWindow,
    maxTokens: m.maxTokens,
    reasoning: m.reasoning,
    source,
  });
}

/**
 * `inferCapabilities` moved to `@/features/ai/llm/capabilities` to share with
 * `lib/unified-model-registry.ts` and avoid rule drift between the two call sites.

/**
 * 合并两个模型列表（去重，优先使用 local 的 displayName）
 */
function mergeModelLists(
  siteModels: UnifiedModelEntry[],
  localModels: UnifiedModelEntry[]
): UnifiedModelEntry[] {
  const merged = new Map<string, UnifiedModelEntry>();

  // 先加入 site models
  for (const model of siteModels) {
    merged.set(model.modelName, { ...model });
  }

  // local 覆盖（使用 local 的 displayName）
  for (const model of localModels) {
    const existing = merged.get(model.modelName);
    if (existing) {
      merged.set(model.modelName, {
        ...model,
        provider: existing.provider, // 保留 provider
        source: "local", // local 覆盖
      });
    } else {
      merged.set(model.modelName, model);
    }
  }

  return Array.from(merged.values());
}

// ---------------------------------------------------------------------------
// Conversions（用于 PiWorkspaceAdapter）
// ---------------------------------------------------------------------------

/**
 * 将 site discovery 的 apiFormat 归一化为 models.json 的 `api` 选项。
 */
export function apiFormatToApiOption(apiFormat: string): NonNullable<ProviderEntry["api"]> {
  return apiFormat === "anthropic"
    ? "anthropic-messages"
    : apiFormat === "openai-responses"
      ? "openai-responses"
      : apiFormat === "openai-chat"
        ? "openai-completions"
        : apiFormat === "google-generative-ai"
          ? "google-generative-ai"
          : "openai-completions";
}

/**
 * 将 UnifiedProviderEntry 转换为 ProviderEntry（Pi Workspace 格式）。
 *
 * ⚠️ 注意：此转换是 **有损** 的（site discovery 只产出 id/name/reasoning/
 * contextWindow/maxTokens，不包含 thinkingLevelMap / cost / input / headers /
 * compat 等本地字段）。它只适用于 `/api/models` 的模型下拉列表，
 * 不能用于 Settings 对话框的 load→save 往返，否则会把 models.json 里的
 * apiKey / thinkingLevelMap 等字段抹掉。
 */
export function toProviderEntry(unified: UnifiedProviderEntry): ProviderEntry {
  return {
    baseUrl: unified.baseURL ?? undefined,
    api: apiFormatToApiOption(unified.apiFormat),
    apiKey: unified.apiKey,
    models: unified.models.map((m) => ({
      id: m.modelName,
      name: m.displayName !== m.modelName ? m.displayName : undefined,
      reasoning: m.reasoning,
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
    })),
  };
}

/**
 * 将 UnifiedProviderEntry[] 转换为 ModelsJson（有损，仅供 /api/models 下拉）。
 */
export function toModelsJson(unified: UnifiedProviderEntry[]): ModelsJson {
  const providers: Record<string, ProviderEntry> = {};
  for (const entry of unified) {
    providers[entry.provider] = toProviderEntry(entry);
  }
  return { providers };
}

// ---------------------------------------------------------------------------
// Full-fidelity merge（用于 /api/ai/models/registry Settings 对话框）
// ---------------------------------------------------------------------------

/** Site discovery 的模型只带元数据字段，转换为最小 ModelEntry（只读视图）。 */
function siteModelToEntry(m: UnifiedModelEntry): ModelEntry {
  return {
    id: m.modelName,
    name: m.displayName !== m.modelName ? m.displayName : undefined,
    reasoning: m.reasoning,
    contextWindow: m.contextWindow,
    maxTokens: m.maxTokens,
  };
}

/** Site-only provider → 只读条目（凭证在 DB，不写入 models.json）。 */
function siteProviderToEntry(
  site: UnifiedProviderEntry,
): ProviderEntry & { __source: "site" } {
  return {
    baseUrl: site.baseURL ?? undefined,
    api: apiFormatToApiOption(site.apiFormat),
    models: site.models.map(siteModelToEntry),
    __source: "site",
  };
}

/**
 * 合并 site 模型（只读元数据）与 local 模型（完整字段），同 id 时 local 覆盖。
 */
function mergeModelEntries(siteModels: ModelEntry[], localModels: ModelEntry[]): ModelEntry[] {
  const merged = new Map<string, ModelEntry>();
  for (const m of siteModels) merged.set(m.id, m);
  for (const m of localModels) merged.set(m.id, m); // local 完整字段覆盖
  return Array.from(merged.values());
}

/**
 * 用「完整 local models.json + 缓存的 unified 合并视图」构建 Settings 对话框
 * 所需的 ModelsJson，**无损保留** local provider 的所有字段：
 * - provider 级：apiKey / headers / compat / modelOverrides
 * - model 级：api / reasoning / thinkingLevelMap / input / cost / headers / compat
 *
 * 规则：
 * - local 存在 → 以完整 local 条目为准，合并 site 发现的额外模型（source==="site"）
 * - local 不存在 → site-only provider 转为只读条目（__source: "site"）
 */
export function buildFullModelsConfig(
  unified: UnifiedProviderEntry[],
  localConfig: ModelsJson,
): ModelsJson {
  const localProviders = localConfig.providers ?? {};
  const providers: Record<string, ProviderEntry & { __source?: "site" | "local" }> = {};

  for (const entry of unified) {
    const localEntry = localProviders[entry.provider];
    if (localEntry) {
      // local 存在 → 完整保留 local 字段，并合并 site 发现的额外模型
      const siteModels = entry.models
        .filter((m) => m.source === "site")
        .map(siteModelToEntry);
      providers[entry.provider] = {
        ...localEntry,
        __source: "local",
        models: mergeModelEntries(siteModels, localEntry.models ?? []),
      };
    } else {
      // site-only → 只读条目
      providers[entry.provider] = siteProviderToEntry(entry);
    }
  }

  return { providers };
}
