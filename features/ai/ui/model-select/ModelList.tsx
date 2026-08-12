"use client";

import { useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/features/ai/ui/model-select/ui/select";
import type { AiModel } from "./types";
import { useModelSelection } from "./ModelSelectionContext";
import { useModelGrouping } from "./useModelGrouping";
import {
  getProviderDisplayName,
  CATEGORY_CONFIG,
} from "./model-labels";

function CategoryHeader({ category }: { category: string }) {
  const config = CATEGORY_CONFIG[category] ?? { label: category, icon: "📦" };
  return (
    <div className="flex items-center gap-1.5 py-1.5 pl-3 pr-2">
      <span className="text-xs">{config.icon}</span>
      <span className="text-xs font-medium uppercase tracking-wide text-ink-400">
        {config.label}
      </span>
    </div>
  );
}

function TierHeader({ tier }: { tier: string }) {
  const config = CATEGORY_CONFIG[tier] ?? { label: tier, icon: "📦" };
  return (
    <div className="flex items-center gap-1.5 py-1 pl-6 pr-2">
      <span className="text-xs">{config.icon}</span>
      <span className="text-xs font-medium text-ink-400">{config.label}</span>
    </div>
  );
}

function ProviderHeader({ provider, ownerType }: { provider: string; ownerType?: string }) {
  return (
    <div className="flex items-center gap-2 py-1 pl-6 pr-2">
      <span className="text-xs font-medium uppercase tracking-wide text-ink-400">
        {getProviderDisplayName(provider)}
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
  const { groupedModels } = useModelGrouping(models);

  if (groupedModels.length === 0) {
    return (
      <div className="px-2 py-6 text-center text-sm text-ink-400">
        暂无可用模型
      </div>
    );
  }

  return (
    <>
      {groupedModels.map(({ category, groups }) => (
        <SelectGroup key={category}>
          <CategoryHeader category={category} />
          {groups.map((group) => (
            <div key={group.key}>
              {category === "chat" ? (
                <TierHeader tier={group.key} />
              ) : (
                <ProviderHeader
                  provider={group.key}
                  ownerType={group.models[0]?.ownerType}
                />
              )}
              {group.models.map((model) => (
                <SelectItem key={model.value} value={model.value}>
                  {model.model}
                </SelectItem>
              ))}
            </div>
          ))}
        </SelectGroup>
      ))}
    </>
  );
}

export interface TinyModelSelectorProps {
  placeholder?: string;
  className?: string;
  value?: string;
  onValueChange?: (modelValue: string) => void;
  useGlobalState?: boolean;
}

export function TinyModelSelector({
  placeholder = "选择模型",
  className,
  value,
  onValueChange,
  useGlobalState = true,
}: TinyModelSelectorProps) {
  const { selectedModel, setSelectedModel, selectedModels, allModels, state } =
    useModelSelection();

  const [localSelectedModel, setLocalSelectedModel] = useState("");

  const isControlledByProps = value !== undefined && onValueChange !== undefined;
  const isUsingGlobalState = useGlobalState && !isControlledByProps;

  const currentModel = isControlledByProps
    ? value
    : isUsingGlobalState
      ? selectedModel
      : localSelectedModel;

  const handleModelChange = (modelValue: string) => {
    if (isControlledByProps) {
      onValueChange?.(modelValue);
    } else if (isUsingGlobalState) {
      setSelectedModel(modelValue);
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
        aria-label="选择 AI 模型"
      >
        <SelectValue placeholder={isLoading ? "..." : selectedModelLabel} />
      </SelectTrigger>
      <SelectContent>
        <ModelList models={selectedModels} />
      </SelectContent>
    </Select>
  );
}
