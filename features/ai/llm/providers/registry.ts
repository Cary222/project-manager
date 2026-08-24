/**
 * Provider Registry & Dynamic Model Discovery — User Scope
 *
 * =============================================================================
 * 职责边界
 * =============================================================================
 * ✅ 负责：
 *   - Provider Registry（KNOWN_DEFAULTS 常量）
 *   - Model Discovery（discoverModelsFromAPI）— 调用 Provider API 获取模型列表
 *   - Model Creation（createModel）— 创建 AI SDK 模型实例
 *   - API Format 推断（inferApiFormat）
 *   - Capability 推断（inferCapabilities）
 *   - Agnes Hardcoded Models（AGNES_MODELS）
 *   - Response Normalization（Agnes Responses API → Chat Completions）
 *
 * ❌ 不负责：
 *   - Credential CRUD / 解析（由 api-key-store.ts 提供）
 *   - BaseURL 规范化（由 lib/normalize-base-url.ts 提供）
 *   - 模型价格元数据（由 lib/model-catalog.ts 提供）
 *   - Workspace Scope 的 Pi ModelRuntime（由 lib/model-discovery.ts 提供）
 *
 * =============================================================================
 * Scope 边界
 * =============================================================================
 * 本文件属于 User Scope，服务于 /api/ai/models（用户可用的 AI 模型）
 *
 * User Scope vs Workspace Scope：
 * - User Scope：用户个人配置的 Provider / 模型，服务 Chat / WorkAgent
 * - Workspace Scope：Pi Runtime 的模型配置，服务 PiSubAgent
 *
 * Shared vs Isolated：
 * - ✅ Shared：BaseURL Normalization、Response Normalization、discoverModelsFromAPI
 * - ❌ Isolated：createModel（User）、Pi ModelRuntime（Workspace）
 *
 * =============================================================================
 * Discovery 链路（User Scope）
 * =============================================================================
 * /api/ai/models
 *   → loadUserModelsWithCache(userId)          [lib/user-models-cache.ts]
 *   → getEnabledModels(userId)                  [registry.ts]
 *     → getSystemCredentials()                  [api-key-store.ts]
 *     → discoverModelsFromAPI()                 [registry.ts] ← 本文件
 *     → getUserProviderRecords()                [api-key-store.ts]
 *     → discoverModelsFromAPI()                 [registry.ts] ← 本文件
 *   → 返回 ModelCatalogEntry[]
 *
 * =============================================================================
 * Runtime 链路（User Scope）
 * =============================================================================
 * createModel(userId, modelRef)
 *   → resolveCredential(userId, provider)        [api-key-store.ts]
 *   → createModel()                            [registry.ts] ← 本文件
 *   → 返回 AI SDK Model Instance
 *
 * =============================================================================
 * 架构参考
 * =============================================================================
 * - llm-gateway: credential resolver + transport per provider
 * - cc-switch: ApiFormat = anthropic | openai-chat | openai-responses
 */
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { getProxyFetch } from "./agnes/proxy";
import { normalizeBaseURL } from "@/lib/normalize-base-url";
import { resolveCredential } from "../credentials/api-key-store";
import { getUserProviderRecords, getSystemCredentials } from "../credentials/api-key-store";
import type { ModelCatalogEntry, ApiFormat } from "./types";
import { inferApiFormat } from "./types";
import { loadModelsDevCatalog, type ModelCatalogEntry as ModelsDevCatalogEntry } from "@/lib/model-catalog";

export type { ModelCatalogEntry, ApiFormat };

// ---------------------------------------------------------------------------
// Response normalization
// ---------------------------------------------------------------------------
/**
 * Agnes (Responses API) returns { prompt_tokens, completion_tokens }.
 * AI SDK schema expects { input_tokens, output_tokens }.
 * Normalize the response body so Zod parsing succeeds.
 */
