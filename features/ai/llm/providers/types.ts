/** 任务类型：用于模型路由决策 */
export type TaskType = "chat" | "search" | "rag" | "complex" | "quick" | "image" | "video" | "audio";

/** 模型能力标签 */
export type ModelCapability =
  | "fast"
  | "standard"
  | "strong"
  | "vision"
  | "reasoning"
  | "image"
  | "video"
  | "audio";

/**
 * API 协议格式，决定使用哪个 SDK
 * - openai-chat: /v1/chat/completions（默认，DeepSeek/OpenRouter/vLLM/Ollama 等）
 * - openai-responses: /v1/responses（Agnes 专用）
 * - anthropic: /v1/messages（Claude 等）
 */
export type ApiFormat =
  | "openai-chat"
  | "openai-responses"
  | "anthropic";

/**
 * 根据 baseURL 推断 API 格式。
 * 用户可在 UI 中手动覆盖此推断结果。
 */
export function inferApiFormat(baseURL: string): ApiFormat {
  const lower = baseURL.toLowerCase();
  if (lower.includes("anthropic")) return "anthropic";
  if (lower.includes("apihub.agnes")) return "openai-responses";
  return "openai-chat";
}

/**
 * 模型在目录中的条目，包含用于 UI 显示的 provider 信息
 */
export interface ModelCatalogEntry {
  id: string;
  modelName: string;
  displayName: string;
  /** Full reference in "providerId:modelName" format */
  modelRef: string;
  capabilities: ModelCapability[];
  maxTokens?: number;
  enabled: boolean;
  /** 用于 UI 按 provider 分组 */
  provider?: string;
  /** 协议格式（可选，discovery 时填充） */
  apiFormat?: ApiFormat;
  /** SYSTEM = 平台默认模型（如 Agnes）；USER = 用户导入的模型 */
  ownerType?: "SYSTEM" | "USER";
  /** Stage 6 增量元数据（来自 models.dev catalog，查不到留空，向后兼容） */
  contextWindow?: number;
  /** 模型是否支持 reasoning（catalog 元数据；undefined = 未知） */
  reasoning?: boolean;
}

export interface UserRoutingConfig {
  userId?: string;
  defaults: Record<TaskType, string>;
  manualOverride?: string;
}
