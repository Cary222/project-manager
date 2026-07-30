"use client";

import { useMemo } from "react";
import type { AiModel } from "./types";

export function useModelSortAndFilter(
  models: AiModel[],
  selectedModelIds: Set<string>,
  searchTerm: string
) {
  const filteredAndGroupedModels = useMemo(() => {
    const groups: Record<string, Record<string, AiModel[]>> = {};
    const searchLower = searchTerm.toLowerCase().trim();

    models.forEach((model) => {
      if (searchLower) {
        const providerMatch = model.provider.toLowerCase().includes(searchLower);
        const modelMatch = model.model.toLowerCase().includes(searchLower);
        const categoryMatch = model.category
          .toLowerCase()
          .includes(searchLower);

        if (!providerMatch && !modelMatch && !categoryMatch) {
          return;
        }
      }

      if (!groups[model.provider]) {
        groups[model.provider] = {};
      }
      if (!groups[model.provider][model.category]) {
        groups[model.provider][model.category] = [];
      }
      groups[model.provider][model.category].push(model);
    });

    for (const provider in groups) {
      for (const category in groups[provider]) {
        groups[provider][category].sort((a, b) => {
          return a.model.localeCompare(b.model);
        });
      }
    }

    return groups;
  }, [models, searchTerm]);

  const sortedProviderEntries = useMemo(() => {
    const providers = Object.entries(filteredAndGroupedModels);

    providers.sort(([providerA, categoriesA], [providerB, categoriesB]) => {
      const modelsA = Object.values(categoriesA).flat();
      const modelsB = Object.values(categoriesB).flat();

      const hasSelectedA = modelsA.some((m) => selectedModelIds.has(m.value));
      const hasSelectedB = modelsB.some((m) => selectedModelIds.has(m.value));

      if (hasSelectedA !== hasSelectedB) {
        return hasSelectedA ? -1 : 1;
      }

      return providerA.localeCompare(providerB);
    });

    return providers;
  }, [filteredAndGroupedModels, selectedModelIds]);

  return { sortedProviderEntries, filteredAndGroupedModels };
}
