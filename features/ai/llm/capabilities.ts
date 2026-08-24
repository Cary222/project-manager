import type { ModelCatalogEntry } from "@/features/ai/llm/providers/types";

/**
 * 推断模型能力（image / video / audio / vision / reasoning / fast / strong / standard）。
 *
 * 这是启发式推断，真实能力以 provider 文档为准。逻辑在 registry.ts 与
 * unified-model-registry.ts 之间复用，避免规则分化。
 */
export function inferCapabilities(modelId: string): ModelCatalogEntry["capabilities"] {
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
