/**
 * Shared Model Settings — 类型定义（Stage 6）
 *
 * 从 features/ai/ui/ai-workspace/ModelsConfig.tsx 提取，供
 * PiWorkspaceAdapter 与 ProjectHubAdapter 两套 Adapter 共用。
 * 共享 UI 只接收 props / adapter，不直接依赖 Prisma / models.json / Pi Runtime / Route Handler。
 */

// models.dev catalog 推荐结果的最小形状（与 lib/model-catalog 的 ModelCatalogRecommendation 兼容）
import type { ModelCatalogPreset, ModelCatalogPriceRecommendation, ModelCatalogMatchMethod } from "@/lib/model-catalog";

export interface ModelEntry {
  id: string;
  name?: string;
  api?: string;
  reasoning?: boolean;
  thinkingLevelMap?: Record<string, string | null>;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; tiers?: unknown };
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
}

export interface ProviderEntry {
  baseUrl?: string;
  api?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
  models?: ModelEntry[];
  modelOverrides?: Record<string, unknown>;
  /** Internal marker added by /api/ai/models/registry to track provider source. */
  __source?: "site" | "local";
}

export interface ModelsJson {
  providers?: Record<string, ProviderEntry>;
}

export interface DiscoveredModel {
  id: string;
  name?: string;
}

export type ModelTestState =
  | { phase: "idle" }
  | { phase: "testing" }
  | { phase: "success"; latencyMs?: number; status?: number; responseText?: string }
  | { phase: "error"; message: string; latencyMs?: number; status?: number };

export type ModelDiscoveryState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "success"; models: DiscoveredModel[]; endpoint: string }
  | { phase: "error"; message: string };

export type ModelCatalogState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "success"; recommendation: ModelCatalogRecommendation; appliedCount: number }
  | { phase: "error"; message: string };

export type Selection =
  | { type: "provider"; name: string }
  | { type: "model"; providerName: string; index: number }
  | { type: "oauth"; providerId: string }
  | { type: "apikey"; providerId: string };

export interface OAuthProvider {
  id: string;
  name: string;
  usesCallbackServer: boolean;
  loggedIn: boolean;
  /** Provider also accepts an API key, so it appears in both picker sections. */
  supportsApiKey?: boolean;
}

export interface ApiKeyProvider {
  id: string;
  displayName: string;
  configured: boolean;
  source?: string;
  modelCount: number;
  /** Provider also supports OAuth, so it appears in both picker sections. */
  supportsOAuth?: boolean;
}

// models.dev catalog 推荐结果的最小形状（与 lib/model-catalog 的 ModelCatalogRecommendation 兼容）

export interface ModelCatalogRecommendation {
  exactMatches: number;
  metadataMethod: ModelCatalogMatchMethod;
  matchedProviderId?: string;
  matchedProviderName?: string;
  preset: ModelCatalogPreset;
  price: ModelCatalogPriceRecommendation;
}

export const API_OPTIONS = ["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"] as const;
