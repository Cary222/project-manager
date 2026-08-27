/**
 * Model Scope — Workspace Scope 的模型选择与过滤
 *
 * =============================================================================
 * 职责边界
 * =============================================================================
 * ✅ 负责：
 *   - 模型 scope 解析（resolveVisibleModels）
 *   - 模型 scope 验证（assertNoAmbiguousExactPatterns）
 *   - Thinking Level 管理（thinkingLevelPins）
 *   - 初始模型选择（selectInitialModelScope）
 *
 * ❌ 不负责：
 *   - 模型发现（由 registry.ts / model-discovery.ts 提供）
 *   - 模型价格元数据（由 model-catalog.ts 提供）
 *   - 凭证管理（由 api-key-store.ts 提供）
 *   - User Scope 的模型选择（由 registry.ts 提供）
 *
 * =============================================================================
 * Scope 边界
 * =============================================================================
 * 本文件属于 Workspace Scope，服务于 PiSubAgent 的模型配置：
 * - 基于 Pi 的 enabledModels 配置（类似 pi 命令行的 --models 参数）
 * - 支持 glob 模式匹配（如 "anthropic/*:high"）
 * - 支持 Thinking Level 绑定
 *
 * 与 User Scope 的区别：
 * - Workspace Scope（model-scope.ts）：基于 Pi enabledModels 配置，PiSubAgent 使用
 * - User Scope（registry.ts）：基于 UserApiKey 配置，Chat/WorkAgent 使用
 *
 * =============================================================================
 * enabledModels 语法
 * =============================================================================
 * Pi 的 enabledModels 使用与 pi 命令行 --models 参数相同的语法：
 *
 * 1. Glob 模式：
 *    - "anthropic/asterisk" — 所有 anthropic 模型（星号通配）
 *    - "asterisk/gpt-4o" — 所有 provider 的 gpt-4o
 *    - "anthropic/asterisk:high" — 所有 anthropic 模型，绑定 high thinking level
 *
 * 2. 精确匹配：
 *    - "anthropic/claude-3-5-sonnet" — 精确匹配
 *    - "claude-3-5-sonnet" — 精确匹配（跨 provider）
 *
 * 3. Thinking Level 绑定：
 *    - 格式：`<pattern>:<level>`
 *    - Level：`off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`
 *    - 示例："anthropic/*:high" — 绑定所有 anthropic 模型到 high level
 *
 * =============================================================================
 * 为什么复用 Pi 的 scope 解析
 * =============================================================================
 * resolveModelScopeWithDiagnostics 来自 @earendil-works/pi-coding-agent：
 * - Pi 已经实现了成熟的 scope 解析算法
 * - 与 pi 命令行保持一致
 * - 经过充分测试
 *
 * 本文件的作用是：
 * 1. 调用 Pi 的 scope 解析
 * 2. 提供 UI 需要的 thinkingLevelPins
 * 3. 提供诊断信息（warnings）
 *
 * =============================================================================
 * Thinking Level 绑定
 * =============================================================================
 * Thinking Level 是 Pi 的特性，允许：
 * - 为不同模型绑定不同的 thinking level
 * - 在会话中动态切换 thinking level
 * - UI 显示模型绑定的 thinking level
 *
 * ModelScopeResult.thinkingLevelPins：
 * - Key：`${provider}/${modelId}`
 * - Value：thinking level 名称
 * - 用途：UI 显示、Thinking Level 选择器
 *
 * =============================================================================
 * Discovery 链路
 * =============================================================================
 * /api/models
 *   → loadModelsWithCache(cwd)
 *   → loadModels(cwd)
 *   → getModelRuntime(cwd)                    [model-discovery.ts]
 *   → resolveVisibleModels(runtime, patterns)  [model-scope.ts] ← 本文件
 *     → resolveModelScopeWithDiagnostics()     [Pi SDK]
 *   → 返回 ModelScopeResult
 */

