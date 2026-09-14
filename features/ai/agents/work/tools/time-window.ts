/**
 * Work 业务查询的时间窗口解析。
 *
 * 项目统一用北京时间（Asia/Shanghai）作为业务日历基准
 * （见 features/weekly-reports/lib/week.ts、features/ai/runtime/scheduler.ts）。
 * 这里只补一个 week.ts 没有的自然月窗口，不改动周报既有 runtime。
 *
 * 关键语义：「上个月延期」= TicketStatusHistory.createdAt 落在
 * 上月北京自然月 [1日00:00, 月末23:59:59.999] 且 status=OVERDUE。
 * 这是历史事实，跟 Ticket.status 当前值无关。
 */

export const WORK_TIMEZONE = "Asia/Shanghai";

export interface TimeWindow {
  since: Date;
  until: Date;
  /** 给 UI/报告展示的人类可读标签。 */
  label: string;
  /** 窗口来源，报告里要如实标注。 */
  source: "monthOffset" | "explicit" | "unbounded";
}

/** en-CA 固定输出 YYYY-MM-DD，规避各 OS locale 顺序差异（与 week.ts 一致）。 */
function beijingParts(reference: Date): {
  year: number;
  month: number;
  day: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: WORK_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(reference);
  const lookup = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
  };
}

/** 北京时间 YYYY-MM-DD HH → UTC Date（UTC+8，所以减 8 小时）。 */
function beijingToUtc(
  year: number,
  month: number,
  day: number,
  hour = 0,
): Date {
  return new Date(Date.UTC(year, month - 1, day, hour - 8, 0, 0, 0));
}

/**
 * 相对自然月窗口。offset=0 → 本月，offset=1 → 上月。
 * month=12 时自动进位到下一年 1 月（Date.UTC 原生处理）。
 */
export function getMonthRangeByOffset(
  offset: number,
  now: Date = new Date(),
): TimeWindow {
  const { year, month } = beijingParts(now);
  const total = year * 12 + (month - 1) - offset;
  const startYear = Math.floor(total / 12);
  const startMonth = (total % 12) + 1;

  const since = beijingToUtc(startYear, startMonth, 1, 0);
  // 下月 1 日 00:00 再减 1ms = 本月末 23:59:59.999
  const nextTotal = total + 1;
  const until = new Date(
    beijingToUtc(
      Math.floor(nextTotal / 12),
      (nextTotal % 12) + 1,
      1,
      0,
    ).getTime() - 1,
  );

  return {
    since,
    until,
    label: `${startYear}年${startMonth}月（${WORK_TIMEZONE}）`,
    source: "monthOffset",
  };
}

/** 解析用户给的显式日期；接受 YYYY-MM-DD 或完整 ISO。无效返回 null，不猜。 */
function parseDate(value: string, endOfDay: boolean): Date | null {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    const startOfDay = beijingToUtc(Number(y), Number(m), Number(d), 0);
    if (!endOfDay) return startOfDay;
    // 当日最后一毫秒 = 次日 00:00 北京 - 1ms。
    // 不能只把 hour 设成 23 —— 那会得到 23:00:00.000，
    // 静默丢掉当日最后 59 分 59.999 秒的数据（统计会少算）。
    return new Date(beijingToUtc(Number(y), Number(m), Number(d) + 1, 0).getTime() - 1);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export interface TimeWindowInput {
  monthOffset?: number;
  since?: string;
  until?: string;
}

export type TimeWindowResult =
  | { ok: true; window: TimeWindow }
  | { ok: false; error: string };

/**
 * 把结构化时间入参解析成窗口。
 * 无效日期 = 硬错误回喂 LLM，绝不静默退化成"全时间"（那会让统计结果撒谎）。
 */
export function resolveTimeWindow(
  input: TimeWindowInput,
  now: Date = new Date(),
): TimeWindowResult {
  if (input.monthOffset !== undefined) {
    return { ok: true, window: getMonthRangeByOffset(input.monthOffset, now) };
  }

  if (input.since === undefined && input.until === undefined) {
    return {
      ok: true,
      window: {
        since: new Date(0),
        until: now,
        label: "全部时间（未限定范围）",
        source: "unbounded",
      },
    };
  }

  const since = input.since ? parseDate(input.since, false) : new Date(0);
  const until = input.until ? parseDate(input.until, true) : now;
  if (!since || !until) {
    return {
      ok: false,
      error: `日期无法解析: since=${input.since ?? "-"} until=${input.until ?? "-"}（需 YYYY-MM-DD 或 ISO 时间戳）`,
    };
  }
  if (since.getTime() > until.getTime()) {
    return { ok: false, error: "since 晚于 until" };
  }

  return {
    ok: true,
    window: {
      since,
      until,
      label: `${input.since ?? "起始"} ~ ${input.until ?? "至今"}（${WORK_TIMEZONE}）`,
      source: "explicit",
    },
  };
}
