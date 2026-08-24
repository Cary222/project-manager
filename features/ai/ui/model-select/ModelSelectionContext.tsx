"use client";

/**
 * Model Selection Context（Stage 6 重写）
 *
 * 持久化策略：
 * - 登录用户 → /api/ai/model-preferences（UserAiModelPreference，DB 为 Source of Truth）
 * - 未登录 / 请求失败 → localStorage fallback（兼容原行为）
 * - 旧 localStorage 选择集一次性迁移到 DB（迁移后保留 fallback，稳定后再清理）
 *
 * enabled 语义：无偏好行 = 默认启用；enabled=false 行 = 禁用。
 */

import React, {
  createContext,
  useContext,
  useEffect,
  ReactNode,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSession } from "next-auth/react";
import type { AiModel } from "./types";

interface ModelSelectionState {
  selectedModelIds: Set<string>;
  isLoaded: boolean;
}

interface ModelSelectionContextType {
  state: ModelSelectionState;
  selectedModels: AiModel[];
  configurableModels: AiModel[];
  allModels: AiModel[];
  toggleModel: (modelId: string) => void;
  selectAll: () => void;
  deselectAll: () => void;
  resetToDefault: () => void;
  toggleProvider: (provider: string, shouldSelect: boolean) => void;
  toggleCategory: (
    provider: string,
    category: string,
    shouldSelect: boolean
  ) => void;
  selectedModel: string;
  setSelectedModel: (modelId: string) => void;
}

const ModelSelectionContext = createContext<ModelSelectionContextType | null>(
  null
);

const SELECTED_MODELS_STORAGE_KEY_PREFIX =
  "ai-model-selector-selected-models";
const SELECTED_MODEL_STORAGE_KEY = "ai-model-selector:selectedModel";
const LEGACY_MIGRATION_FLAG = "ai-model-selector:db-migrated-v1";

interface PreferenceRecord {
  provider: string;
  modelId: string;
  enabled: boolean;
}

/** modelRef("provider:modelId") → provider/modelId 拆分。 */
function splitModelRef(modelRef: string): { provider: string; modelId: string } {
  const colonIndex = modelRef.indexOf(":");
  if (colonIndex < 0) return { provider: "", modelId: modelRef };
  return { provider: modelRef.slice(0, colonIndex), modelId: modelRef.slice(colonIndex + 1) };
}

/** 读取旧 localStorage 选择集（可能带模型列表 hash 后缀）。 */
function readLegacySelectedIds(configurableModels: AiModel[]): string[] | null {
  try {
    const modelHash = configurableModels.map((m) => m.value).sort().join(",");
    const stored = window.localStorage.getItem(`${SELECTED_MODELS_STORAGE_KEY_PREFIX}-${modelHash}`);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : null;
  } catch {
    return null;
  }
}

/**
 * DB 偏好加载（含一次性 legacy 迁移）。
 * 返回启用模型集合；null 表示不可用（调用方降级 localStorage）。
 */
async function loadEnabledFromDb(
  configurableModels: AiModel[],
): Promise<Set<string> | null> {
  let prefs: PreferenceRecord[];
  try {
    const res = await fetch("/api/ai/model-preferences");
    if (!res.ok) return null;
    const json = await res.json() as { data?: { preferences?: PreferenceRecord[] } };
    prefs = json.data?.preferences ?? [];
  } catch {
    return null;
  }

  const configurableIds = new Set(configurableModels.map((m) => m.value));
  const disabled = new Set(
    prefs
      .filter((p) => p.enabled === false)
      .map((p) => `${p.provider}:${p.modelId}`)
      .filter((ref) => configurableIds.has(ref)),
  );
  const enabled = new Set(
    configurableModels.map((m) => m.value).filter((id) => !disabled.has(id)),
  );

  // 一次性迁移：legacy localStorage 选择集 → DB（仅在 DB 尚无任何 enabled 覆盖时）
  try {
    if (!window.localStorage.getItem(LEGACY_MIGRATION_FLAG) && prefs.length === 0) {
      const legacyIds = readLegacySelectedIds(configurableModels);
      if (legacyIds) {
        const legacySet = new Set(legacyIds);
        const items = configurableModels
          .filter((m) => !legacySet.has(m.value))
          .map((m) => ({ ...splitModelRef(m.value), enabled: false }));
        if (items.length > 0) {
          await fetch("/api/ai/model-preferences", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items }),
          });
          // 迁移成功后重新计算启用集
          for (const item of items) enabled.delete(`${item.provider}:${item.modelId}`);
        }
      }
    }
    window.localStorage.setItem(LEGACY_MIGRATION_FLAG, "1");
  } catch {
    // localStorage 不可用不影响 DB 语义
  }

  return enabled;
}

/** 将启用状态差异写回 DB；返回 false 时调用方降级 localStorage。 */
async function saveEnabledToDb(
  configurableModels: AiModel[],
  previous: Set<string>,
  next: Set<string>,
): Promise<boolean> {
  const items = configurableModels
    .filter((m) => previous.has(m.value) !== next.has(m.value))
    .map((m) => ({ ...splitModelRef(m.value), enabled: next.has(m.value) }));
  if (items.length === 0) return true;
  try {
    const res = await fetch("/api/ai/model-preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function readLocalStorageEnabled(configurableModels: AiModel[], storageKey: string): Set<string> {
  const configurableIds = new Set(configurableModels.map((m) => m.value));
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (stored) {
      const parsedIds = JSON.parse(stored) as string[];
      return new Set(parsedIds.filter((id) => configurableIds.has(id)));
    }
  } catch (error) {
    console.error("Failed to load state from localStorage:", error);
  }
  return new Set(configurableIds);
}

function writeLocalStorageEnabled(ids: Set<string>, storageKey: string) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(Array.from(ids)));
  } catch (error) {
    console.error("Failed to save state to localStorage:", error);
  }
}

