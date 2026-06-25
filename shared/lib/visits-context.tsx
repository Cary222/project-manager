"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ACTION } from "@/shared/lib/events/ACTION";
import { trackEventBeacon } from "@/shared/lib/events/track";

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
/** 默认停留时长：进入页后停留超过这个毫秒数才算一次"浏览"并计入常用。 */
const DEFAULT_DWELL_MS = 5000;
/** tabKey 视为"子级页面"（笔记/工单详情）的标识，用于覆盖同项目的 tab 记录。 */
const DETAIL_TAB_KEYS = new Set(["note", "ticket"]);

const VisitsCtx = createContext<{
  visits: RecentVisit[];
  frequent: FrequentEntry[];
  record: (v: RecordInput) => void;
  scheduleRecord: (v: RecordInput, delayMs?: number) => void;
  recordImmediate: (v: RecordInput) => void;
}>({
  visits: [],
  frequent: [],
  record: () => {},
  scheduleRecord: () => {},
  recordImmediate: () => {},
});

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
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 记录当前 pending timer 对应的 key，用于去重：相同 key 不重复开 timer。 */
  const pendingKeyRef = useRef<string>("");
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

  // 卸载时清理 pending timer，避免组件被卸载后仍然写入
  useEffect(() => {
    return () => {
      if (pendingTimerRef.current) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
    };
  }, []);

  /**
   * 立即写入一次最近访问（不计次）。
   * 当记录属于"子级页面"（笔记/工单详情）时，会把同一 projectId 下所有非子级的旧记录
   * 整体移除，让详情页直接占据顶部、不再被更早的概览/tab 记录顶下去。
   */
  const recordImmediate = useCallback((v: RecordInput) => {
    const key = deduplicateKey(v);
    const now = Date.now();
    lastRecordRef.current = { key, time: now };
    setVisits((prev) => {
      const isDetail = DETAIL_TAB_KEYS.has(v.tabKey);
      const filtered = isDetail
        ? prev.filter((p) => p.projectId !== v.projectId || DETAIL_TAB_KEYS.has(p.tabKey))
        : prev;
      const idx = filtered.findIndex((p) => deduplicateKey(p) === key);
      if (idx >= 0) {
        const hit = filtered[idx];
        const rest = filtered.filter((_, i) => i !== idx);
        return [{ ...hit, ...v, visitedAt: now }, ...rest];
      }
      return [{ ...v, visitedAt: now }, ...filtered].slice(0, MAX);
    });
  }, []);

  /**
   * 写入最近访问 + 计入"常用"次数 + 上报 page.view 事件。
   * 仅在 scheduleRecord 的停留 timer 触发时调用。
   *
   * 事件追踪位置选这里的原因：
   * 1. timer 触发 = 用户已真实停留 delayMs，是「有效访问」的精确信号
   * 2. dwellMs 用实际 delayMs（而非硬编码 5000），保证与调用者预期一致
   * 3. sendBeacon 在 page.view 场景下兼容即将到来的页面切换（清零之前发出去）
   */
  const _recordWithCount = useCallback(
    (v: RecordInput, dwellMs: number) => {
      const key = deduplicateKey(v);
      setCounts((prev) => ({ ...prev, [key]: (prev[key] ?? 0) + 1 }));
      recordImmediate(v);

      const enterAt = Date.now() - dwellMs;
      const leaveAt = Date.now();
      trackEventBeacon({
        action: ACTION.PAGE_VIEW,
        targetType: v.tabKey,
        targetId: v.ticketId ?? v.projectId,
        targetName: v.ticketTitle ?? v.projectName,
        context: { dwellMs, enterAt, leaveAt },
      });
    },
    [recordImmediate]
  );

  /**
   * 延迟写入：用户必须在页面上停留 delayMs 毫秒才会真正落库并计次。
   * 每次重新调度会 clear 上一次未触发的 timer，因此快速切换不会留下历史噪声。
   * 相同 key 的重复调用不会重新开 timer，避免父子组件同时 mount 时计次翻倍。
   */
  const scheduleRecord = useCallback(
    (v: RecordInput, delayMs: number = DEFAULT_DWELL_MS) => {
      const key = deduplicateKey(v);
      if (pendingKeyRef.current === key) return;
      if (pendingTimerRef.current) {
        clearTimeout(pendingTimerRef.current);
      }
      pendingKeyRef.current = key;
      pendingTimerRef.current = setTimeout(() => {
        pendingTimerRef.current = null;
        pendingKeyRef.current = "";
        _recordWithCount(v, delayMs);
      }, delayMs);
    },
    [_recordWithCount]
  );

  /**
   * @deprecated 请改用 scheduleRecord（停留计次）或 recordImmediate（快速导航）。
   * 效果等价于 scheduleRecord(input, DEFAULT_DWELL_MS)，直接计次。
   */
  const record = useCallback(
    (v: RecordInput) => {
      _recordWithCount(v, DEFAULT_DWELL_MS);
    },
    [_recordWithCount]
  );

  return (
    <VisitsCtx.Provider
      value={{
        visits: mounted ? visits : [],
        frequent,
        record,
        scheduleRecord,
        recordImmediate,
      }}
    >
      {children}
    </VisitsCtx.Provider>
  );
}

export function useRecentVisits() {
  const ctx = useContext(VisitsCtx);
  return {
    visits: ctx.visits,
    record: ctx.record,
    scheduleRecord: ctx.scheduleRecord,
    recordImmediate: ctx.recordImmediate,
  };
}

export function useFrequentVisits() {
  return { frequent: useContext(VisitsCtx).frequent };
}
