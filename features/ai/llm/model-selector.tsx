"use client";
import useSWR from "swr";
import { useState } from "react";
import type { ModelCatalogEntry } from "./providers/types";
import { IconChevronDown } from "@/shared/ui/icons";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface ModelSelectorProps {
  value: string;
  onChange: (modelRef: string) => void;
}

export function ModelSelector({ value, onChange }: ModelSelectorProps) {
  const { data } = useSWR<{ data: ModelCatalogEntry[] }>("/api/ai/models", fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
  });
  const models = data?.data ?? [];
  const [open, setOpen] = useState(false);
  const current = models.find((m) => m.modelRef === value);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 rounded-lg border border-ink-200 bg-white px-2 py-1 text-xs font-medium text-ink-700 hover:bg-ink-50"
      >
        <span>{current?.displayName ?? "选择模型"}</span>
        <IconChevronDown className="h-3 w-3" />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-xl border border-ink-200 bg-white py-1 shadow-base">
            {models.map((model) => (
              <button
                key={model.modelRef}
                onClick={() => {
                  onChange(model.modelRef);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-ink-50 ${
                  model.modelRef === value
                    ? "bg-brand-50 text-brand-700"
                    : "text-ink-700"
                }`}
              >
                <span>{model.displayName}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
