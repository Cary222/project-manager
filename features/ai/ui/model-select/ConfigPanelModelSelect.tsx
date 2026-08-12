"use client";

import useSWR from "swr";
import { useState, useRef, useEffect } from "react";
import { useModelCatalog } from "./useModelCatalog";
import { useModelGrouping } from "./useModelGrouping";
import {
  getCategoryDisplayName,
  getCategoryIcon,
  getTierDisplayName,
  getTierIcon,
  getProviderDisplayName,
  TIER_CONFIG,
} from "./model-labels";
import { IconChevronDown, IconChevronRight } from "@/shared/ui/icons";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const DROPDOWN_HEIGHT = "max-h-60";

interface ConfigPanelModelSelectProps {
  value: string;
  onChange: (modelRef: string) => void;
  className?: string;
}

/**
 * 简化的三级下拉模型选择器，用于设置页面
 * 架构：类型 → (层级/厂商) → 模型
 */
export function ConfigPanelModelSelect({ value, onChange, className }: ConfigPanelModelSelectProps) {
  const { models } = useModelCatalog();
  const { groupedModels } = useModelGrouping(models);
  const [open, setOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const categories = groupedModels.map((g) => g.category);

  // Get current model info
  const currentModel = models.find((m) => m.value === value);
  const currentCategory = currentModel?.category ?? categories[0];
  const currentGroup = (() => {
    if (!currentModel) return groupedModels[0]?.groups[0]?.key ?? null;

    if (currentCategory === "chat") {
      // For chat models, use tier as group key
      return currentModel.tier ?? "standard";
    } else {
      // For other models, use provider as group key
      return currentModel.provider;
    }
  })();

  // Auto-select category/group when dropdown opens
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

  // Close on outside click
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

  // Display text
  const displayText = currentModel?.model ?? "选择模型…";

  // Get models for selected category/group
  const selectedCategoryData = groupedModels.find((g) => g.category === selectedCategory);
  const selectedGroupData = selectedCategoryData?.groups.find((g) => g.key === selectedGroup);
  const groupModels = selectedGroupData?.models ?? [];

  const handleSelectModel = (modelValue: string) => {
    onChange(modelValue);
    setOpen(false);
  };

  if (models.length === 0) {
    return (
      <div className={`flex items-center gap-2 rounded-md border border-brand-300 bg-white px-3 py-2 text-sm text-ink-400 ${className ?? ""}`}>
        加载中…
      </div>
    );
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen(!open)}
        className={`flex w-full items-center justify-between gap-2 rounded-md border border-brand-300 bg-white px-3 py-2 text-sm text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 ${className ?? ""}`}
      >
        <span className="truncate">{displayText}</span>
        <IconChevronDown className="h-4 w-4 flex-shrink-0 text-ink-400" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 flex rounded-xl border border-ink-200 bg-white shadow-base overflow-hidden">
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
                    <span>{cat.categoryIcon}</span>
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
                    key={model.value}
                    onClick={() => handleSelectModel(model.value)}
                    className={`flex w-full items-center justify-between px-3 py-2 text-sm transition-colors duration-100 ${
                      model.value === value
                        ? "bg-brand-50 text-brand-700 font-medium"
                        : "text-ink-700 hover:bg-ink-50"
                    }`}
                  >
                    <span className="truncate">{model.model}</span>
                    <span className="flex items-center gap-1.5">
                      {model.tier === "fast" && (
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 whitespace-nowrap">
                          快速
                        </span>
                      )}
                      {model.value === value && (
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
