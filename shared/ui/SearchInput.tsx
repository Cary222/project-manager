"use client";

import { IconSearch } from "@/shared/ui/icons";

type SearchInputProps = {
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  placeholder?: string;
  className?: string;
};

export function SearchInput({
  value,
  onChange,
  onFocus,
  onBlur,
  placeholder = "搜索…",
  className = "",
}: SearchInputProps) {
  return (
    <div className={`relative w-full ${className}`}>
      <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder={placeholder}
        className="w-full rounded-lg border border-ink-200 bg-ink-100 py-1.5 pl-10 pr-3 text-sm text-ink-900 outline-none transition placeholder:text-ink-400 hover:border-brand-200 hover:bg-white focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-100"
      />
    </div>
  );
}
