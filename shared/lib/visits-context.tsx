"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export type RecentVisit = {
  projectId: string;
  projectName: string;
  tabKey: string;
  tabLabel: string;
  ticketId?: string;
  ticketNo?: number;
  ticketTitle?: string;
  visitedAt: number;
};

export type FrequentEntry = {
  projectId: string;
  projectName: string;
  tabKey: string;
  tabLabel: string;
  ticketId?: string;
  ticketNo?: number;
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

function loadFromStorage(): { visits: RecentVisit[]; counts: Record<string, number> } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      return { visits: data.visits ?? [], counts: data.counts ?? {} };
    }
    return { visits: [], counts: {} };
  } catch {
    return { visits: [], counts: {} };
  }
}

function deduplicateKey(v: RecentVisit | RecordInput): string {
  return [v.projectId, v.tabKey, v.ticketId ?? ""].join("|");
}

function buildFrequent(
  visits: RecentVisit[],
  counts: Record<string, number>
): FrequentEntry[] {
  const map: Record<string, FrequentEntry> = {};
  for (const v of visits) {
    const key = deduplicateKey(v);
    if (!map[key]) {
      map[key] = {
        projectId: v.projectId,
        projectName: v.projectName,
        tabKey: v.tabKey,
        tabLabel: v.tabLabel,
        ticketId: v.ticketId,
        ticketNo: v.ticketNo,
        ticketTitle: v.ticketTitle,
        count: counts[key] ?? 1,
        lastVisitedAt: v.visitedAt,
      };
    } else if (v.visitedAt > map[key].lastVisitedAt) {
      map[key].lastVisitedAt = v.visitedAt;
    }
  }
  return Object.values(map).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return b.lastVisitedAt - a.lastVisitedAt;
  });
}

export function VisitsProvider({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const [visits, setVisits] = useState<RecentVisit[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const lastRecordRef = useRef<{ key: string; time: number } | null>(null);
  const DEBOUNCE_MS = 2000;

  useEffect(() => {
    const data = loadFromStorage();
    setVisits(data.visits);
    setCounts(data.counts);
    setMounted(true);
  }, []);

  const frequent = useMemo(
    () => buildFrequent(mounted ? visits : [], mounted ? counts : {}),
    [visits, counts, mounted]
  );

  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ visits, counts }));
  }, [visits, counts, mounted]);

  const record = useCallback(
    (v: RecordInput) => {
      const key = deduplicateKey(v);
      const now = Date.now();
      if (lastRecordRef.current?.key === key && now - lastRecordRef.current.time < DEBOUNCE_MS) {
        return;
      }
      lastRecordRef.current = { key, time: now };
      setCounts((prev) => ({ ...prev, [key]: (prev[key] ?? 0) + 1 }));
      setVisits((prev) => {
        const idx = prev.findIndex((p) => deduplicateKey(p) === key);
        if (idx >= 0) {
          const hit = prev[idx];
          const rest = prev.filter((_, i) => i !== idx);
          return [{ ...hit, ...v, visitedAt: now }, ...rest];
        }
        return [{ ...v, visitedAt: now }, ...prev].slice(0, MAX);
      });
    },
    []
  );

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
