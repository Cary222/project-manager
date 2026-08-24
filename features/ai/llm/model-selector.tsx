"use client";

/**
 * ModelSelector（Stage 6）— 统一模型选择入口
 *
 * 实现已迁移到 UnifiedModelSelector（features/ai/ui/model-select/UnifiedModelSelector.tsx）：
 * 数据源 = /api/ai/models + /api/ai/model-preferences，
 * 支持 Search / Provider Filter / Capability Filter / Context Window /
 * Reasoning Badge / Favorite / Default / Enabled / Thinking Level。
 *
 * 本文件保留为 re-export，调用方（如 AiChatPanel）无需修改。
 */

export { UnifiedModelSelector as ModelSelector } from "@/features/ai/ui/model-select/UnifiedModelSelector";
export type { UnifiedModelSelectorProps as ModelSelectorProps } from "@/features/ai/ui/model-select/UnifiedModelSelector";
