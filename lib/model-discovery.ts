/**
 * Model Discovery — Workspace Scope
 *
 * =============================================================================
 * 职责边界
 * =============================================================================
 * 本文件属于 Workspace Scope，服务于 /api/models（Pi Workspace 的模型配置）
 *
 * ✅ 负责：
 *   - Pi ModelRuntime 实例化（getModelRuntime）
 *   - 模型列表 URL 构建（buildModelsListUrl）— Shared Utility
 *   - Provider API 响应解析（parseDiscoveredModels）— Shared Utility
 *   - 模型元数据提取（DiscoveredModel 接口）
 *
 * ❌ 不负责：
 *   - User Scope 的模型发现（由 registry.ts 提供）
 *   - Credential 解析（由 model-discovery-auth.ts 提供）
 *   - 模型价格元数据（由 model-catalog.ts 提供）
 *   - 模型 scope 解析（由 model-scope.ts 提供）
 *
 * =============================================================================
 * Scope 边界
 * =============================================================================
 * 本文件属于 Workspace Scope：
 * - 数据来源：models.json（Pi Workspace 文件配置）
 * - 模型运行时：Pi ModelRuntime（@earendil-works/pi-coding-agent）
 * - 服务对象：PiSubAgent、/api/models
 *
 * User Scope vs Workspace Scope：
 * - User Scope（registry.ts）：用户个人配置的 Provider / 模型，服务 Chat / WorkAgent
 * - Workspace Scope（本文件）：Pi Runtime 的模型配置，服务 PiSubAgent
 *
 * Shared vs Isolated：
 * - ✅ Shared：buildModelsListUrl、parseDiscoveredModels（与 /api/models-config/discover 共享）
 * - ❌ Isolated：getModelRuntime（Workspace 专用）
 *
 * =============================================================================
 * 为什么 Pi SDK 在本文件属于合理复用
 * =============================================================================
 * Pi ModelRuntime（@earendil-works/pi-coding-agent）是 Pi 的核心模块：
 * - 负责解析 models.json
 * - 负责模型认证（getAuth）
 * - 负责模型列表管理（getAvailable）
 * - 负责模型 scope 解析（resolveModelScopeWithDiagnostics）
 *
 * 本文件复用 Pi SDK 的理由：
 * 1. Pi 是 ProjectHub AI Workspace 的核心运行时
 * 2. models.json 是 Pi 的标准配置格式
 * 3. Pi SDK 的模型管理能力经过充分验证
 * 4. 复用 Pi SDK 可以保持与 Pi 命令行的兼容性
 *
 * =============================================================================
 * Discovery 链路（Workspace Scope）
 * =============================================================================
 * /api/models
 *   → loadModelsWithCache(cwd)              [lib/models-cache.ts]
 *   → loadModels(cwd)                        [app/api/models/route.ts]
 *   → getModelRuntime(cwd)                   [lib/model-discovery.ts] ← 本文件
 *   → resolveVisibleModels(runtime)          [lib/model-scope.ts]
 *   → 返回 ModelsData
 *
 * =============================================================================
 * 相关文件
 * =============================================================================
 * - lib/model-discovery-auth.ts：Pi SDK 的 Auth Parsing（也是合理复用）
 * - lib/model-scope.ts：模型 scope 解析（调用 Pi SDK）
 * - lib/models-cache.ts：Workspace 模型缓存
 * - app/api/models/route.ts：/api/models 入口
 * - app/api/models-config/discover/route.ts：动态模型发现（使用本文件的 parseDiscoveredModels）
 */

import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { getModelsConfigPath } from "./models-config-store";

export interface DiscoveredModel {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function cleanNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return undefined;
}

