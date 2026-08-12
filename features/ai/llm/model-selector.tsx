"use client";
import useSWR from "swr";
import { useState, useMemo, useRef, useEffect } from "react";
import type { ModelCatalogEntry, ModelCapability } from "./providers/types";
import type { AiTaskCategory, ChatToolMode } from "@/features/ai/types/modes";
import {
  getProviderDisplayName,
  getCategoryDisplayName,
  getTierDisplayName,
  getTierOrder,
  TIER_CONFIG,
} from "@/features/ai/ui/model-select/model-labels";
import { IconChevronDown, IconChevronRight } from "@/shared/ui/icons";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface ModelSelectorProps {
  value: string;
  onChange: (modelRef: string) => void;
  category?: AiTaskCategory;
  autoMode?: boolean;
  toolMode?: ChatToolMode;
}

/** Get the primary tier from capabilities for chat models */
function getTierFromCapabilities(capabilities: ModelCapability[]): string {
  if (capabilities.includes("reasoning")) return "reasoning";
  if (capabilities.includes("strong")) return "strong";
  if (capabilities.includes("fast")) return "fast";
  return "standard";
}

/** Infer category from capabilities */
function getCategoryFromCapabilities(capabilities: ModelCapability[]): string {
  if (capabilities.includes("image")) return "image";
  if (capabilities.includes("video")) return "video";
  return "chat";
}

/** Get the required capabilities for a category */
function getRequiredCapabilities(category: AiTaskCategory): ModelCapability[] | null {
  if (category === "image") return ["image"];
  if (category === "video") return ["video"];
  return null;
}

const DROPDOWN_HEIGHT = "max-h-60";

interface GroupedModels {
  category: string;
  categoryLabel: string;
  groups: Array<{
    key: string;
    label: string;
    icon: string;
    models: ModelCatalogEntry[];
  }>;
}

