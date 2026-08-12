/**
 * 共享的模型标签配置（Provider / Category / Tier 映射）
 * 所有 AI 模型选择器 UI 组件共享此配置
 */

/* ------------------------------------------------------------------ */
/*  Provider display names                                              */
/* ------------------------------------------------------------------ */
export const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  agnes: "Agnes",
  deepseek: "DeepSeek",
  openai: "OpenAI",
  anthropic: "Anthropic",
  qwen: "Qwen",
};

export function getProviderDisplayName(provider: string): string {
  return PROVIDER_DISPLAY_NAMES[provider] ?? provider;
}

/* ------------------------------------------------------------------ */
/*  Category display names                                              */
/* ------------------------------------------------------------------ */
export const CATEGORY_CONFIG: Record<string, { label: string; icon: string; order: number }> = {
  chat: { label: "对话", icon: "💬", order: 0 },
  image: { label: "图像", icon: "🖼", order: 1 },
  video: { label: "视频", icon: "🎬", order: 2 },
  other: { label: "其他", icon: "📦", order: 3 },
  embedding: { label: "Embedding", icon: "📊", order: 4 },
  transcription: { label: "语音转写", icon: "🎙", order: 5 },
  speech: { label: "语音合成", icon: "🗣", order: 6 },
  completion: { label: "补全", icon: "✏️", order: 7 },
};

export function getCategoryDisplayName(category: string): string {
  return CATEGORY_CONFIG[category]?.label ?? category;
}

export function getCategoryIcon(category: string): string {
  return CATEGORY_CONFIG[category]?.icon ?? "📦";
}

/* ------------------------------------------------------------------ */
/*  Tier display names (for chat models)                               */
/* ------------------------------------------------------------------ */
export const TIER_CONFIG: Record<string, { label: string; icon: string; order: number }> = {
  reasoning: { label: "推理", icon: "🧠", order: 0 },
  strong: { label: "旗舰", icon: "💪", order: 1 },
  fast: { label: "快速", icon: "⚡", order: 2 },
  balanced: { label: "均衡", icon: "⚖️", order: 3 },
  standard: { label: "标准", icon: "💬", order: 4 },
};

export function getTierDisplayName(tier: string): string {
  return TIER_CONFIG[tier]?.label ?? tier;
}

export function getTierIcon(tier: string): string {
  return TIER_CONFIG[tier]?.icon ?? "📦";
}

export function getTierOrder(tier: string): number {
  return TIER_CONFIG[tier]?.order ?? 99;
}
