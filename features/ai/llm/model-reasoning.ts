import type { ModelCatalogEntry } from "./providers/types";

/** 统一 reasoning level 内部语义（不含 Pi Workspace 的 max；Workspace 侧语义独立）。 */
export type ReasoningLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export const REASONING_LEVELS: readonly ReasoningLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];

export function isReasoningLevel(value: unknown): value is ReasoningLevel {
  return typeof value === "string" && (REASONING_LEVELS as readonly string[]).includes(value);
}

/** 模型是否支持 reasoning：catalog 元数据显式 false → 不支持；capability / reasoning=true → 支持。 */
export function isReasoningModel(entry: Pick<ModelCatalogEntry, "capabilities" | "reasoning">): boolean {
  if (entry.reasoning === false) return false;
  if (entry.reasoning === true) return true;
  return entry.capabilities.includes("reasoning");
}

/**
 * 动态推导模型实际支持的 reasoning levels 子集。
 *
 * 不支持 reasoning → []（UI 不渲染 Thinking Selector）。
 * Provider-specific adapter 优先，其次通用推理模型默认集。
 * Pi 的 level map 仅作交互参考，不把 Pi 全集硬编码进 Shared Domain。
 */
export function availableReasoningLevels(
  entry: Pick<ModelCatalogEntry, "provider" | "modelName" | "capabilities" | "reasoning">,
): ReasoningLevel[] {
  if (!isReasoningModel(entry)) return [];

  const provider = (entry.provider ?? "").toLowerCase();
  const modelId = entry.modelName.toLowerCase();

  if (provider === "deepseek" || modelId.includes("deepseek-r")) {
    return ["off", "low", "high"];
  }
  if (provider === "anthropic" || modelId.includes("claude")) {
    return ["off", "low", "medium", "high"];
  }
  if (
    provider === "openai"
    || /^(o1|o3|o4)(-|$)/.test(modelId)
    || modelId.includes("gpt-5")
  ) {
    return ["off", "minimal", "low", "medium", "high"];
  }
  return ["off", "low", "medium", "high"];
}