export function ModelSelector({ value, onChange, category = "chat", autoMode = false, toolMode }: ModelSelectorProps) {
  const { data } = useSWR<{ data: ModelCatalogEntry[] }>("/api/ai/models", fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
  });
  const models = data?.data ?? [];
  const [open, setOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Filter models by category
  const filteredModels = (() => {
    if (autoMode) {
      return models.filter((m) => m.enabled);
    }

    const requiredCaps = getRequiredCapabilities(category);
    if (requiredCaps) {
      return models.filter((m) => m.enabled && requiredCaps.some((cap) => m.capabilities.includes(cap)));
    }

    return models.filter((m) => m.enabled);
  })();

  // Group models: category -> (tier for chat, provider for others)
  const groupedModels = useMemo((): GroupedModels[] => {
    const result: GroupedModels[] = [];
    const categoryGroups: Record<string, Record<string, ModelCatalogEntry[]>> = {};

    for (const model of filteredModels) {
      const modelCategory = getCategoryFromCapabilities(model.capabilities);
      if (!categoryGroups[modelCategory]) {
        categoryGroups[modelCategory] = {};
      }

      if (modelCategory === "chat") {
        const tier = getTierFromCapabilities(model.capabilities);
        if (!categoryGroups[modelCategory][tier]) {
          categoryGroups[modelCategory][tier] = [];
        }
        categoryGroups[modelCategory][tier].push(model);
      } else {
        const provider = model.provider ?? "other";
        if (!categoryGroups[modelCategory][provider]) {
          categoryGroups[modelCategory][provider] = [];
        }
        categoryGroups[modelCategory][provider].push(model);
      }
    }

    for (const [cat, groups] of Object.entries(categoryGroups)) {
      const categoryGroups2: GroupedModels["groups"] = [];
      for (const [key, groupModels] of Object.entries(groups)) {
        const sortedModels = [...groupModels].sort((a, b) => {
          const aIsFast = a.capabilities.includes("fast");
          const bIsFast = b.capabilities.includes("fast");
          if (aIsFast && !bIsFast) return -1;
          if (!aIsFast && bIsFast) return 1;
          return a.displayName.localeCompare(b.displayName);
        });

        if (cat === "chat") {
          categoryGroups2.push({
            key,
            label: getTierDisplayName(key),
            icon: TIER_CONFIG[key]?.icon ?? "💬",
            models: sortedModels,
          });
        } else {
          categoryGroups2.push({
            key,
            label: getProviderDisplayName(key),
            icon: "📦",
            models: sortedModels,
          });
        }
      }

      if (cat === "chat") {
        categoryGroups2.sort((a, b) => getTierOrder(a.key) - getTierOrder(b.key));
      } else {
        categoryGroups2.sort((a, b) => a.label.localeCompare(b.label));
      }

      result.push({
        category: cat,
        categoryLabel: getCategoryDisplayName(cat),
        groups: categoryGroups2,
      });
    }

    result.sort((a, b) => {
      if (a.category === "chat") return -1;
      if (b.category === "chat") return 1;
      return a.categoryLabel.localeCompare(b.categoryLabel);
    });

    return result;
  }, [filteredModels]);

  const categories = groupedModels.map((g) => g.category);

  const currentModel = models.find((m) => m.modelRef === value);
  const currentCategory = currentModel ? getCategoryFromCapabilities(currentModel.capabilities) : categories[0];
  const currentGroup = currentModel
    ? currentCategory === "chat"
      ? getTierFromCapabilities(currentModel.capabilities)
      : currentModel.provider ?? "other"
    : groupedModels[0]?.groups[0]?.key;

  // Auto-select first model when category prop changes and current model doesn't match
  useEffect(() => {
    if (autoMode) return;

    const requiredCaps = getRequiredCapabilities(category);
    if (!requiredCaps) return;

    const matchesCategory = requiredCaps.some((cap) => currentModel?.capabilities.includes(cap));
    if (!matchesCategory && filteredModels.length > 0) {
      const firstModel = filteredModels[0];
      if (firstModel.modelRef !== value) {
        onChange(firstModel.modelRef);
      }
    }
  }, [category, autoMode, currentModel, filteredModels, value, onChange]);

  useEffect(() => {
    if (open) {
      if (!selectedCategory) {
        setSelectedCategory(currentCategory);
      }
      if (!selectedGroup) {
        const cat = selectedCategory ?? currentCategory;
        const catData = groupedModels.find((g) => g.category === cat);
        const defaultGroup = catData?.groups.find((g) => g.key === currentGroup)?.key
          ?? catData?.groups[0]?.key;
        if (defaultGroup) {
          setSelectedGroup(defaultGroup);
        }
      }
    } else {
      setSelectedCategory(null);
      setSelectedGroup(null);
    }
  }, [open, selectedCategory, selectedGroup, currentCategory, currentGroup, groupedModels]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  const displayText = (() => {
    if (autoMode) return "自动选择模型";
    if (!currentModel) return "选择模型";
    return `${getProviderDisplayName(currentModel.provider ?? "")} · ${currentModel.displayName}`;
  })();

  const selectedCategoryData = groupedModels.find((g) => g.category === selectedCategory);
  const selectedGroupData = selectedCategoryData?.groups.find((g) => g.key === selectedGroup);
  const groupModels = selectedGroupData?.models ?? [];

  const handleSelectModel = (modelRef: string) => {
    onChange(modelRef);
    setOpen(false);
  };

  const getCategoryIcon = (cat: string) => {
    if (cat === "chat") return "💬";
    if (cat === "image") return "🖼";
    if (cat === "video") return "🎬";
    return "📦";
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50 hover:border-ink-300 transition-colors duration-150"
      >
        <span>{displayText}</span>
        <IconChevronDown className="h-3 w-3" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 flex rounded-xl border border-ink-200 bg-white shadow-base overflow-hidden">
          {/* Category list (left panel) */}
          <div className="w-28 border-r border-ink-100 flex flex-col">
            <div className="px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-ink-400 border-b border-ink-100 bg-ink-50">
              类型
            </div>
            <div className={`flex-1 overflow-y-auto ${DROPDOWN_HEIGHT}`}>
              {groupedModels.map((cat) => (
                <button
                  key={cat.category}
                  onClick={() => {
                    setSelectedCategory(cat.category);
                    setSelectedGroup(cat.groups[0]?.key ?? null);
                  }}
                  className={`flex w-full items-center justify-between px-3 py-2 text-sm transition-colors duration-100 ${
                    selectedCategory === cat.category
                      ? "bg-brand-50 text-brand-700 font-medium"
                      : "text-ink-700 hover:bg-ink-50"
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <span>{getCategoryIcon(cat.category)}</span>
                    <span>{cat.categoryLabel}</span>
                  </span>
                  {selectedCategory === cat.category && (
                    <IconChevronRight className="h-3 w-3 text-brand-500" />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Group list (middle panel) */}
          <div className="w-32 border-r border-ink-100 flex flex-col">
            <div className="px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-ink-400 border-b border-ink-100 bg-ink-50">
              {selectedCategory === "chat" ? "层级" : "厂商"}
            </div>
            <div className={`flex-1 overflow-y-auto ${DROPDOWN_HEIGHT}`}>
              {selectedCategoryData?.groups.map((group) => (
                <button
                  key={group.key}
                  onClick={() => setSelectedGroup(group.key)}
                  className={`flex w-full items-center justify-between px-3 py-2 text-sm transition-colors duration-100 ${
                    selectedGroup === group.key
                      ? "bg-brand-50 text-brand-700 font-medium"
                      : "text-ink-700 hover:bg-ink-50"
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <span>{group.icon}</span>
                    <span>{group.label}</span>
                  </span>
                  {selectedGroup === group.key && (
                    <IconChevronRight className="h-3 w-3 text-brand-500" />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Model list (right panel) */}
          <div className="w-56 flex flex-col">
            <div className="px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-ink-400 border-b border-ink-100 bg-ink-50">
              {selectedGroupData?.label ?? "模型"} · {selectedGroupData?.models.length ?? 0}
            </div>
            <div className={`overflow-y-auto ${DROPDOWN_HEIGHT}`}>
              {groupModels.length === 0 ? (
                <div className="px-3 py-4 text-sm text-ink-400 text-center">
                  暂无可用模型
                </div>
              ) : (
                groupModels.map((model) => (
                  <button
                    key={model.modelRef}
                    onClick={() => handleSelectModel(model.modelRef)}
                    className={`flex w-full items-center justify-between px-3 py-2 text-sm transition-colors duration-100 ${
                      model.modelRef === value
                        ? "bg-brand-50 text-brand-700 font-medium"
                        : "text-ink-700 hover:bg-ink-50"
                    }`}
                  >
                    <span className="truncate">{model.displayName}</span>
                    <span className="flex items-center gap-1.5">
                      {model.capabilities.includes("fast") && (
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 whitespace-nowrap">
                          快速
                        </span>
                      )}
                      {model.modelRef === value && (
                        <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
                      )}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