import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
  resolveModelScopeWithDiagnostics,
  type ModelRuntime,
  type ScopedModel,
} from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
const THINKING_LEVEL_SUFFIXES = new Set<ThinkingLevel>([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

/**
 * Model scoping shared by the UI selector and AgentSession startup.
 *
 * The `enabledModels` setting uses the same syntax as pi's `--models` flag:
 * globs matched with minimatch against `provider/modelId` or a bare `modelId`,
 * fuzzy matching for non-glob patterns, plus an optional `:thinkingLevel` suffix
 * (`anthropic/*:high`). Exact string comparison silently drops every model
 * behind a pattern like `my-gateway/*` (#307), so delegate to pi's own resolver
 * instead of reimplementing the matching rules here.
 */

export interface ModelScopeResult {
  /** Models the UI should offer, in resolver order (all available when unscoped). */
  visible: readonly Model<Api>[];
  /** SDK-native scope retained for AgentSession model cycling and extensions. */
  scopedModels: readonly ScopedModel[];
  /** `provider/modelId` → thinking level pinned with a `:level` pattern suffix. */
  thinkingLevelPins: Record<string, string>;
  /** Resolver diagnostics, e.g. a pattern that matched no model. */
  warnings: string[];
}

export interface InitialModelScopeOptions {
  requestedModel?: { provider: string; modelId: string };
  defaultModel?: { provider: string; modelId: string };
  thinkingLevel?: ThinkingLevel;
}

export interface InitialModelScopeResult {
  model?: Model<Api>;
  thinkingLevel?: ThinkingLevel;
  scopedModels: ScopedModel[];
}

function matchesModel(
  model: { provider: string; id: string },
  ref: { provider: string; modelId: string },
): boolean {
  return model.provider === ref.provider && model.id === ref.modelId;
}

function hasGlob(pattern: string): boolean {
  return pattern.includes("*") || pattern.includes("?") || pattern.includes("[");
}

function exactReferenceMatches(pattern: string, models: readonly Model<Api>[]): Model<Api>[] {
  const normalized = pattern.toLowerCase();
  const canonical = models.filter(
    (model) => `${model.provider}/${model.id}`.toLowerCase() === normalized,
  );
  if (canonical.length > 0) return canonical;
  return models.filter((model) => model.id.toLowerCase() === normalized);
}

function assertNoAmbiguousExactPatterns(
  patterns: readonly string[],
  models: readonly Model<Api>[],
): void {
  for (const pattern of patterns) {
    if (hasGlob(pattern)) continue;

    let matches = exactReferenceMatches(pattern, models);
    if (matches.length === 0) {
      const colonIndex = pattern.lastIndexOf(":");
      const suffix = colonIndex >= 0 ? pattern.slice(colonIndex + 1) : "";
      if (THINKING_LEVEL_SUFFIXES.has(suffix as ThinkingLevel)) {
        matches = exactReferenceMatches(pattern.slice(0, colonIndex), models);
      }
    }

    if (matches.length > 1) {
      const references = matches
        .map((model) => `${model.provider}/${model.id}`)
        .sort()
        .join(", ");
      throw new Error(
        `Ambiguous enabledModels entry "${pattern}" matches multiple models: ${references}. Use provider/modelId.`,
      );
    }
  }
}

/**
 * Resolve the visible model list for `patterns`.
 *
 * Falls back to every available model when no patterns are configured or when
 * the patterns resolve to nothing, so a stale or typo'd setting can never leave
 * the UI without any selectable model.
 */
export async function resolveVisibleModels(
  modelRuntime: ModelRuntime,
  patterns: string[] | undefined,
): Promise<ModelScopeResult> {
  const { resolveModelScopeWithDiagnostics } = await import("@earendil-works/pi-coding-agent");
  const cleaned = (patterns ?? []).map((pattern) => pattern.trim()).filter(Boolean);
  if (cleaned.length === 0) {
    return {
      visible: await modelRuntime.getAvailable(),
      scopedModels: [],
      thinkingLevelPins: {},
      warnings: [],
    };
  }

  const available = await modelRuntime.getAvailable();
  assertNoAmbiguousExactPatterns(cleaned, available);
  const snapshotRuntime = {
    getAvailable: async () => available,
  } as ModelRuntime;
  const { scopedModels, diagnostics } = await resolveModelScopeWithDiagnostics(cleaned, snapshotRuntime);
  const warnings = diagnostics.map((diagnostic) => diagnostic.message);
  if (scopedModels.length === 0) {
    return {
      visible: available,
      scopedModels: [],
      thinkingLevelPins: {},
      warnings,
    };
  }

  // `anthropic/*:high` pins a thinking level on every model the glob matched.
  // pi applies the pin of the model a new session starts with; report them all
  // so the client can look up whichever model it pre-selects.
  const thinkingLevelPins: Record<string, string> = {};
  for (const scoped of scopedModels) {
    if (scoped.thinkingLevel) {
      thinkingLevelPins[`${scoped.model.provider}/${scoped.model.id}`] = scoped.thinkingLevel;
    }
  }
  return {
    visible: scopedModels.map((scoped) => scoped.model),
    scopedModels,
    thinkingLevelPins,
    warnings,
  };
}

/**
 * Select the model and thinking level used to create a new AgentSession.
 *
 * This mirrors pi's startup rule: prefer an explicit selection, otherwise use
 * the saved default when it is in scope, then the first resolver-ordered model.
 * A scoped-model thinking pin is applied unless the caller supplied an explicit
 * thinking level.
 */
export function selectInitialModelScope(
  scope: ModelScopeResult,
  options: InitialModelScopeOptions = {},
): InitialModelScopeResult {
  const requestedRef = options.requestedModel;
  const defaultRef = options.defaultModel;
  const requested = requestedRef
    ? scope.visible.find((model) => matchesModel(model, requestedRef))
    : undefined;
  if (requestedRef && !requested) {
    throw new Error(
      `Model is not available in the enabled scope: ${requestedRef.provider}/${requestedRef.modelId}`,
    );
  }

  const requestedScoped = requested
    ? scope.scopedModels.find((scoped) => scoped.model === requested
      || matchesModel(scoped.model, { provider: requested.provider, modelId: requested.id }))
    : undefined;
  const defaultScoped = !requested && defaultRef
    ? scope.scopedModels.find((scoped) => matchesModel(scoped.model, defaultRef))
    : undefined;
  const fallbackScoped = !requested ? (defaultScoped ?? scope.scopedModels[0]) : undefined;
  const defaultVisible = !requested && !fallbackScoped && defaultRef
    ? scope.visible.find((model) => matchesModel(model, defaultRef))
    : undefined;
  const selectedModel = requested ?? fallbackScoped?.model ?? defaultVisible;
  const scopedSelection = requestedScoped ?? fallbackScoped;
  const thinkingLevel = options.thinkingLevel ?? scopedSelection?.thinkingLevel;

  return {
    ...(selectedModel ? { model: selectedModel } : {}),
    ...(thinkingLevel ? { thinkingLevel } : {}),
    scopedModels: [...scope.scopedModels],
  };
}
