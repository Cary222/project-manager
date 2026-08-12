"use client";

import useSWR from "swr";
import type { AiModel, AiModelCategory } from "./types";
import type { ModelCatalogEntry } from "@/features/ai/llm/providers/registry";

function inferCategory(capabilities: string[]): AiModelCategory {
  if (capabilities.includes("image")) return "image";
  if (capabilities.includes("video")) return "video";
  if (capabilities.includes("embedding")) return "embedding";
  if (capabilities.includes("transcription")) return "transcription";
  if (capabilities.includes("speech")) return "speech";
  if (capabilities.includes("completion")) return "completion";
  // tts/stt/realtime 等音频能力归为其他
  if (capabilities.includes("tts") || capabilities.includes("stt") || capabilities.includes("realtime"))
    return "other";
  return "chat";
}

function transformModels(entries: ModelCatalogEntry[]): AiModel[] {
  return entries.map((entry) => {
    const [provider] = entry.modelRef.split(":");
    return {
      value: entry.id,
      provider,
      model: entry.displayName,
      category: inferCategory(entry.capabilities),
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
      dedupingInterval: 2_000,
    }
  );

  return {
    models: transformModels(data?.data ?? []),
    loading: isLoading,
    error: error ? (error instanceof Error ? error.message : "Failed to load models") : null,
    reload: () => mutate(),
  };
}
