/**
 * Provider Registry & Dynamic Model Discovery
 *
 * 架构参考:
 * - llm-gateway: credential resolver + transport per provider
 * - cc-switch: ApiFormat = anthropic | openai-chat | openai-responses
 *
 * 统一凭证链路：所有模型走 resolveCredential() → createModel()
 * SYSTEM provider（Agnes）存 DB，运行时由 ensureSystemProvider() 初始化
 */
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { proxyFetch, getProxyFetch } from "./agnes/proxy";
import { resolveCredential } from "../credentials/api-key-store";
import { getUserProviderRecords, getSystemCredentials } from "../credentials/api-key-store";
import type { ModelCatalogEntry, ApiFormat } from "./types";
import { inferApiFormat } from "./types";

export type { ModelCatalogEntry, ApiFormat };

// ---------------------------------------------------------------------------
// baseURL normalization — exported so api-key-store can use it
// ---------------------------------------------------------------------------
export function normalizeBaseURL(baseURL: string): string {
  const trimmed = baseURL.replace(/\/$/, "");
  if (!trimmed.includes("/v1")) {
    return `${trimmed}/v1`;
  }
  return trimmed;
}

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
            ? parsed.messages.map((m: any, i: number) => ({
                i,
                role: m.role,
                contentType: Array.isArray(m.content)
                  ? m.content.map((p: any) => p.type ?? "unknown").join(",")
                  : typeof m.content,
              }))
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
// Known provider defaults — used when user doesn't specify a custom baseURL
// ---------------------------------------------------------------------------
const KNOWN_DEFAULTS: Record<string, string> = {
  deepseek: "https://api.deepseek.com",
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  together: "https://api.together.xyz/v1",
};

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
// Get the effective baseURL for a user provider
// ---------------------------------------------------------------------------
export function getEffectiveBaseURL(
  provider: string,
  customBaseURL?: string | null
): string {
  const raw = customBaseURL?.trim() || KNOWN_DEFAULTS[provider] || `https://api.${provider}.com/v1`;
  return normalizeBaseURL(raw);
}

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

/**
 * Infer capabilities from model ID string.
 * This is a heuristic — the real capabilities come from provider docs.
 */
function inferCapabilities(modelId: string): ModelCatalogEntry["capabilities"] {
  const lower = modelId.toLowerCase();
  if (lower.includes("image") || lower.includes("wan2.7") || lower.includes("dall") || lower.includes("flux"))
    return ["image"];
  if (lower.includes("video") || lower.includes("wan-video"))
    return ["video"];
  if (lower.includes("audio") || lower.includes("tts") || lower.includes("realtime") || lower.includes("asr"))
    return ["audio"];
  if (lower.includes("vision") || lower.includes("gpt-4o") || lower.includes("claude-3-opus"))
    return ["vision"];
  if (lower.includes("reasoner") || lower.includes("o1") || lower.includes("deepseek-r1"))
    return ["reasoning"];
  if (lower.includes("flash") || lower.includes("fast") || lower.includes("mini") || lower.includes("gpt-4o-mini"))
    return ["fast"];
  if (lower.includes("gpt-4") || lower.includes("claude-3") || lower.includes("sonnet"))
    return ["strong"];
  return ["standard"];
}

// ---------------------------------------------------------------------------
// Get all enabled models for a user (SYSTEM + USER providers)
// ---------------------------------------------------------------------------
export async function getEnabledModels(userId?: string): Promise<ModelCatalogEntry[]> {
  const enabledModels: ModelCatalogEntry[] = [];
  const systemProviderSet = new Set<string>();

  // 1. SYSTEM providers — ROOT-configured default providers (discovered dynamically)
  const systemCreds = await getSystemCredentials();
  for (const cred of systemCreds) {
    systemProviderSet.add(cred.provider);
    // Hardcoded providers skip dynamic discovery — they have their own model lists
    if (isHardcodedProvider(cred.provider)) continue;
    try {
      const models = await discoverModelsFromAPI({
        provider: cred.provider,
        baseURL: cred.baseURL,
        apiKey: cred.apiKey,
        transport: cred.transport,
        ownerType: "SYSTEM",
      });
      console.log(`[getEnabledModels] SYSTEM provider "${cred.provider}": discovered ${models.length} models`, models.map((m) => m.modelName));
      enabledModels.push(...models);
    } catch (err) {
      console.warn(`[registry] SYSTEM provider "${cred.provider}" model discovery failed:`, err instanceof Error ? err.message : String(err));
    }
  }

  // 2. Agnes hardcoded models (always available as fallback)
  for (const model of AGNES_MODELS) {
    if (model.enabled) {
      enabledModels.push(model);
    }
  }

  // 3. User providers — dynamically discover models from their API
  if (userId) {
    const userProviders = await getUserProviderRecords(userId);
    for (const record of userProviders) {
      // Skip hardcoded providers (e.g. agnes)
      if (isHardcodedProvider(record.provider)) continue;

      const userCred = await resolveCredential(userId, record.provider);
      if (!userCred) continue;

      // If SYSTEM also covers this provider, compare API keys
      if (systemProviderSet.has(record.provider)) {
        const sysCred = systemCreds.find((c) => c.provider === record.provider);
        if (sysCred) {
          // Key identical → skip USER, use SYSTEM only
          if (sysCred.apiKey === userCred.apiKey) {
            console.log(`[getEnabledModels] USER provider "${record.provider}" skipped (same key as SYSTEM)`);
            continue;
          }
          // Key different → USER overrides, mark as USER
          console.log(`[getEnabledModels] USER provider "${record.provider}" has different key — using USER version`);
        }
      }

      try {
        const models = await discoverModelsFromAPI({
          provider: record.provider,
          baseURL: userCred.baseURL,
          apiKey: userCred.apiKey,
          transport: userCred.transport,
        });
        console.log(`[getEnabledModels] USER provider "${record.provider}": discovered ${models.length} models`, models.map((m) => m.modelName));
        enabledModels.push(...models);
      } catch (err) {
        console.warn(`[registry] USER provider "${record.provider}" model discovery failed:`, err instanceof Error ? err.message : String(err));
      }
    }
  }

  return enabledModels;
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
