/**
 * Shared ModelRuntimeConfig — User Scope 统一模型运行时配置（Stage 6）
 *
 * =============================================================================
 * 职责边界
 * =============================================================================
 * ✅ 负责：
 *   - ModelRuntimeConfig 统一类型（Chat / WorkAgent 共用；Stage 7 评估 PiSubAgent）
 *   - ReasoningLevel 统一内部语义（off|minimal|low|medium|high|xhigh）
 *   - availableReasoningLevels：按 capability / provider adapter / catalog 元数据动态推导
 *   - resolveModelRuntimeConfig：modelRef → User Scope Model → Catalog → Preference override
 *   - mergeRuntimeConfig：字段级合并（User override > Catalog metadata > Provider defaults）
 *
 * ❌ 不负责：
 *   - 模型选择（由 model-routing.ts 的 selectModel 负责，Selection 层）
 *   - 凭证 / transport 路由策略（保留在 CredentialRecord / createModel 凭证链路）
 *   - Workspace Scope（models.json / model-scope.ts，PiSubAgent 继续使用）
 *
 * 不含 transport：transport 属于 Runtime Routing Policy，现有语义在
 * api-key-store 的 CredentialRecord，createModel 已从凭证链路消费，不提升到模型配置层。
 */
import type {
 ApiFormat,
 ModelCapability,
 ModelCatalogEntry,
} from "./providers/types";
import {
 availableReasoningLevels,
 isReasoningLevel,
 type ReasoningLevel,
} from "./model-reasoning";
import { loadUserModelsWithCache } from "@/lib/user-models-cache";
import { getEnabledModels } from "./providers/registry";
import { getModelPreference } from "./preferences/user-model-preferences";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export {
 availableReasoningLevels,
 isReasoningLevel,
 isReasoningModel,
 REASONING_LEVELS,
 type ReasoningLevel,
} from "./model-reasoning";

export interface ModelRuntimeConfig {
 provider: string;
 modelId: string;
 /** "provider:modelId" */
 modelRef: string;
 apiFormat: ApiFormat;
 /** 仅当模型支持 reasoning 时存在；不支持的模型不携带该字段（UI 不渲染 Thinking Selector）。 */
 reasoning?: {
  enabled: boolean;
  level?: ReasoningLevel;
 };
 temperature?: number;
 maxTokens?: number;
 capabilities: ModelCapability[];
 contextWindow?: number;
}

/** 参与字段级合并的用户偏好覆盖集（来自 UserAiModelPreference）。 */
export interface RuntimeConfigOverrides {
 thinkingLevel?: string | null;
 temperature?: number | null;
 maxTokens?: number | null;
}

// ---------------------------------------------------------------------------
// Field-level merge
// ---------------------------------------------------------------------------

/**
 * 字段级合并：User override > Catalog metadata > Provider defaults。
 * 用户 temperature 只覆盖 temperature，不影响其他字段。
 */