async function normalizeResponse(res: Response): Promise<Response> {
  if (!res.ok || res.status === 204) return res;

  let body: string;
  try {
    body = await res.text();
  } catch {
    return res;
  }

  // Agnes / OpenAI Responses API format
  const normalized = body
    .replaceAll(/"prompt_tokens":(\d+)/g, '"input_tokens":$1')
    .replaceAll(/"completion_tokens":(\d+)/g, '"output_tokens":$1');

  return new Response(normalized, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}

/** Wraps a fetch fn to normalize Responses API → Chat Completions API format */
function withResponseNormalization(
  fetchFn: typeof globalThis.fetch
): typeof fetchFn {
  return async (url, init) => {
    const urlStr =
      typeof url === "string"
        ? url
        : url instanceof URL
          ? url.href
          : String(url);
    // Debug: log Agnes request body for /chat/completions
    if (init?.body && typeof init.body === "string" && urlStr.includes("/chat/completions")) {
      try {
        const parsed = JSON.parse(init.body);
        const summary = {
          model: parsed.model,
          messagesCount: Array.isArray(parsed.messages) ? parsed.messages.length : 0,
          messages: Array.isArray(parsed.messages)
            ? parsed.messages.map((m: unknown, i: number) => {
                const message = m as { role?: unknown; content?: unknown };
                return {
                  i,
                  role: message.role,
                  contentType: Array.isArray(message.content)
                    ? message.content.map((p) => (p as { type?: unknown }).type ?? "unknown").join(",")
                    : typeof message.content,
                };
              })
            : [],
        };
        console.log("[DEBUG:fetch] Agnes /chat/completions request:", JSON.stringify(summary));
      } catch {}
    }
    const res = await fetchFn(url, init);
    return normalizeResponse(res);
  };
}

// ---------------------------------------------------------------------------
// Hardcoded providers — models defined in code, skip dynamic discovery
// ---------------------------------------------------------------------------
const HARDCODED_PROVIDERS = ["agnes"] as const;
type HardcodedProvider = (typeof HARDCODED_PROVIDERS)[number];

function isHardcodedProvider(p: string): p is HardcodedProvider {
  return (HARDCODED_PROVIDERS as unknown as string[]).includes(p);
}

// ---------------------------------------------------------------------------
// Agnes uses openai-chat (NOT openai-responses):
// The /responses endpoint rejects role='user', while /chat/completions supports
// role='user' and multimodal image parts — exactly what the vision feature needs.
// ---------------------------------------------------------------------------
const AGNES_MODELS: ModelCatalogEntry[] = [
  // Chat models
  {
    id: "agnes:agnes-2.5-flash",
    modelName: "agnes-2.5-flash",
    displayName: "Agnes 2.5 Flash",
    modelRef: "agnes:agnes-2.5-flash",
    capabilities: ["fast"],
    enabled: true,
    provider: "agnes",
    apiFormat: "openai-chat",
    ownerType: "SYSTEM",
  },
  {
    id: "agnes:agnes-2.0-flash",
    modelName: "agnes-2.0-flash",
    displayName: "Agnes 2.0 Flash",
    modelRef: "agnes:agnes-2.0-flash",
    capabilities: ["fast"],
    enabled: true,
    provider: "agnes",
    apiFormat: "openai-chat",
    ownerType: "SYSTEM",
  },
  // Image models
  {
    id: "agnes:agnes-image-2.1-flash",
    modelName: "agnes-image-2.1-flash",
    displayName: "Agnes Image 2.1 Flash",
    modelRef: "agnes:agnes-image-2.1-flash",
    capabilities: ["image"],
    enabled: true,
    provider: "agnes",
    apiFormat: "openai-chat",
    ownerType: "SYSTEM",
  },
  {
    id: "agnes:agnes-image-2.0-flash",
    modelName: "agnes-image-2.0-flash",
    displayName: "Agnes Image 2.0 Flash",
    modelRef: "agnes:agnes-image-2.0-flash",
    capabilities: ["image"],
    enabled: true,
    provider: "agnes",
    apiFormat: "openai-chat",
    ownerType: "SYSTEM",
  },
  // Video models
  {
    id: "agnes:agnes-video-v2.0",
    modelName: "agnes-video-v2.0",
    displayName: "Agnes Video 2.0",
    modelRef: "agnes:agnes-video-v2.0",
    capabilities: ["video"],
    enabled: true,
    provider: "agnes",
    apiFormat: "openai-chat",
    ownerType: "SYSTEM",
  },
];

// ---------------------------------------------------------------------------
// Dynamic model discovery — fetches /v1/models from the provider's API
// ---------------------------------------------------------------------------
interface OpenAIModelsResponse {
  object?: string;
  data?: Array<{ id: string; created?: number; [key: string]: unknown }>;
}

/**
 * Fetch available models from a provider's /v1/models endpoint.
 * Returns normalized ModelCatalogEntry[] with provider and apiFormat populated.
 *
 * @param transport - "proxy" uses the Agnes proxy fetch, "direct" uses globalThis.fetch
 */
export async function discoverModelsFromAPI(options: {
  provider: string;
  baseURL: string;
  apiKey: string;
  transport?: "proxy" | "direct";
  ownerType?: "SYSTEM" | "USER";
}): Promise<ModelCatalogEntry[]> {
  const { provider, baseURL, apiKey, transport = "direct", ownerType = "USER" } = options;

  const endpoint = normalizeBaseURL(baseURL);
  console.log(`[discoverModelsFromAPI] provider=${provider} baseURL=${baseURL} → endpoint=${endpoint} transport=${transport}`);

  const fetchFn =
    transport === "proxy"
      ? getProxyFetch() ?? globalThis.fetch
      : globalThis.fetch;

  let res: Response;
  try {
    res = await fetchFn(`${endpoint}/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });
  } catch (err) {
    throw new Error(`[${provider}] 网络连接失败: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      msg = body?.error?.message || body?.error || msg;
    } catch {}
    throw new Error(`[${provider}] 获取模型列表失败: ${msg}`);
  }

  let data: OpenAIModelsResponse;
  try {
    data = await res.json();
  } catch {
    throw new Error(`[${provider}] 返回数据不是有效 JSON`);
  }

  const models = data?.data ?? [];
  if (models.length === 0) {
    return [];
  }

  const apiFormat = inferApiFormat(baseURL);

  return models.map((m) => ({
    id: `${provider}:${m.id}`,
    modelName: m.id,
    displayName: m.id,
    modelRef: `${provider}:${m.id}`,
    capabilities: inferCapabilities(m.id),
    enabled: true,
    provider,
    apiFormat,
    ownerType,
  }));
}

import { inferCapabilities } from "@/features/ai/llm/capabilities";

// ---------------------------------------------------------------------------
// Catalog metadata enrichment（models.dev）
// Stage 6：为 /api/ai/models 追加可选元数据 contextWindow?/reasoning?，向后兼容。
// 目录不可用时静默降级，不阻塞模型可用性。
// ---------------------------------------------------------------------------

function findCatalogEntry(
  catalog: readonly ModelsDevCatalogEntry[],
  provider: string,
  modelName: string,
): ModelsDevCatalogEntry | undefined {
  const normalizedProvider = provider.toLowerCase();
  const normalizedModel = modelName.toLowerCase();
  return catalog.find((entry) =>
    entry.providerId.toLowerCase() === normalizedProvider && entry.id.toLowerCase() === normalizedModel,
  ) ?? catalog.find((entry) => entry.id.toLowerCase() === normalizedModel);
}

async function enrichWithCatalogMetadata(models: ModelCatalogEntry[]): Promise<ModelCatalogEntry[]> {
  if (models.length === 0) return models;
  let catalog: ModelsDevCatalogEntry[];
  try {
    catalog = await loadModelsDevCatalog();
  } catch (error) {
    console.warn("[registry] models.dev catalog unavailable, skipping metadata enrichment:", error instanceof Error ? error.message : String(error));
    return models;
  }

  return models.map((model) => {
    if (model.contextWindow !== undefined && model.reasoning !== undefined) return model;
    const match = findCatalogEntry(catalog, model.provider ?? "", model.modelName);
    if (!match) return model;
    return {
      ...model,
      contextWindow: model.contextWindow ?? match.contextWindow,
      reasoning: model.reasoning ?? match.reasoning,
      maxTokens: model.maxTokens ?? match.maxTokens,
    };
  });
}

// ---------------------------------------------------------------------------
// Get all enabled models for a user (SYSTEM + USER providers)
// ---------------------------------------------------------------------------
export async function getEnabledModels(userId?: string): Promise<ModelCatalogEntry[]> {
  const enabledModels: ModelCatalogEntry[] = [];
  const systemProviderSet = new Set<string>();

  // 1. SYSTEM providers — ROOT-configured default providers (discovered dynamically)
  const systemCreds = await getSystemCredentials();

  // 1a. Parallel HTTP discovery for all SYSTEM providers (hardcoded providers excluded)
  const systemDiscoveryPromises = systemCreds
    .filter((cred) => !isHardcodedProvider(cred.provider))
    .map(async (cred) => {
      systemProviderSet.add(cred.provider);
      try {
        const models = await discoverModelsFromAPI({
          provider: cred.provider,
          baseURL: cred.baseURL,
          apiKey: cred.apiKey,
          transport: cred.transport,
          ownerType: "SYSTEM",
        });
        console.log(`[getEnabledModels] SYSTEM provider "${cred.provider}": discovered ${models.length} models`, models.map((m) => m.modelName));
        return { kind: "ok" as const, models };
      } catch (err) {
        console.warn(`[registry] SYSTEM provider "${cred.provider}" model discovery failed:`, err instanceof Error ? err.message : String(err));
        return { kind: "err" as const, provider: cred.provider, error: err };
      }
    });

  // 2. Agnes hardcoded models (always available as fallback)
  for (const model of AGNES_MODELS) {
    if (model.enabled) {
      enabledModels.push(model);
    }
  }

  // 3. User providers — dynamically discover models from their API
  let userProviders: Awaited<ReturnType<typeof getUserProviderRecords>> = [];
  if (userId) {
    userProviders = await getUserProviderRecords(userId);
  }

  // 3a. Resolve credentials and check deduplication in parallel
  const userCredResults = await Promise.all(
    userProviders
      .filter((record) => !isHardcodedProvider(record.provider))
      .map(async (record) => {
        const userCred = await resolveCredential(userId!, record.provider);
        if (!userCred) return null;
        const sysCred = systemCreds.find((c) => c.provider === record.provider);
        return { record, userCred, sysCred };
      })
  );

  // 3b. Parallel HTTP discovery for all USER providers (deduplicated against SYSTEM)
  const userDiscoveryPromises = userCredResults
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .map(async ({ record, userCred, sysCred }) => {
      if (sysCred && sysCred.apiKey === userCred.apiKey) {
        console.log(`[getEnabledModels] USER provider "${record.provider}" skipped (same key as SYSTEM)`);
        return null;
      }
      if (sysCred) {
        console.log(`[getEnabledModels] USER provider "${record.provider}" has different key — using USER version`);
      }
      try {
        const models = await discoverModelsFromAPI({
          provider: record.provider,
          baseURL: userCred.baseURL,
          apiKey: userCred.apiKey,
          transport: userCred.transport,
        });
        console.log(`[getEnabledModels] USER provider "${record.provider}": discovered ${models.length} models`, models.map((m) => m.modelName));
        return models;
      } catch (err) {
        console.warn(`[registry] USER provider "${record.provider}" model discovery failed:`, err instanceof Error ? err.message : String(err));
        return null;
      }
    });

  // Resolve all discovery promises in parallel
  const allDiscoveryResults = await Promise.all([
    ...systemDiscoveryPromises,
    ...userDiscoveryPromises,
  ]);

  // Collect successful results
  for (const result of allDiscoveryResults) {
    if (Array.isArray(result)) {
      enabledModels.push(...result);
    } else if (result?.kind === "ok") {
      enabledModels.push(...result.models);
    }
  }

  return enrichWithCatalogMetadata(enabledModels);
}

// ---------------------------------------------------------------------------
// Create a unified model instance (handles all providers: SYSTEM + USER)
// ---------------------------------------------------------------------------
export async function createModel(options: {
  userId: string;
  modelRef: string; // format: "providerId:modelName"
}): Promise<ReturnType<typeof createOpenAI> extends (name: string) => infer R ? R : never> {
  const { userId, modelRef } = options;
  const [providerId, modelName] = modelRef.split(":");
  if (!providerId || !modelName) {
    throw new Error(`Invalid modelRef: "${modelRef}" (expected "providerId:modelName")`);
  }

  const cred = await resolveCredential(userId, providerId);
  if (!cred) {
    throw new Error(`No credential found for provider "${providerId}". Please configure your API key.`);
  }

  console.log(
    `[createModel] provider=${providerId} model=${modelName} baseURL=${cred.baseURL} ` +
    `transport=${cred.transport} apiFormat=${cred.apiFormat} ownerType=${cred.ownerType}`
  );

  // Select fetch based on transport setting.
  // The fetch wrapper also normalizes Agnes Responses API responses
  // (`prompt_tokens`/`completion_tokens`) to AI SDK's expected
  // (`input_tokens`/`output_tokens`) shape.
  const rawFetch =
    cred.transport === "proxy"
      ? getProxyFetch() ?? globalThis.fetch
      : globalThis.fetch;

  // Always normalize Responses API → Chat Completions format
  const fetchFn = withResponseNormalization(rawFetch);

  if (providerId === "deepseek") {
    const deepseek = createDeepSeek({
      apiKey: cred.apiKey,
      baseURL: cred.baseURL,
      fetch: fetchFn,
    });
    return deepseek(modelName) as unknown as ReturnType<typeof createOpenAI> extends (name: string) => infer R ? R : never;
  }

  if (cred.apiFormat === "anthropic") {
    const anthropic = createAnthropic({
      apiKey: cred.apiKey,
      baseURL: cred.baseURL,
      fetch: fetchFn,
    });
    return anthropic(modelName) as unknown as ReturnType<typeof createOpenAI> extends (name: string) => infer R ? R : never;
  }

  // openai-chat and openai-responses both use @ai-sdk/openai.
  // IMPORTANT: `openai(modelName)` defaults to the **Responses API** (`/responses`),
  // which uses `developer` role and a different schema than Chat Completions.
  // Agnes uses `/chat/completions`, so we must explicitly call `openai.chat(...)`.
  const openai = createOpenAI({
    apiKey: cred.apiKey,
    baseURL: cred.baseURL,
    fetch: fetchFn,
  });
  return openai.chat(modelName) as ReturnType<typeof createOpenAI> extends (name: string) => infer R ? R : never;
}
