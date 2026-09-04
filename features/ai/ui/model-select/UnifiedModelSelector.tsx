"use client";

/**
 * UnifiedModelSelector（Stage 6）— 统一的模型选择 UI
 *
 * 数据源：/api/ai/models（Model Availability / Catalog Entry）
 *        + /api/ai/model-preferences（User Preferences：enabled/favorite/thinkingLevel）
 *
 * 能力：Search / Provider Filter / Capability Filter / Context Window /
 *      Reasoning Badge / Favorite / Default / Enabled / Thinking Level。
 *
 * 对外契约保持 value / onChange(modelRef)，Chat / WorkAgent 等调用方零改动。
 * Thinking Selector 仅对 availableReasoningLevels 非空的模型渲染。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR, { mutate } from "swr";
import { useSession } from "next-auth/react";
import type { ModelCatalogEntry } from "@/features/ai/llm/providers/types";
import { availableReasoningLevels, type ReasoningLevel } from "@/features/ai/llm/model-reasoning";
import { CapabilityBadges, ContextWindowBadge, type CapabilityBadgeKind } from "@/features/ai/ui/model-settings/CapabilityBadges";
import { ProviderIcon } from "@/features/ai/ui/model-settings/provider-icons";
import { getProviderDisplayName } from "./model-labels";
import type { AiTaskCategory } from "@/features/ai/types/modes";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface PreferenceView {
  provider: string;
  modelId: string;
  enabled: boolean;
  favorite: boolean;
  thinkingLevel: string | null;
}

export interface UnifiedModelSelectorProps {
  value: string;
  onChange: (modelRef: string) => void;
  /** 兼容旧 ModelSelector：按任务类别过滤（image/video 需要对应 capability）。 */
  category?: AiTaskCategory;
  autoMode?: boolean;
  toolMode?: string;
  /** 默认模型 ref（显示 Default 标记）。 */
  defaultModelRef?: string;
  /** 下拉框对齐方向：'right' (默认) | 'left' | 'center' | 'full' */
  align?: "left" | "right" | "center" | "full";
  /** 是否占满父容器宽度 */
  fullWidth?: boolean;
  /** 自定义外层容器类名 */
  className?: string;
  /** 自定义下拉面板宽度/定位类名 */
  dropdownClassName?: string;
}

function getRequiredCapabilities(category?: AiTaskCategory): string[] | null {
  if (category === "image") return ["image"];
  if (category === "video") return ["video"];
  return null;
}

