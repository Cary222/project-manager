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

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  agnes: "Agnes",
  deepseek: "DeepSeek",
  openai: "OpenAI",
  anthropic: "Anthropic",
  groq: "Groq",
  openrouter: "OpenRouter",
  together: "Together AI",
};

function ModelGroupLabel({
  provider,
  ownerType,
}: {
  provider: string;
  ownerType?: "SYSTEM" | "USER";
}) {
  const displayName = PROVIDER_DISPLAY_NAMES[provider] ?? provider;
  return (
    <div className="flex items-center gap-2 py-1.5 pl-3 pr-2">
      <span className="text-xs font-medium uppercase tracking-wide text-ink-400">
        {displayName}
      </span>
      {ownerType === "SYSTEM" && (
        <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-medium text-ink-600">
          平台
        </span>
      )}
    </div>
  );
}

export function ModelList({ models }: { models: AiModel[] }) {
  const groupedModels = useMemo(() => {
    return models.reduce(
      (acc, model) => {
        if (!acc[model.provider]) {
          acc[model.provider] = [];
        }
        acc[model.provider].push(model);
        return acc;
      },
      {} as Record<string, AiModel[]>
    );
  }, [models]);

  if (Object.keys(groupedModels).length === 0) {
    return (
      <div className="px-2 py-6 text-center text-sm text-ink-400">
        No models available to display.
      </div>
    );
  }

  return (
    <>
      {Object.entries(groupedModels).map(([provider, providerModels]) => (
        <SelectGroup key={provider}>
          <ModelGroupLabel
            provider={provider}
            ownerType={providerModels[0]?.ownerType}
          />
          {providerModels.map((model) => (
            <SelectItem key={model.value} value={model.value}>
              {model.model}
            </SelectItem>
          ))}
        </SelectGroup>
      ))}
    </>
  );
}

function SelectGroup({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="[&_*]:text-ink-900">{children}</div>;
}

export interface TinyModelSelectorProps {
  placeholder?: string;
  className?: string;
  value?: string;
  onValueChange?: (modelValue: string) => void;
  useGlobalState?: boolean;
}

export function TinyModelSelector({
  placeholder = "Select Model",
  className,
  value,
  onValueChange,
  useGlobalState = true,
}: TinyModelSelectorProps) {
  const {
    selectedModel: globalSelectedModel,
    setSelectedModel: setGlobalSelectedModel,
    selectedModels,
    allModels,
    state,
  } = useModelSelection();

  const [localSelectedModel, setLocalSelectedModel] = useState("");

  const isControlledByProps = value !== undefined && onValueChange !== undefined;
  const isUsingGlobalState = useGlobalState && !isControlledByProps;

  const currentModel = isControlledByProps
    ? value
    : isUsingGlobalState
      ? globalSelectedModel
      : localSelectedModel;

  const handleModelChange = (modelValue: string) => {
    if (isControlledByProps) {
      onValueChange?.(modelValue);
    } else if (isUsingGlobalState) {
      setGlobalSelectedModel(modelValue);
    } else {
      setLocalSelectedModel(modelValue);
    }
  };

  useEffect(() => {
    if (
      !isUsingGlobalState &&
      !isControlledByProps &&
      selectedModels.length > 0 &&
      !localSelectedModel
    ) {
      setLocalSelectedModel(selectedModels[0].value);
    }
  }, [selectedModels, localSelectedModel, isUsingGlobalState, isControlledByProps]);

  const isLoading = !state.isLoaded;

  const selectedModelLabel =
    allModels.find((m) => m.value === currentModel)?.model || placeholder;

  return (
    <Select value={currentModel} onValueChange={handleModelChange}>
      <SelectTrigger
        className={`w-52 ${className ?? ""}`}
        aria-label="Select AI model"
      >
        <SelectValue placeholder={isLoading ? "..." : selectedModelLabel} />
      </SelectTrigger>
      <SelectContent>
        <ModelList models={selectedModels} />
      </SelectContent>
    </Select>
  );
}
