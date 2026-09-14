import { describe, expect, it } from "vitest";
import {
  getMonthRangeByOffset,
  resolveTimeWindow,
  WORK_TIMEZONE,
} from "./time-window";

/** 构造一个"北京日历时间"对应的 UTC Date（北京 = UTC+8）。 */
function beijing(y: number, m: number, d: number, h = 12): Date {
  return new Date(Date.UTC(y, m - 1, d, h - 8, 0, 0, 0));
}

describe("getMonthRangeByOffset", () => {
  it("offset=0 是本月，边界按北京时间对齐", () => {
    const w = getMonthRangeByOffset(0, beijing(2026, 3, 15));
    // 2026-03-01 00:00 北京 == 2026-02-28T16:00Z
    expect(w.since.toISOString()).toBe("2026-02-28T16:00:00.000Z");
    // 2026-04-01 00:00 北京 - 1ms == 2026-03-31T15:59:59.999Z
    expect(w.until.toISOString()).toBe("2026-03-31T15:59:59.999Z");
    expect(w.label).toContain("2026年3月");
    expect(w.source).toBe("monthOffset");
  });

  it("offset=1 是上月（「上个月延期」的语义基础）", () => {
    const w = getMonthRangeByOffset(1, beijing(2026, 3, 15));
    expect(w.since.toISOString()).toBe("2026-01-31T16:00:00.000Z");
    expect(w.until.toISOString()).toBe("2026-02-28T15:59:59.999Z");
    expect(w.label).toContain("2026年2月");
  });

  it("跨年：1 月的上个月是去年 12 月", () => {
    const w = getMonthRangeByOffset(1, beijing(2026, 1, 15));
    expect(w.label).toContain("2025年12月");
    expect(w.since.toISOString()).toBe("2025-11-30T16:00:00.000Z");
    expect(w.until.toISOString()).toBe("2025-12-31T15:59:59.999Z");
  });

  it("闰年 2 月取到 29 日", () => {
    const w = getMonthRangeByOffset(0, beijing(2028, 2, 10)); // 2028 是闰年
    expect(w.until.toISOString()).toBe("2028-02-29T15:59:59.999Z");
  });

  it("平年 2 月取到 28 日", () => {
    const w = getMonthRangeByOffset(0, beijing(2026, 2, 10));
    expect(w.until.toISOString()).toBe("2026-02-28T15:59:59.999Z");
  });

  it("until 恰好是窗口最后一毫秒，不泄漏下月第一条", () => {
    const feb = getMonthRangeByOffset(1, beijing(2026, 3, 15));
    const mar = getMonthRangeByOffset(0, beijing(2026, 3, 15));
    // 相邻两个月必须首尾相接，无空隙无重叠
    expect(mar.since.getTime() - feb.until.getTime()).toBe(1);
  });

  it("时区标注为 Asia/Shanghai", () => {
    expect(getMonthRangeByOffset(0, beijing(2026, 6, 1)).label).toContain(
      WORK_TIMEZONE,
    );
  });
});

describe("resolveTimeWindow", () => {
  const now = beijing(2026, 3, 15);

  it("monthOffset 优先于未给出的显式日期", () => {
    const r = resolveTimeWindow({ monthOffset: 1 }, now);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.window.source).toBe("monthOffset");
  });

  it("未给任何时间范围 → 显式标记 unbounded，不假装是精确范围", () => {
    const r = resolveTimeWindow({}, now);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.window.source).toBe("unbounded");
      expect(r.window.label).toContain("未限定");
      expect(r.window.until.getTime()).toBe(now.getTime());
    }
  });

  it("显式日期按北京时间解释，until 取当日 23:59:59.999", () => {
    const r = resolveTimeWindow(
      { since: "2026-03-01", until: "2026-03-05" },
      now,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.window.since.toISOString()).toBe("2026-02-28T16:00:00.000Z");
      expect(r.window.until.toISOString()).toBe("2026-03-05T15:59:59.999Z");
      expect(r.window.source).toBe("explicit");
    }
  });

  it("非法日期是硬错误，绝不静默退化成全时间（否则统计会撒谎）", () => {
    const r = resolveTimeWindow({ since: "去年三月" }, now);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("无法解析");
  });

  it("since 晚于 until 报错", () => {
    const r = resolveTimeWindow(
      { since: "2026-03-10", until: "2026-03-01" },
      now,
    );
    expect(r.ok).toBe(false);
  });
});