export function UnifiedModelSelector({
  value,
  onChange,
  category = "chat",
  autoMode = false,
  defaultModelRef,
  align = "right",
  fullWidth = false,
  className,
  dropdownClassName,
}: UnifiedModelSelectorProps) {
  const { status } = useSession();
  const isLoggedIn = status === "authenticated";

  const { data: modelsData } = useSWR<{ data: ModelCatalogEntry[] }>(
    "/api/ai/models",
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );
  const { data: prefsData } = useSWR<{ data: { preferences: PreferenceView[] } }>(
    isLoggedIn ? "/api/ai/model-preferences" : null,
    fetcher,
    { revalidateOnFocus: false },
  );

  const models = useMemo(() => modelsData?.data ?? [], [modelsData]);
  const prefsMap = useMemo(() => {
    const map = new Map<string, PreferenceView>();
    for (const p of prefsData?.data?.preferences ?? []) {
      map.set(`${p.provider}:${p.modelId}`, p);
    }
    return map;
  }, [prefsData]);

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState<string | null>(null);
  const [capabilityFilter, setCapabilityFilter] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // enabled 过滤（无偏好行 = 默认启用）+ 类别 capability 过滤
  const visibleModels = useMemo(() => {
    const requiredCaps = autoMode ? null : getRequiredCapabilities(category);
    return models.filter((m) => {
      if (!m.enabled) return false;
      if (prefsMap.get(m.modelRef)?.enabled === false) return false;
      if (requiredCaps && !requiredCaps.some((cap) => m.capabilities.includes(cap as never))) return false;
      return true;
    });
  }, [models, prefsMap, autoMode, category]);

  const providers = useMemo(() => {
    const set = new Set<string>();
    visibleModels.forEach((m) => m.provider && set.add(m.provider));
    return Array.from(set).sort();
  }, [visibleModels]);

  const filteredModels = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visibleModels.filter((m) => {
      if (providerFilter && m.provider !== providerFilter) return false;
      if (capabilityFilter && !m.capabilities.includes(capabilityFilter as never)) return false;
      if (q && !m.displayName.toLowerCase().includes(q) && !m.modelName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [visibleModels, providerFilter, capabilityFilter, search]);

  // favorite 置顶，其次按展示名排序
  const sortedModels = useMemo(() => {
    return [...filteredModels].sort((a, b) => {
      const af = prefsMap.get(a.modelRef)?.favorite ? 1 : 0;
      const bf = prefsMap.get(b.modelRef)?.favorite ? 1 : 0;
      if (af !== bf) return bf - af;
      return a.displayName.localeCompare(b.displayName);
    });
  }, [filteredModels, prefsMap]);

  // 关闭下拉时重置筛选（与原 ModelSelector 同语义）
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) {
      setSearch("");
      setProviderFilter(null);
      setCapabilityFilter(null);
    }
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */

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

  const toggleFavorite = useCallback(async (modelRef: string) => {
    if (!isLoggedIn) return;
    const { provider, modelId } = splitRef(modelRef);
    const current = prefsMap.get(modelRef)?.favorite ?? false;
    // 乐观更新
    mutate(
      "/api/ai/model-preferences",
      (data: { data: { preferences: PreferenceView[] } } | undefined) => {
        const prefs = data?.data?.preferences ?? [];
        const others = prefs.filter((p) => `${p.provider}:${p.modelId}` !== modelRef);
        return { data: { preferences: [...others, { provider, modelId, enabled: true, favorite: !current, thinkingLevel: prefs.find((p) => `${p.provider}:${p.modelId}` === modelRef)?.thinkingLevel ?? null }] } };
      },
      { revalidate: false },
    );
    await fetch("/api/ai/model-preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ provider, modelId, favorite: !current }] }),
    });
    void mutate("/api/ai/model-preferences");
  }, [isLoggedIn, prefsMap]);

  const setThinkingLevel = useCallback(async (modelRef: string, level: ReasoningLevel | null) => {
    if (!isLoggedIn) return;
    const { provider, modelId } = splitRef(modelRef);
    await fetch("/api/ai/model-preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ provider, modelId, thinkingLevel: level }] }),
    });
    void mutate("/api/ai/model-preferences");
  }, [isLoggedIn]);

  const currentModel = models.find((m) => m.modelRef === value);
  const displayText = (() => {
    if (autoMode) return "自动选择模型";
    if (!currentModel) return "选择模型";
    return `${getProviderDisplayName(currentModel.provider ?? "")} · ${currentModel.displayName}`;
  })();

  const capabilityOptions = useMemo(() => {
    const set = new Set<string>();
    visibleModels.forEach((m) => m.capabilities.forEach((cap) => set.add(cap)));
    return Array.from(set).sort();
  }, [visibleModels]);

  return (
    <div className={`relative ${fullWidth ? "w-full" : ""} ${className ?? ""}`} ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex items-center justify-between gap-2 rounded-xl border border-ink-200 bg-white px-3 py-2 text-xs font-medium text-ink-700 transition-colors duration-150 hover:border-brand-400 hover:bg-ink-50 shadow-sm ${
          fullWidth ? "w-full" : ""
        }`}
      >
        <span className="truncate">{displayText}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div
          className={`absolute top-full z-50 mt-1 overflow-hidden rounded-xl border border-ink-200 bg-white shadow-2xl ${
            align === "full"
              ? "left-0 right-0 w-full min-w-full"
              : align === "left"
                ? "left-0 w-[300px] sm:w-[340px] max-w-[calc(100vw-24px)]"
                : align === "center"
                  ? "left-1/2 -translate-x-1/2 w-[300px] sm:w-[340px] max-w-[calc(100vw-24px)]"
                  : "right-0 w-[320px] sm:w-[380px] max-w-[calc(100vw-24px)]"
          } ${dropdownClassName ?? ""}`}
        >
          {/* 工具栏：搜索 + 筛选 */}
          <div className="flex flex-col gap-2 border-b border-ink-100 p-2.5">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索模型…"
              className="w-full rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-xs text-ink-800 outline-none focus:border-brand-400"
            />
            <div className="flex flex-wrap items-center gap-1">
              <FilterChip
                active={providerFilter === null}
                label="全部厂商"
                onClick={() => setProviderFilter(null)}
              />
              {providers.map((p) => (
                <FilterChip
                  key={p}
                  active={providerFilter === p}
                  label={getProviderDisplayName(p)}
                  onClick={() => setProviderFilter(providerFilter === p ? null : p)}
                />
              ))}
              <span className="mx-1 h-3 w-px bg-ink-200" />
              {capabilityOptions.map((cap) => (
                <FilterChip
                  key={cap}
                  active={capabilityFilter === cap}
                  label={cap}
                  onClick={() => setCapabilityFilter(capabilityFilter === cap ? null : cap)}
                />
              ))}
            </div>
          </div>

          {/* 模型列表 */}
          <div className="max-h-80 overflow-y-auto p-1.5">
            {sortedModels.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-ink-400">暂无可用模型</div>
            ) : (
              sortedModels.map((model) => {
                const pref = prefsMap.get(model.modelRef);
                const levels = availableReasoningLevels(model);
                const isSelected = model.modelRef === value;
                return (
                  <div
                    key={model.modelRef}
                    className={`group flex items-center gap-2 rounded-lg px-2.5 py-2 transition-colors ${
                      isSelected ? "bg-brand-50" : "hover:bg-ink-50"
                    }`}
                  >
                    <button
                      onClick={() => {
                        onChange(model.modelRef);
                        setOpen(false);
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <ProviderIcon id={model.provider ?? ""} size={18} />
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-xs ${isSelected ? "font-semibold text-brand-700" : "text-ink-800"}`}>
                          {model.displayName}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5">
                          <CapabilityBadges capabilities={model.capabilities as CapabilityBadgeKind[]} />
                          <ContextWindowBadge contextWindow={model.contextWindow} />
                          {model.modelRef === defaultModelRef && (
                            <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-medium text-ink-500">默认</span>
                          )}
                        </span>
                      </span>
                    </button>

                    {/* Thinking Level（仅支持 reasoning 的模型显示） */}
                    {levels.length > 0 && (
                      <select
                        value={pref?.thinkingLevel ?? ""}
                        onChange={(e) => void setThinkingLevel(model.modelRef, (e.target.value || null) as ReasoningLevel | null)}
                        onClick={(e) => e.stopPropagation()}
                        title="Thinking level"
                        className="rounded border border-ink-200 bg-white px-1 py-0.5 text-[10px] text-ink-600 outline-none"
                      >
                        <option value="">默认</option>
                        {levels.map((level) => (
                          <option key={level} value={level}>{level}</option>
                        ))}
                      </select>
                    )}

                    {/* Favorite */}
                    {isLoggedIn && (
                      <button
                        onClick={() => void toggleFavorite(model.modelRef)}
                        title={pref?.favorite ? "取消收藏" : "收藏"}
                        className={`shrink-0 rounded p-1 transition-colors ${
                          pref?.favorite ? "text-amber-400" : "text-ink-200 hover:text-amber-300"
                        }`}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill={pref?.favorite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                        </svg>
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function FilterChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
        active
          ? "bg-brand-600 text-white"
          : "bg-ink-100 text-ink-500 hover:bg-ink-200"
      }`}
    >
      {label}
    </button>
  );
}

function splitRef(modelRef: string): { provider: string; modelId: string } {
  const colonIndex = modelRef.indexOf(":");
  if (colonIndex < 0) return { provider: "", modelId: modelRef };
  return { provider: modelRef.slice(0, colonIndex), modelId: modelRef.slice(colonIndex + 1) };
}
