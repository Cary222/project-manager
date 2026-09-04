import { describe, expect, it } from "vitest";
import {
  detectActivityWindow,
  resolveTemporalWindow,
  isImplicitTicketReference,
  isUserActivityQuery,
} from "../query-parser";

describe("query-parser Temporal and Coreference Resolution", () => {
  describe("detectActivityWindow", () => {
    it("should detect last_week correctly", () => {
      expect(detectActivityWindow("我上周干了什么")).toBe("last_week");
      expect(detectActivityWindow("上一周有哪些工单完成")).toBe("last_week");
      expect(detectActivityWindow("上礼拜的提交记录")).toBe("last_week");
    });

    it("should detect this_week and today correctly", () => {
      expect(detectActivityWindow("这周的项目进展")).toBe("this_week");
      expect(detectActivityWindow("今天做了什么")).toBe("today");
      expect(detectActivityWindow("昨天提交的 commit")).toBe("yesterday");
    });
  });

  describe("resolveTemporalWindow", () => {
    it("should resolve exact date boundaries for last_week and this_week", () => {
      // 2026-03-25 是周三
      const fixedNow = new Date(2026, 2, 25, 14, 30, 0); // 3月25日 14:30

      const lastWeek = resolveTemporalWindow("我上周干了什么", fixedNow);
      expect(lastWeek).toBeDefined();
      expect(lastWeek?.window).toBe("last_week");
      expect(lastWeek?.label).toBe("上周");

      // 2026-03-25(周三) 本周一为 03-23，上周一为 03-16，上周日为 03-22
      expect(lastWeek?.startTime.getFullYear()).toBe(2026);
      expect(lastWeek?.startTime.getMonth()).toBe(2);
      expect(lastWeek?.startTime.getDate()).toBe(16);
      expect(lastWeek?.startTime.getHours()).toBe(0);
      expect(lastWeek?.startTime.getMinutes()).toBe(0);

      // 上周末尾
      expect(lastWeek?.endTime.getDate()).toBe(22);
      expect(lastWeek?.endTime.getHours()).toBe(23);
      expect(lastWeek?.endTime.getMinutes()).toBe(59);

      const thisWeek = resolveTemporalWindow("本周有哪些进展", fixedNow);
      expect(thisWeek?.window).toBe("this_week");
      expect(thisWeek?.startTime.getDate()).toBe(23); // 本周一 03-23
    });
  });

  describe("isImplicitTicketReference", () => {
    it("should identify ticket coreferences", () => {
      expect(isImplicitTicketReference("这个工单是谁负责的")).toBe(true);
      expect(isImplicitTicketReference("该任务的状态是什么")).toBe(true);
      expect(isImplicitTicketReference("把它改成已完成")).toBe(true);
      expect(isImplicitTicketReference("针对该缺陷写修复代码")).toBe(true);
      expect(isImplicitTicketReference("今天天气怎么样")).toBe(false);
    });
  });

  describe("isUserActivityQuery", () => {
    it("should detect user activity and work reviews accurately", () => {
      expect(isUserActivityQuery("我上周干了什么")).toBe(true);
      expect(isUserActivityQuery("我上周做了什么")).toBe(true);
      expect(isUserActivityQuery("刘工这周在做什么")).toBe(true);
      expect(isUserActivityQuery("最近团队开发了什么")).toBe(true);
      expect(isUserActivityQuery("帮我看看代码报错")).toBe(false);
    });
  });
});
