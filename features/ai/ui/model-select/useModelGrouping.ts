"use client";

import { useMemo } from "react";
import type { AiModel } from "./types";
import {
  getCategoryDisplayName,
  getCategoryIcon,
  getProviderDisplayName,
  getTierDisplayName,
  getTierIcon,
  getTierOrder,
  CATEGORY_CONFIG,
} from "./model-labels";

/**
 * Chat models grouping key
 */
export type ModelGroupKey = {
  category: string;
  groupKey: string;
};

/**
 * Grouped model structure
 */
export interface ModelGroup {
  category: string;
  categoryLabel: string;
  categoryIcon: string;
  categoryOrder: number;
  groups: Array<{
    key: string;
    label: string;
    icon: string;
    models: AiModel[];
  }>;
}

/**
 * Hook that groups models by category, then by tier (for chat) or provider (for others)
 */
export function useModelGrouping(models: AiModel[]) {
  const groupedModels = useMemo((): ModelGroup[] => {
    // First level: group by category
    const byCategory = models.reduce(
      (acc, model) => {
        const cat = model.category;
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(model);
        return acc;
      },
      {} as Record<string, AiModel[]>
    );

    const result: ModelGroup[] = [];

    for (const [category, categoryModels] of Object.entries(byCategory)) {
      const groups: ModelGroup["groups"] = [];

      if (category === "chat") {
        // Chat models: group by tier
        const byTier = categoryModels.reduce(
          (acc, model) => {
            const tier = model.tier ?? "standard";
            if (!acc[tier]) acc[tier] = [];
            acc[tier].push(model);
            return acc;
          },
          {} as Record<string, AiModel[]>
        );

        // Sort tiers by order
        const sortedTiers = Object.keys(byTier).sort(
          (a, b) => getTierOrder(a) - getTierOrder(b)
        );

        for (const tier of sortedTiers) {
          const tierModels = byTier[tier];
          groups.push({
            key: tier,
            label: getTierDisplayName(tier),
            icon: getTierIcon(tier),
            models: tierModels,
          });
        }
      } else {
        // Non-chat models: group by provider
        const byProvider = categoryModels.reduce(
          (acc, model) => {
            if (!acc[model.provider]) acc[model.provider] = [];
            acc[model.provider].push(model);
            return acc;
          },
          {} as Record<string, AiModel[]>
        );

        for (const [provider, providerModels] of Object.entries(byProvider)) {
          groups.push({
            key: provider,
            label: getProviderDisplayName(provider),
            icon: getProviderIcon(providerModels[0]),
            models: providerModels,
          });
        }

        // Sort providers alphabetically
        groups.sort((a, b) => a.label.localeCompare(b.label));
      }

      result.push({
        category,
        categoryLabel: getCategoryDisplayName(category),
        categoryIcon: getCategoryIcon(category),
        categoryOrder: CATEGORY_CONFIG[category]?.order ?? 99,
        groups,
      });
    }

    // Sort categories by order
    result.sort((a, b) => a.categoryOrder - b.categoryOrder);

    return result;
  }, [models]);

  return { groupedModels };
}

/**
 * Get icon for a provider based on model capabilities
 */
function getProviderIcon(model: AiModel): string {
  if (model.category === "image") return "🖼";
  if (model.category === "video") return "🎬";
  if (model.category === "other") return "📦";
  if (model.category === "embedding") return "📊";
  if (model.category === "transcription") return "🎙";
  if (model.category === "speech") return "🗣";
  return "💬";
}
