import { describe, expect, it } from "vitest";
import { decideGlobalMode } from "../global-mode-router";

describe("Global Mode Router", () => {
  it("fast-path routes greetings and meta questions to chat", async () => {
    const greetings = ["你好", "您好", "在吗", "介绍一下你自己", "你能做什么"];
    for (const g of greetings) {
      const res = await decideGlobalMode(g);
      expect(res.route).toBe("chat");
      expect(res.goalType).toBe("informational");
      expect(res.requiresExecution).toBe(false);
    }
  });

  it("fast-path routes pure question patterns without action verbs to chat", async () => {
    const questions = [
      "#10208 是什么问题？",
      "张工本周在做什么？",
      "周报是什么格式？",
      "这个项目现在有哪些风险？",
    ];
    for (const q of questions) {
      const res = await decideGlobalMode(q);
      expect(res.route).toBe("chat");
      expect(res.requiresExecution).toBe(false);
    }
  });

  it("extracts ticketNo and user facts into extractedEntities", async () => {
    const res = await decideGlobalMode("请问 #10208 是谁负责的？");
    expect(res.route).toBe("chat");
    expect(res.extractedEntities?.ticketNo).toBe("10208");
  });

  it("routes explicit delivery and execution goals to work", async () => {
    const workGoals = [
      "生成本周周报",
      "提交这份周报",
      "修改 #10208 对应代码",
      "批量更新这些工单状态",
    ];
    for (const g of workGoals) {
      const res = await decideGlobalMode(g);
      expect(["work", "chat_then_offer_work"]).toContain(res.route);
      expect(res.requiresExecution).toBe(true);
    }
  });

  it("in chat mode, stays conservative and does not force work without high confidence", async () => {
    const res = await decideGlobalMode("想了解一下周报汇总的情况", {
      currentRoute: "chat",
    });
    expect(res.route).toBe("chat");
  });
});