export function mergeRuntimeConfig(
 entry: ModelCatalogEntry,
 overrides?: RuntimeConfigOverrides | null,
): ModelRuntimeConfig {
 const levels = availableReasoningLevels(entry);
 const supported = levels.length > 0;
 const requestedLevel = overrides?.thinkingLevel;
 const level =
  supported &&
  requestedLevel &&
  isReasoningLevel(requestedLevel) &&
  levels.includes(requestedLevel)
   ? requestedLevel
   : undefined;

 const config: ModelRuntimeConfig = {
  provider: entry.provider ?? "",
  modelId: entry.modelName,
  modelRef: entry.modelRef,
  apiFormat: entry.apiFormat ?? "openai-chat",
  capabilities: entry.capabilities,
  maxTokens: overrides?.maxTokens ?? entry.maxTokens,
 };

 if (supported) {
  config.reasoning = {
   enabled: level !== "off",
   ...(level ? { level } : {}),
  };
 }
 if (overrides?.temperature != null) config.temperature = overrides.temperature;
 if (entry.contextWindow !== undefined)
  config.contextWindow = entry.contextWindow;

 return config;
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * 统一 Runtime Config 解析入口（User Scope，服务端）。
 *
 * modelRef → User Scope Model（与 /api/ai/models 同源缓存链）
 *          → Catalog / Capability 元数据
 *          → UserAiModelPreference override（字段级）
 *          → Unified ModelRuntimeConfig
 *
 * 模型不在 User Scope 时抛错，调用方应捕获并降级为默认模型。
 */
export async function resolveModelRuntimeConfig(
 userId: string | undefined,
 modelRef: string,
): Promise<ModelRuntimeConfig> {
 const models = await loadUserModelsWithCache(userId ?? "anonymous", () =>
  getEnabledModels(userId),
 );
 const entry = models.find((model) => model.modelRef === modelRef);
 if (!entry) {
  throw new Error(`Model not found in user scope: "${modelRef}"`);
 }

 const colonIndex = modelRef.indexOf(":");
 const provider = colonIndex >= 0 ? modelRef.slice(0, colonIndex) : "";
 const modelId = colonIndex >= 0 ? modelRef.slice(colonIndex + 1) : modelRef;

 const preference = userId
  ? await getModelPreference(userId, provider, modelId)
  : null;
 return mergeRuntimeConfig(entry, preference);
}

// ---------------------------------------------------------------------------
// Reasoning → provider-specific 请求参数注入（Stage 7）
// ---------------------------------------------------------------------------

/** Anthropic extended thinking 的 budgetTokens 映射。 */
export const ANTHROPIC_THINKING_BUDGETS: Partial<
 Record<ReasoningLevel, number>
> = {
 minimal: 1024,
 low: 2048,
 medium: 8192,
 high: 16384,
 xhigh: 32768,
};

/** OpenAI reasoningEffort 映射（minimal/low/medium/high；xhigh 归并到 high）。 */
export function reasoningLevelToOpenAiEffort(
 level: ReasoningLevel,
): "minimal" | "low" | "medium" | "high" {
 if (level === "minimal") return "minimal";
 if (level === "low") return "low";
 if (level === "medium") return "medium";
 return "high";
}

/** provider-specific 选项的结构化类型（与 AI SDK providerOptions 形状兼容，调用点断言）。 */
export type ReasoningProviderOptions = Record<string, Record<string, unknown>>;

/**
 * 把统一的 reasoning.level 转成 provider-specific 的 AI SDK providerOptions。
 *
 * - 未启用 / off / 未设置 level → undefined（行为与接入前一致）
 * - anthropic（provider 或 apiFormat）→ thinking budgetTokens
 * - openai → reasoningEffort
 * - deepseek（provider 或模型名）→ thinking.type（enabled）；
 *   reasoningEffort 暂不注入（DeepSeek 官方 API 无此参数，避免无效字段）
 * - 其他 provider 暂不注入（避免向不支持的端点传无效参数）：
 *   如 qwen/dashscope 的 enable_thinking 要求 stream 模式，非流式 generateText
 *   下注入会被拒绝，待流式链路就绪后扩展。
 */
export function buildReasoningProviderOptions(
 config: Pick<
  ModelRuntimeConfig,
  "provider" | "modelId" | "apiFormat" | "reasoning"
 >,
): ReasoningProviderOptions | undefined {
 const reasoning = config.reasoning;
 if (
  !reasoning ||
  !reasoning.enabled ||
  !reasoning.level ||
  reasoning.level === "off"
 ) {
  return undefined;
 }

 const provider = config.provider.toLowerCase();

 if (provider === "anthropic" || config.apiFormat === "anthropic") {
  const budgetTokens =
   ANTHROPIC_THINKING_BUDGETS[reasoning.level] ??
   ANTHROPIC_THINKING_BUDGETS.medium!;
  return {
   anthropic: {
    thinking: { type: "enabled", budgetTokens },
   },
  };
 }

 if (provider === "openai") {
  return {
   openai: {
    reasoningEffort: reasoningLevelToOpenAiEffort(reasoning.level),
   },
  };
 }

 // DeepSeek：thinking.type 开关（deepseek-chat 默认关闭、deepseek-reasoner 默认开启，
 // 显式 enabled 保证用户设置生效）；level 强度由模型自身决定，不传无效字段。
 if (
  provider === "deepseek" ||
  config.modelId.toLowerCase().includes("deepseek")
 ) {
  return {
   deepseek: {
    thinking: { type: "enabled" },
   },
  };
 }

 return undefined;
}
