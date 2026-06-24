"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type RecentVisit = {
  projectId: string;
  projectName: string;
  tabKey: string;
  tabLabel: string;
  ticketId?: string;
  ticketTitle?: string;
  visitedAt: number;
};

export type FrequentEntry = {
  projectId: string;
  projectName: string;
  tabKey: string;
  tabLabel: string;
  ticketId?: string;
  ticketTitle?: string;
  count: number;
  lastVisitedAt: number;
};

type RecordInput = Omit<RecentVisit, "visitedAt">;

const STORAGE_KEY = "pm:recent-visits";
const MAX = 20;

const VisitsCtx = createContext<{
  visits: RecentVisit[];
  frequent: FrequentEntry[];
  record: (v: RecordInput) => void;
}>({ visits: [], frequent: [], record: () => {} });

function loadFromStorage(): RecentVisit[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as RecentVisit[]) : [];
  } catch {
    return [];
  }
}

function deduplicateKey(v: RecentVisit | RecordInput): string {
  return [v.projectId, v.tabKey, v.ticketId ?? ""].join("|");
}

function buildFrequent(visits: RecentVisit[]): FrequentEntry[] {
  const counts: Record<string, FrequentEntry> = {};
  for (const v of visits) {
    const key = deduplicateKey(v);
    if (counts[key]) {
      counts[key].count += 1;
      if (v.visitedAt > counts[key].lastVisitedAt) {
        counts[key].lastVisitedAt = v.visitedAt;
      }
    } else {
      counts[key] = {
        projectId: v.projectId,
        projectName: v.projectName,
        tabKey: v.tabKey,
        tabLabel: v.tabLabel,
        ticketId: v.ticketId,
        ticketTitle: v.ticketTitle,
        count: 1,
        lastVisitedAt: v.visitedAt,
      };
    }
  }
  return Object.values(counts).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return b.lastVisitedAt - a.lastVisitedAt;
  });
}

export function VisitsProvider({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const [visits, setVisits] = useState<RecentVisit[]>([]);

  useEffect(() => {
    setVisits(loadFromStorage());
    setMounted(true);
  }, []);

  const frequent = useMemo(() => buildFrequent(mounted ? visits : []), [visits, mounted]);

  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(visits));
  }, [visits, mounted]);

  const record = useCallback((v: RecordInput) => {
    const key = deduplicateKey(v);
    setVisits((prev) => {
      const idx = prev.findIndex((p) => deduplicateKey(p) === key);
      if (idx >= 0) {
        const hit = prev[idx];
        const rest = prev.filter((_, i) => i !== idx);
        return [{ ...hit, ...v, visitedAt: Date.now() }, ...rest];
      }
      return [{ ...v, visitedAt: Date.now() }, ...prev].slice(0, MAX);
    });
  }, []);

  return (
    <VisitsCtx.Provider value={{ visits: mounted ? visits : [], frequent, record }}>
      {children}
    </VisitsCtx.Provider>
  );
}

export function useRecentVisits() {
  const ctx = useContext(VisitsCtx);
  return { visits: ctx.visits, record: ctx.record };
}

export function useFrequentVisits() {
  return { frequent: useContext(VisitsCtx).frequent };
}
