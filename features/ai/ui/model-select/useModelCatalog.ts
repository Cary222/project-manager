"use client";

import useSWR from "swr";
import type { AiModel } from "./types";
import type { ModelCatalogEntry } from "@/features/ai/llm/providers/registry";

function transformModels(entries: ModelCatalogEntry[]): AiModel[] {
  return entries.map((entry) => {
    const [provider] = entry.modelRef.split(":");
    return {
      value: entry.id,
      provider,
      model: entry.displayName,
      category: "chat",
      context_window: entry.maxTokens,
      ownerType: entry.ownerType,
    };
  });
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useModelCatalog() {
  const { data, error, isLoading, mutate } = useSWR<{ data: ModelCatalogEntry[] }>(
    "/api/ai/models",
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 60_000,
    }
  );

  return {
    models: transformModels(data?.data ?? []),
    loading: isLoading,
    error: error ? (error instanceof Error ? error.message : "Failed to load models") : null,
    reload: () => mutate(),
  };
}
