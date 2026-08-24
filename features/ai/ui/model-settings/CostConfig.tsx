"use client";

/**
 * Shared Model Settings — Cost 配置（KEEP）
 * 从 ModelsConfig.tsx ModelDetail 内的成本展示/编辑区块提取。
 */

import { useRef, useState } from "react";
import { useModelSettingsI18n } from "./i18n";
import { Field, NumInput } from "./form-controls";
import {
  hasModelCostDraftValue,
  modelCostToDraft,
  parseCompleteModelCost,
  type ModelCostDraft,
  type ModelCostKey,
} from "./helpers";
import type { ModelEntry } from "./types";

export function CostConfig({
  model,
  onChange,
}: {
  model: ModelEntry;
  onChange: (m: ModelEntry) => void;
}) {
  const t = useModelSettingsI18n();
  const [costEditing, setCostEditing] = useState(false);
  const [costDraft, setCostDraft] = useState<ModelCostDraft>(() => modelCostToDraft(model.cost));
  const costDraftRef = useRef(costDraft);
  const costTemplateRef = useRef(model.cost);

  const setCost = (key: ModelCostKey, value: string) => {
    const nextDraft = { ...costDraftRef.current, [key]: value };
    const completeCost = parseCompleteModelCost(nextDraft);
    const nextModel = { ...model };
    costDraftRef.current = nextDraft;
    setCostDraft(nextDraft);
    if (completeCost) {
      nextModel.cost = { ...(costTemplateRef.current ?? {}), ...completeCost };
      costTemplateRef.current = nextModel.cost;
    } else {
      delete nextModel.cost;
    }
    onChange(nextModel);
  };

  const toggleCostEditing = () => {
    if (costEditing) {
      setCostEditing(false);
      return;
    }
    costTemplateRef.current = model.cost;
    const nextDraft = modelCostToDraft(model.cost);
    costDraftRef.current = nextDraft;
    setCostDraft(nextDraft);
    setCostEditing(true);
  };

  const costFields = [
    { key: "input", label: t("models.costInput") },
    { key: "output", label: t("models.costOutput") },
    { key: "cacheRead", label: t("models.costCacheRead") },
    { key: "cacheWrite", label: t("models.costCacheWrite") },
  ] as const;

  const formatCost = (key: ModelCostKey): string => {
    const value = model.cost?.[key];
    return value === undefined ? t("models.notProvided") : `$${String(value)}`;
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 12 }}>
        <button
          type="button"
          onClick={toggleCostEditing}
          aria-expanded={costEditing}
          style={{ padding: "2px 4px", border: "none", background: "transparent", color: "var(--accent)", cursor: "pointer", fontSize: 10 }}
        >
          {costEditing ? t("models.finishEditingCosts") : t("models.editCosts")}
        </button>
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 10, color: "var(--text-dim)", fontWeight: 600, textTransform: "uppercase" }}>
          {t("models.costPerMillion")}
        </div>
        {costEditing ? (
          <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8 }}>
            {costFields.map(({ key, label }) => (
              <Field key={key} label={label}>
                <NumInput value={costDraft[key]} onChange={(v) => setCost(key, v)} placeholder="0" />
              </Field>
            ))}
            {hasModelCostDraftValue(costDraft) && !parseCompleteModelCost(costDraft) && (
              <div aria-live="polite" style={{ gridColumn: "1 / -1", color: "#d97706", fontSize: 10 }}>
                {t("models.costAllRequired")}
              </div>
            )}
          </div>
        ) : (
          <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(105px, 1fr))", gap: "8px 16px" }}>
            {costFields.map(({ key, label }) => {
              const missing = model.cost?.[key] === undefined;
              return (
                <div key={key} style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 10, color: "var(--text-dim)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
                  <div style={{ marginTop: 3, color: missing ? "var(--text-dim)" : "var(--text)", fontSize: 12, fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>
                    {formatCost(key)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
