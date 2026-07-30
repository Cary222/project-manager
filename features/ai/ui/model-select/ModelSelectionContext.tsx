"use client";

import React, {
  createContext,
  useContext,
  useReducer,
  useEffect,
  ReactNode,
  useMemo,
  useState,
} from "react";
import type { AiModel } from "./types";

interface ModelSelectionState {
  selectedModelIds: Set<string>;
  isLoaded: boolean;
}

type ModelSelectionAction =
  | { type: "INITIALIZE"; selectedIds: string[] }
  | { type: "TOGGLE_MODEL"; modelId: string }
  | { type: "SELECT_ALL_MODELS" }
  | { type: "DESELECT_ALL_MODELS" }
  | { type: "RESET_TO_DEFAULT" }
  | { type: "TOGGLE_PROVIDER"; provider: string; shouldSelect: boolean }
  | {
      type: "TOGGLE_CATEGORY";
      provider: string;
      category: string;
      shouldSelect: boolean;
    };

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

function modelSelectionReducer(
  state: ModelSelectionState,
  action: ModelSelectionAction,
  configurableModels: AiModel[]
): ModelSelectionState {
  switch (action.type) {
    case "INITIALIZE":
      return {
        selectedModelIds: new Set(action.selectedIds),
        isLoaded: true,
      };

    case "TOGGLE_MODEL": {
      const newSet = new Set(state.selectedModelIds);
      if (newSet.has(action.modelId)) {
        newSet.delete(action.modelId);
      } else {
        newSet.add(action.modelId);
      }
      return {
        ...state,
        selectedModelIds: newSet,
      };
    }

    case "SELECT_ALL_MODELS":
      return {
        ...state,
        selectedModelIds: new Set(configurableModels.map((m) => m.value)),
      };

    case "DESELECT_ALL_MODELS":
      return {
        ...state,
        selectedModelIds: new Set(),
      };

    case "RESET_TO_DEFAULT":
      return {
        ...state,
        selectedModelIds: new Set(configurableModels.map((m) => m.value)),
      };

    case "TOGGLE_PROVIDER": {
      const providerModelIds = configurableModels
        .filter((m) => m.provider === action.provider)
        .map((m) => m.value);
      const newSet = new Set(state.selectedModelIds);
      if (action.shouldSelect) {
        providerModelIds.forEach((id) => newSet.add(id));
      } else {
        providerModelIds.forEach((id) => newSet.delete(id));
      }
      return { ...state, selectedModelIds: newSet };
    }

    case "TOGGLE_CATEGORY": {
      const categoryModelIds = configurableModels
        .filter(
          (m) => m.provider === action.provider && m.category === action.category
        )
        .map((m) => m.value);
      const newSet = new Set(state.selectedModelIds);
      if (action.shouldSelect) {
        categoryModelIds.forEach((id) => newSet.add(id));
      } else {
        categoryModelIds.forEach((id) => newSet.delete(id));
      }
      return { ...state, selectedModelIds: newSet };
    }

    default:
      return state;
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
  const [selectedModel, setSelectedModel] = useState(initialModel);

  const storageKey = useMemo(() => {
    const modelHash = configurableModels.map((m) => m.value).sort().join(",");
    return `${SELECTED_MODELS_STORAGE_KEY_PREFIX}-${modelHash}`;
  }, [configurableModels]);

  const reducerWithConfig = (
    state: ModelSelectionState,
    action: ModelSelectionAction
  ) => modelSelectionReducer(state, action, configurableModels);

  const [state, dispatch] = useReducer(reducerWithConfig, {
    selectedModelIds: new Set<string>(),
    isLoaded: false,
  });

  useEffect(() => {
    try {
      // Load which models are selected for the dropdown
      const stored = localStorage.getItem(storageKey);
      const configurableModelIds = new Set(
        configurableModels.map((m) => m.value)
      );

      if (stored) {
        const parsedIds = JSON.parse(stored) as string[];
        const validIds = parsedIds.filter((id) =>
          configurableModelIds.has(id)
        );
        dispatch({ type: "INITIALIZE", selectedIds: validIds });
      } else {
        const defaultIds = Array.from(configurableModelIds);
        dispatch({ type: "INITIALIZE", selectedIds: defaultIds });
      }

      // Load the currently selected model
      const storedModel = localStorage.getItem(SELECTED_MODEL_STORAGE_KEY);
      if (storedModel) {
        setSelectedModel(JSON.parse(storedModel));
      } else if (initialModel) {
        setSelectedModel(initialModel);
      }
    } catch (error) {
      console.error("Failed to load state from localStorage:", error);
      const defaultIds = configurableModels.map((model) => model.value);
      dispatch({ type: "INITIALIZE", selectedIds: defaultIds });
      if (initialModel) setSelectedModel(initialModel);
    }
  }, [configurableModels, storageKey, initialModel]);

  useEffect(() => {
    if (state.isLoaded) {
      try {
        // Save which models are selected for the dropdown
        const ids = Array.from(state.selectedModelIds);
        localStorage.setItem(storageKey, JSON.stringify(ids));

        // Save the currently selected model
        localStorage.setItem(
          SELECTED_MODEL_STORAGE_KEY,
          JSON.stringify(selectedModel)
        );
      } catch (error) {
        console.error("Failed to save state to localStorage:", error);
      }
    }
  }, [state.selectedModelIds, selectedModel, state.isLoaded, storageKey]);

  const selectedModels = useMemo(
    () =>
      configurableModels.filter((model) =>
        state.selectedModelIds.has(model.value)
      ),
    [configurableModels, state.selectedModelIds]
  );

  const toggleModel = (modelId: string) =>
    dispatch({ type: "TOGGLE_MODEL", modelId });
  const selectAll = () => dispatch({ type: "SELECT_ALL_MODELS" });
  const deselectAll = () => dispatch({ type: "DESELECT_ALL_MODELS" });
  const resetToDefault = () => dispatch({ type: "RESET_TO_DEFAULT" });
  const toggleProvider = (provider: string, shouldSelect: boolean) =>
    dispatch({ type: "TOGGLE_PROVIDER", provider, shouldSelect });
  const toggleCategory = (
    provider: string,
    category: string,
    shouldSelect: boolean
  ) =>
    dispatch({ type: "TOGGLE_CATEGORY", provider, category, shouldSelect });

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
