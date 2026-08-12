/**
 * AI Model types — used by ModelSelectionContext and all UI components.
 * Mapped from the ProjectHub provider registry (features/ai/llm/providers/registry.ts)
 * to the shadcn-aisdk-model-select pattern.
 */

export type AiModelCategory = "chat" | "embedding" | "transcription" | "image" | "video" | "other" | "completion" | "speech";

export type AiModelTier = "reasoning" | "strong" | "balanced" | "fast" | "standard" | "embedding" | "other";

export type AiModel = {
  /** Unique identifier, e.g. "agnes:agnes-2.5-flash" */
  value: string;
  /** Provider id, e.g. "agnes" */
  provider: string;
  /** Model identifier, e.g. "Agnes 2.5 Flash" */
  model: string;
  category: AiModelCategory;
  context_window?: number;
  /** SYSTEM = 平台默认模型；USER = 用户导入 */
  ownerType?: "SYSTEM" | "USER";
  /** Model performance tier for UI grouping */
  tier?: AiModelTier;
};

export interface ModelGroup {
  provider: string;
  models: AiModel[];
}

export interface ModelSelectDropdownSettings {
  enabledProviders?: string[];
  enabledCategories?: AiModelCategory[];
  showApiKeys?: boolean;
}

export interface ModelSelectorConfig {
  enabledProviders?: string[];
  enabledCategories?: AiModelCategory[];
}

export interface ProviderApiKeys {
  [provider: string]: string;
}

export interface ProviderVisibilitySettings {
  [provider: string]: boolean;
}
