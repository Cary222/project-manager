"use client";

/**
 * Shared Model Settings — Model Discovery 面板（ADAPT）
 *
 * 从 ModelsConfig.tsx ProviderDetail 内的 discovery 区块提取。
 * discover 能力经 ModelSettingsAdapter 注入（Pi: /api/models-config/discover；
 * ProjectHub: /api/ai/providers/discover），不建第二套 Discovery。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useModelSettingsAdapter } from "./adapter";
import { useModelSettingsI18n } from "./i18n";
import { inputStyle } from "./form-controls";
import type { DiscoveredModel, ModelDiscoveryState, ProviderEntry } from "./types";

export function ModelDiscoveryPanel({
  providerName,
  provider,
  existingModelIds,
  onAddModels,
}: {
  providerName: string;
  provider: ProviderEntry;
  existingModelIds: Set<string>;
  onAddModels: (models: DiscoveredModel[]) => void;
}) {
  const adapter = useModelSettingsAdapter();
  const t = useModelSettingsI18n();
  const [discoveryState, setDiscoveryState] = useState<ModelDiscoveryState>({ phase: "idle" });
  const [discoveryQuery, setDiscoveryQuery] = useState("");
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
  const discoveryRequestIdRef = useRef(0);
  const selectShownRef = useRef<HTMLInputElement>(null);

  /* eslint-disable react-hooks/set-state-in-effect -- provider 凭证/端点变化时重置发现结果（与原实现同语义） */
  useEffect(() => {
    discoveryRequestIdRef.current += 1;
    setDiscoveryState({ phase: "idle" });
    setDiscoveryQuery("");
    setSelectedModelIds([]);
  }, [providerName, provider.baseUrl, provider.api, provider.apiKey]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleDiscoverModels = useCallback(async () => {
    if (!provider.baseUrl?.trim() || discoveryState.phase === "loading") return;
    const requestId = ++discoveryRequestIdRef.current;
    setDiscoveryState({ phase: "loading" });
    setSelectedModelIds([]);
    try {
      const result = await adapter.discover(providerName, { ...provider, models: undefined });
      if (requestId !== discoveryRequestIdRef.current) return;
      setDiscoveryState({ phase: "success", models: result.models, endpoint: result.endpoint ?? provider.baseUrl });
    } catch (error) {
      if (requestId !== discoveryRequestIdRef.current) return;
      setDiscoveryState({ phase: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, [adapter, discoveryState.phase, providerName, provider]);

  const discoveredModels = discoveryState.phase === "success" ? discoveryState.models : [];
  const normalizedDiscoveryQuery = discoveryQuery.trim().toLocaleLowerCase();
  const filteredDiscoveredModels = discoveredModels.filter((model) => !normalizedDiscoveryQuery
    || model.id.toLocaleLowerCase().includes(normalizedDiscoveryQuery)
    || model.name?.toLocaleLowerCase().includes(normalizedDiscoveryQuery));
  const shownDiscoveredModels = filteredDiscoveredModels.slice(0, 300);
  const selectableShownIds = shownDiscoveredModels
    .filter((model) => !existingModelIds.has(model.id))
    .map((model) => model.id);
  const selectedCount = selectedModelIds.filter((id) => !existingModelIds.has(id)).length;
  const allShownSelected = selectableShownIds.length > 0
    && selectableShownIds.every((id) => selectedModelIds.includes(id));
  const someShownSelected = !allShownSelected
    && selectableShownIds.some((id) => selectedModelIds.includes(id));

  useEffect(() => {
    if (selectShownRef.current) selectShownRef.current.indeterminate = someShownSelected;
  }, [someShownSelected]);

  const toggleDiscoveredModel = (id: string) => {
    setSelectedModelIds((current) => current.includes(id)
      ? current.filter((entry) => entry !== id)
      : [...current, id]);
  };

  const toggleShownModels = () => {
    const shownIds = new Set(selectableShownIds);
    setSelectedModelIds((current) => allShownSelected
      ? current.filter((id) => !shownIds.has(id))
      : Array.from(new Set([...current, ...selectableShownIds])));
  };

  const addSelectedModels = () => {
    if (discoveryState.phase !== "success") return;
    const selected = new Set(selectedModelIds);
    const additions = discoveryState.models.filter((model) => selected.has(model.id) && !existingModelIds.has(model.id));
    if (additions.length === 0) return;
    onAddModels(additions);
    setSelectedModelIds([]);
  };

  return (
    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      {discoveryState.phase !== "success" && (
        <button
          onClick={handleDiscoverModels}
          disabled={!provider.baseUrl?.trim() || discoveryState.phase === "loading"}
          style={{
            alignSelf: "flex-start", height: 30, padding: "0 12px", border: "1px solid var(--border)", borderRadius: 5,
            background: "var(--bg-panel)", color: !provider.baseUrl?.trim() || discoveryState.phase === "loading" ? "var(--text-dim)" : "var(--text-muted)",
            cursor: !provider.baseUrl?.trim() || discoveryState.phase === "loading" ? "not-allowed" : "pointer", fontSize: 11,
          }}
        >
          {discoveryState.phase === "loading" ? t("models.discoveryFetching") : t("models.discoveryFetch")}
        </button>
      )}

      {discoveryState.phase === "error" && (
        <div style={{ padding: "7px 9px", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 5, color: "#ef4444", fontSize: 11, lineHeight: 1.4 }}>
          {discoveryState.message}
        </div>
      )}

      {discoveryState.phase === "success" && (
        <>
          <input
            value={discoveryQuery}
            onChange={(event) => setDiscoveryQuery(event.target.value)}
            placeholder={t("models.discoveryFilterPlaceholder", { count: discoveryState.models.length })}
            aria-label={t("models.discoveryFilter")}
            style={{ ...inputStyle, width: "100%", minWidth: 0 }}
          />

          <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-panel)" }}>
            <label
              style={{
                minHeight: 32, padding: "5px 9px", display: "flex", alignItems: "center", gap: 8,
                position: "sticky", top: 0, zIndex: 1, borderBottom: "1px solid var(--border)",
                background: "var(--bg)", cursor: selectableShownIds.length ? "pointer" : "default",
                color: "var(--text-muted)", fontSize: 10, fontWeight: 600,
              }}
            >
              <input
                ref={selectShownRef}
                type="checkbox"
                checked={allShownSelected}
                disabled={selectableShownIds.length === 0}
                onChange={toggleShownModels}
                style={{ width: 13, height: 13, accentColor: "var(--accent)", flexShrink: 0 }}
              />
              {t("models.discoverySelectShown")}
            </label>
            {shownDiscoveredModels.length === 0 ? (
              <div style={{ padding: 12, color: "var(--text-dim)", fontSize: 11 }}>{t("models.discoveryNoMatches")}</div>
            ) : shownDiscoveredModels.map((model, index) => {
              const alreadyAdded = existingModelIds.has(model.id);
              const checked = selectedModelIds.includes(model.id);
              return (
                <label
                  key={model.id}
                  style={{
                    minHeight: 36, padding: "6px 9px", display: "flex", alignItems: "center", gap: 8,
                    borderTop: index === 0 ? "none" : "1px solid var(--border)", cursor: alreadyAdded ? "default" : "pointer",
                    opacity: alreadyAdded ? 0.65 : 1,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked || alreadyAdded}
                    disabled={alreadyAdded}
                    onChange={() => toggleDiscoveredModel(model.id)}
                    style={{ width: 13, height: 13, accentColor: "var(--accent)", flexShrink: 0 }}
                  />
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text)", fontSize: 11 }}>{model.name ?? model.id}</span>
                    {model.name && <code style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-dim)", fontSize: 10, fontFamily: "var(--font-mono)" }}>{model.id}</code>}
                  </span>
                  {alreadyAdded && <span style={{ color: "var(--text-dim)", fontSize: 10 }}>{t("models.discoveryAdded")}</span>}
                </label>
              );
            })}
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <span title={discoveryState.endpoint} style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-dim)", fontSize: 10 }}>
              {filteredDiscoveredModels.length > shownDiscoveredModels.length
                ? t("models.discoveryShowing", { shown: shownDiscoveredModels.length, total: filteredDiscoveredModels.length })
                : t("models.discoveryFetched", { count: discoveryState.models.length })}
            </span>
            <button
              onClick={addSelectedModels}
              disabled={selectedCount === 0}
              style={{ height: 28, padding: "0 11px", border: "none", borderRadius: 5, background: selectedCount ? "var(--accent)" : "var(--bg-panel)", color: selectedCount ? "#fff" : "var(--text-dim)", cursor: selectedCount ? "pointer" : "not-allowed", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}
            >
              {selectedCount
                ? t("models.discoveryAddSelectedCount", { count: selectedCount })
                : t("models.discoveryAddSelected")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
