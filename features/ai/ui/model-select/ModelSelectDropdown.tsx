"use client";

import { useState, useMemo, useEffect } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/features/ai/ui/model-select/ui/select";
import type { AiModel } from "./types";
import { useModelSelection } from "./ModelSelectionContext";
import { ModelList } from "./ModelList";

function ModelSelectWithSettings({
  models,
  placeholder,
}: {
  models: AiModel[];
  placeholder?: string;
}) {
  const { state, selectedModels, selectedModel, setSelectedModel } =
    useModelSelection();

  const allProviders = useMemo(() => {
    return [...new Set(models.map((m) => m.provider))];
  }, [models]);

  useEffect(() => {
    if (state.isLoaded) {
      const isSelectedModelInList = selectedModels.some(
        (m) => m.value === selectedModel
      );
      if (!isSelectedModelInList && selectedModels.length > 0) {
        setSelectedModel(selectedModels[0].value);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModels, state.isLoaded, selectedModel]);

  const isLoading = !state.isLoaded;

  const selectedModelLabel =
    models.find((m) => m.value === selectedModel)?.model ?? placeholder;

  return (
    <Select value={selectedModel} onValueChange={setSelectedModel}>
      <SelectTrigger className="h-10 min-w-0 flex-1" aria-label="Select AI model">
        <SelectValue placeholder={isLoading ? "Loading..." : selectedModelLabel}>
          {isLoading ? "Loading..." : selectedModelLabel}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <ModelList models={selectedModels} />
      </SelectContent>
    </Select>
  );
}

export interface ModelSelectDropdownProps {
  models: AiModel[];
  settings?: boolean;
  placeholder?: string;
  className?: string;
}

export function ModelSelectDropdown({
  models,
  settings = false,
  placeholder = "Select a model...",
  className,
}: ModelSelectDropdownProps) {
  const { selectedModel, setSelectedModel, allModels } = useModelSelection();

  if (!settings) {
    const selectedModelLabel =
      allModels.find((m) => m.value === selectedModel)?.model ?? placeholder;

    return (
      <Select value={selectedModel} onValueChange={setSelectedModel}>
        <SelectTrigger
          className={`h-10 min-w-0 flex-1 ${className ?? ""}`}
          aria-label="Select AI model"
        >
          <SelectValue placeholder={selectedModelLabel}>
            {selectedModelLabel}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <ModelList models={allModels} />
        </SelectContent>
      </Select>
    );
  }

  return <ModelSelectWithSettings models={models} placeholder={placeholder} />;
}
