"use client";

import { useState, useRef, useEffect } from "react";

export function useScrollToProvider(sortedProviderEntries: [string, unknown][]) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const providerRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const [providerToScrollTo, setProviderToScrollTo] = useState<string | null>(
    null
  );

  useEffect(() => {
    if (providerToScrollTo) {
      const node = providerRefs.current.get(providerToScrollTo);
      if (node) {
        node.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }
      setProviderToScrollTo(null);
    }
  }, [providerToScrollTo, sortedProviderEntries]);

  const getProviderRef = (provider: string) => (node: HTMLDivElement | null) => {
    if (node) {
      providerRefs.current.set(provider, node);
    } else {
      providerRefs.current.delete(provider);
    }
  };

  return {
    scrollContainerRef,
    setProviderToScrollTo,
    getProviderRef,
  };
}
