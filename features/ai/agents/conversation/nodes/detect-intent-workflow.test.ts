import { describe, it, expect } from "vitest";
import { detectWorkflowMatch } from "./detect-intent";

describe("detectWorkflowMatch", () => {
  describe("weekly_report workflow", () => {
    it("should match weekly report creation requests", async () => {
      const match1 = await detectWorkflowMatch("帮我生成本周的周报");
      expect(match1).not.toBeNull();
      expect(match1?.type).toBe("weekly_report");

      const match2 = await detectWorkflowMatch("写一下这周周报");
      expect(match2).not.toBeNull();
      expect(match2?.type).toBe("weekly_report");

      const match3 = await detectWorkflowMatch("整理上周的工作汇报");
      expect(match3).not.toBeNull();
      expect(match3?.type).toBe("weekly_report");
    });
  });

  describe("project_progress workflow", () => {
    it("should match project progress requests", async () => {
      const match1 = await detectWorkflowMatch("帮我查看项目的进展大盘");
      expect(match1).not.toBeNull();
      expect(match1?.type).toBe("project_progress");

      const match2 = await detectWorkflowMatch("项目当前有什么最新进展");
      expect(match2).not.toBeNull();
      expect(match2?.type).toBe("project_progress");

      const match3 = await detectWorkflowMatch("汇总模块统计和进度");
      expect(match3).not.toBeNull();
      expect(match3?.type).toBe("project_progress");
    });
  });

  describe("meeting_minutes workflow", () => {
    it("should match meeting minutes requests", async () => {
      const match1 = await detectWorkflowMatch("帮我整理昨天的周会纪要");
      expect(match1).not.toBeNull();
      expect(match1?.type).toBe("meeting_minutes");

      const match2 = await detectWorkflowMatch("把会议录音文件转写并生成纪要");
      expect(match2).not.toBeNull();
      expect(match2?.type).toBe("meeting_minutes");
    });
  });

  describe("coding workflow", () => {
    it("should match coding task requests", async () => {
      const match1 = await detectWorkflowMatch("针对工单 #10123 编写代码");
      expect(match1).not.toBeNull();
      expect(match1?.type).toBe("coding");

      const match2 = await detectWorkflowMatch("帮我修复这个bug问题");
      expect(match2).not.toBeNull();
      expect(match2?.type).toBe("coding");

      const match3 = await detectWorkflowMatch("实现一个用户登录验证功能");
      expect(match3).not.toBeNull();
      expect(match3?.type).toBe("coding");
    });
  });

  describe("regular chat queries", () => {
    it("should return null for non-workflow chat queries", async () => {
      expect(await detectWorkflowMatch("今天深圳的天气怎么样？")).toBeNull();
      expect(await detectWorkflowMatch("Next.js 16 有哪些破坏性更新？")).toBeNull();
      expect(await detectWorkflowMatch("你好，介绍一下你自己")).toBeNull();
    });
  });
});
