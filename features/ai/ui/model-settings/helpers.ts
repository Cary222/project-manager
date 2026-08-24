/**
 * Shared Model Settings — 纯逻辑 helpers
 * 从 features/ai/ui/ai-workspace/models-config-helpers.ts 迁入（原路径保留 re-export）。
 */

import type { ModelCatalogPreset } from "@/lib/model-catalog";
import type { ModelEntry } from "./types";

export interface CompatEntry {
  compat?: Record<string, unknown>;
}

export interface HeaderRow {
  id: number;
  name: string;
  value: string;
}

export const MODEL_COST_KEYS = ["input", "output", "cacheRead", "cacheWrite"] as const;

export type ModelCostKey = (typeof MODEL_COST_KEYS)[number];

export type ModelCostRates = Record<ModelCostKey, number>;

export type ModelCostDraft = Record<ModelCostKey, string>;

export function modelCostToDraft(cost?: Partial<ModelCostRates>): ModelCostDraft {
  return {
    input: cost?.input === undefined ? "" : String(cost.input),
    output: cost?.output === undefined ? "" : String(cost.output),
    cacheRead: cost?.cacheRead === undefined ? "" : String(cost.cacheRead),
    cacheWrite: cost?.cacheWrite === undefined ? "" : String(cost.cacheWrite),
  };
}

export function parseCompleteModelCost(draft: ModelCostDraft): ModelCostRates | undefined {
  if (!hasModelCostDraftValue(draft)) return undefined;

  const parse = (value: string): number | undefined => {
    if (!value.trim()) return 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  };
  const input = parse(draft.input);
  const output = parse(draft.output);
  const cacheRead = parse(draft.cacheRead);
  const cacheWrite = parse(draft.cacheWrite);
  if (input === undefined || output === undefined || cacheRead === undefined || cacheWrite === undefined) {
    return undefined;
  }
  return { input, output, cacheRead, cacheWrite };
}

export function hasModelCostDraftValue(draft: ModelCostDraft): boolean {
  return MODEL_COST_KEYS.some((key) => draft[key].trim() !== "");
}

export function setCompatBool<T extends CompatEntry>(entry: T, key: string, value: boolean): T {
  return {
    ...entry,
    compat: { ...(entry.compat ?? {}), [key]: value },
  };
}

export function updateHeaderRow(
  rows: readonly HeaderRow[],
  id: number,
  changes: Partial<Pick<HeaderRow, "name" | "value">>,
): HeaderRow[] {
  return rows.map((row) => row.id === id ? { ...row, ...changes } : row);
}

export function serializeHeaderRows(rows: readonly HeaderRow[]): Record<string, string> | undefined {
  const headers: Record<string, string> = {};
  for (const row of rows) {
    const name = row.name.trim();
    if (name) headers[name] = row.value;
  }
  return Object.keys(headers).length ? headers : undefined;
}

/** 用 catalog preset 补齐模型空字段（字段级，不整体覆盖）。 */
export function fillEmptyModelFields(
  model: ModelEntry,
  preset: ModelCatalogPreset,
): { model: ModelEntry; appliedCount: number } {
  const next = { ...model };
  let appliedCount = 0;
  if (!model.name?.trim() && preset.name) {
    next.name = preset.name;
    appliedCount += 1;
  }
  if (model.reasoning === undefined && preset.reasoning === true) {
    next.reasoning = true;
    appliedCount += 1;
  }
  if (!model.input?.length && preset.input?.length) {
    next.input = [...preset.input];
    appliedCount += 1;
  }
  if (model.contextWindow === undefined && preset.contextWindow !== undefined) {
    next.contextWindow = preset.contextWindow;
    appliedCount += 1;
  }
  if (model.maxTokens === undefined && preset.maxTokens !== undefined) {
    next.maxTokens = preset.maxTokens;
    appliedCount += 1;
  }

  if (preset.cost) {
    const cost = { ...(model.cost ?? {}) };
    let filledCostCount = 0;
    for (const key of MODEL_COST_KEYS) {
      if (cost[key] === undefined && preset.cost[key] !== undefined) {
        cost[key] = preset.cost[key];
        filledCostCount += 1;
      }
    }
    const completeCost = parseCompleteModelCost(modelCostToDraft(cost));
    if (filledCostCount > 0 && completeCost) {
      next.cost = { ...cost, ...completeCost };
      appliedCount += filledCostCount;
    }
  }
  return { model: next, appliedCount };
}