function modelFromValue(value: unknown): DiscoveredModel | null {
  if (typeof value === "string") {
    const id = value.trim();
    return id ? { id } : null;
  }
  if (!isRecord(value)) return null;

  const rawId = cleanString(value.id) ?? cleanString(value.model) ?? cleanString(value.name);
  if (!rawId) return null;
  const id = rawId.startsWith("models/") ? rawId.slice("models/".length) : rawId;
  if (!id) return null;
  const name = cleanString(value.display_name)
    ?? cleanString(value.displayName)
    ?? (cleanString(value.id) || cleanString(value.model) ? cleanString(value.name) : undefined);

  const contextWindow = cleanNumber(value.context_length)
    ?? cleanNumber(value.context_window)
    ?? cleanNumber(value.inputTokenLimit)
    ?? cleanNumber(value.max_context_tokens)
    ?? cleanNumber(value.max_model_len)
    ?? cleanNumber(value.max_prompt_tokens)
    ?? cleanNumber(value.context_size)
    ?? (isRecord(value.pricing) ? cleanNumber(value.pricing.context_length) : undefined)
    ?? (isRecord(value.architecture) ? cleanNumber(value.architecture.context_length) : undefined);

  const maxTokens = cleanNumber(value.outputTokenLimit)
    ?? cleanNumber(value.max_tokens)
    ?? cleanNumber(value.max_output_tokens)
    ?? cleanNumber(value.max_completion_tokens);

  const reasoning = typeof value.reasoning === "boolean"
    ? value.reasoning
    : typeof value.supports_reasoning === "boolean"
      ? value.supports_reasoning
      : typeof value.thinking === "boolean"
        ? value.thinking
        : undefined;

  const model: DiscoveredModel = { id };
  if (name && name !== id) model.name = name;
  if (contextWindow !== undefined) model.contextWindow = contextWindow;
  if (maxTokens !== undefined) model.maxTokens = maxTokens;
  if (reasoning !== undefined) model.reasoning = reasoning;
  return model;
}

function listFromResponse(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  for (const key of ["data", "models", "results", "items"]) {
    const candidate = value[key];
    if (Array.isArray(candidate)) return candidate;
    if (isRecord(candidate)) return Object.values(candidate);
  }
  return [];
}

export function parseDiscoveredModels(value: unknown): DiscoveredModel[] {
  const seen = new Set<string>();
  const models: DiscoveredModel[] = [];
  for (const item of listFromResponse(value)) {
    const model = modelFromValue(item);
    if (!model || seen.has(model.id)) continue;
    seen.add(model.id);
    models.push(model);
  }
  return models.sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id, undefined, {
    numeric: true,
    sensitivity: "base",
  }));
}

export function buildModelsListUrl(baseUrl: string, api: string): URL {
  const url = new URL(baseUrl.trim());
  const trimmedPath = url.pathname.replace(/\/+$/, "");

  if (!/\/models$/i.test(trimmedPath)) {
    let path = trimmedPath;
    if (api === "anthropic-messages" && !/\/v\d+(?:beta)?$/i.test(path)) path += "/v1";
    if (api === "google-generative-ai" && !/\/v\d+(?:beta)?$/i.test(path)) path += "/v1beta";
    url.pathname = `${path}/models`.replace(/\/+/g, "/");
  }

  if (api === "anthropic-messages" && !url.searchParams.has("limit")) {
    url.searchParams.set("limit", "1000");
  }
  if (api === "google-generative-ai" && !url.searchParams.has("pageSize")) {
    url.searchParams.set("pageSize", "1000");
  }
  return url;
}

// Lazy-initialized singleton ModelRuntime so we don't re-read the config on every request.
type ModelRuntimeInstance = Awaited<ReturnType<(typeof ModelRuntime)["create"]>>;
let _modelRuntime: ModelRuntimeInstance | null = null;

export async function getModelRuntime(
  _cwd?: string,
): Promise<ModelRuntimeInstance> {
  if (_modelRuntime) return _modelRuntime;
  const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
  const modelsPath = await getModelsConfigPath();
  _modelRuntime = await ModelRuntime.create({ modelsPath });
  return _modelRuntime;
}

/**
 * 重置 ModelRuntime 单例，下次 getModelRuntime() 调用时重新从 models.json 加载。
 * 在 models.json 被修改后调用（配合 invalidateModelsCache()）。
 */
export function resetModelRuntime(): void {
  _modelRuntime = null;
}