interface ModelSelectionProviderProps {
  children: ReactNode;
  configurableModels: AiModel[];
  initialModel?: string;
}

export function ModelSelectionProvider({
  children,
  configurableModels,
  initialModel = "",
}: ModelSelectionProviderProps) {
  const { status } = useSession();
  const isLoggedIn = status === "authenticated";

  const [selectedModel, setSelectedModel] = useState(initialModel);
  const [state, setState] = useState<ModelSelectionState>({
    selectedModelIds: new Set<string>(),
    isLoaded: false,
  });
  // DB 模式下记录最近一次已持久化的启用集，用于计算差异
  const persistedRef = useRef<Set<string>>(new Set());

  const storageKey = useMemo(() => {
    const modelHash = configurableModels.map((m) => m.value).sort().join(",");
    return `${SELECTED_MODELS_STORAGE_KEY_PREFIX}-${modelHash}`;
  }, [configurableModels]);

  // 加载：登录 → DB；否则 localStorage
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (isLoggedIn) {
        const dbEnabled = await loadEnabledFromDb(configurableModels);
        if (cancelled) return;
        if (dbEnabled) {
          persistedRef.current = dbEnabled;
          setState({ selectedModelIds: dbEnabled, isLoaded: true });
        } else {
          setState({
            selectedModelIds: readLocalStorageEnabled(configurableModels, storageKey),
            isLoaded: true,
          });
        }
      } else {
        setState({
          selectedModelIds: readLocalStorageEnabled(configurableModels, storageKey),
          isLoaded: true,
        });
      }
    };
    void load();

    return () => {
      cancelled = true;
    };
  }, [configurableModels, storageKey, isLoggedIn]);

  // selectedModel：保持 localStorage（设备级 UI 状态）
  /* eslint-disable react-hooks/set-state-in-effect -- 挂载时从 localStorage 初始化，与原实现同语义 */
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(SELECTED_MODEL_STORAGE_KEY);
      if (stored) {
        setSelectedModel(JSON.parse(stored) as string);
      } else if (initialModel) {
        setSelectedModel(initialModel);
      }
    } catch (error) {
      console.error("Failed to load selected model from localStorage:", error);
      if (initialModel) setSelectedModel(initialModel);
    }
    // 仅初始化一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!state.isLoaded) return;
    try {
      window.localStorage.setItem(
        SELECTED_MODEL_STORAGE_KEY,
        JSON.stringify(selectedModel)
      );
    } catch (error) {
      console.error("Failed to save selected model to localStorage:", error);
    }
  }, [selectedModel, state.isLoaded]);

  const applyNext = (next: Set<string>) => {
    const previous = state.selectedModelIds;
    setState((current) => ({ ...current, selectedModelIds: next }));

    if (isLoggedIn) {
      // DB 模式：写 DB；失败时降级写 localStorage
      void saveEnabledToDb(configurableModels, persistedRef.current, next).then((ok) => {
        if (ok) {
          persistedRef.current = next;
        } else {
          writeLocalStorageEnabled(next, storageKey);
        }
      });
    } else {
      writeLocalStorageEnabled(next, storageKey);
    }
    // previous 仅用于语义说明，不参与计算
    void previous;
  };

  const toggleModel = (modelId: string) => {
    const newSet = new Set(state.selectedModelIds);
    if (newSet.has(modelId)) {
      newSet.delete(modelId);
    } else {
      newSet.add(modelId);
    }
    applyNext(newSet);
  };

  const selectAll = () =>
    applyNext(new Set(configurableModels.map((m) => m.value)));
  const deselectAll = () => applyNext(new Set());
  const resetToDefault = () =>
    applyNext(new Set(configurableModels.map((m) => m.value)));

  const toggleProvider = (provider: string, shouldSelect: boolean) => {
    const providerModelIds = configurableModels
      .filter((m) => m.provider === provider)
      .map((m) => m.value);
    const newSet = new Set(state.selectedModelIds);
    if (shouldSelect) {
      providerModelIds.forEach((id) => newSet.add(id));
    } else {
      providerModelIds.forEach((id) => newSet.delete(id));
    }
    applyNext(newSet);
  };

  const toggleCategory = (
    provider: string,
    category: string,
    shouldSelect: boolean
  ) => {
    const categoryModelIds = configurableModels
      .filter(
        (m) => m.provider === provider && m.category === category
      )
      .map((m) => m.value);
    const newSet = new Set(state.selectedModelIds);
    if (shouldSelect) {
      categoryModelIds.forEach((id) => newSet.add(id));
    } else {
      categoryModelIds.forEach((id) => newSet.delete(id));
    }
    applyNext(newSet);
  };

  const selectedModels = useMemo(
    () =>
      configurableModels.filter((model) =>
        state.selectedModelIds.has(model.value)
      ),
    [configurableModels, state.selectedModelIds]
  );

  const contextValue: ModelSelectionContextType = {
    state,
    selectedModels,
    configurableModels,
    allModels: configurableModels,
    toggleModel,
    selectAll,
    deselectAll,
    resetToDefault,
    toggleProvider,
    toggleCategory,
    selectedModel,
    setSelectedModel,
  };

  return (
    <ModelSelectionContext.Provider value={contextValue}>
      {children}
    </ModelSelectionContext.Provider>
  );
}

export function useModelSelection(): ModelSelectionContextType {
  const context = useContext(ModelSelectionContext);
  if (!context) {
    throw new Error(
      "useModelSelection must be used within a ModelSelectionProvider"
    );
  }
  return context;
}
