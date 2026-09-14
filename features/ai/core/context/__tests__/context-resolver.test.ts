import { describe, expect, it, vi } from "vitest";
import {
  extractExplicitMentions,
  resolveInvocationContext,
} from "../context-resolver";

// Mock DB
vi.mock("@/shared/db/client", () => ({
  prisma: {
    user: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ id: "u-1", role: "USER", name: "张三" }),
    },
    userOnProject: {
      findMany: vi.fn().mockResolvedValue([{ projectId: "proj-1" }]),
    },
    project: {
      findMany: vi.fn().mockResolvedValue([{ id: "proj-1" }, { id: "proj-2" }]),
      findUnique: vi.fn().mockImplementation(({ where }) => {
        if (where.id === "proj-1")
          return Promise.resolve({ id: "proj-1", name: "项目一" });
        if (where.id === "proj-secret")
          return Promise.resolve({ id: "proj-secret", name: "绝密项目" });
        return Promise.resolve(null);
      }),
    },
    ticket: {
      findFirst: vi.fn().mockImplementation(({ where }) => {
        if (where.ticketNo === 10208) {
          return Promise.resolve({
            id: "t-1",
            ticketNo: 10208,
            title: "修复报错",
            projectId: "proj-1",
          });
        }
        if (where.ticketNo === 99999) {
          return Promise.resolve({
            id: "t-secret",
            ticketNo: 99999,
            title: "秘密工单",
            projectId: "proj-secret",
          });
        }
        return Promise.resolve(null);
      }),
    },
  },
}));

describe("Unified Context Resolver", () => {
  it("extractExplicitMentions extracts #ticket and @user correctly", () => {
    const text =
      "请问 @刘工，工单 #10208 和 #10209 目前进展如何？另外抄送 @王经理";
    const res = extractExplicitMentions(text);
    expect(res.ticketNumbers).toEqual([10208, 10209]);
    expect(res.userMentions).toEqual(["刘工", "王经理"]);
  });

  it("extractExplicitMentions returns empty arrays for plain text", () => {
    const text = "你好，今天深圳天气怎么样";
    const res = extractExplicitMentions(text);
    expect(res.ticketNumbers).toEqual([]);
    expect(res.userMentions).toEqual([]);
  });

  it("resolveInvocationContext attaches dataScope and active entities for accessible resources", async () => {
    const ctx = await resolveInvocationContext({
      userId: "u-1",
      role: "USER",
      message: "查看工单 #10208 的最新进展",
      projectId: "proj-1",
    });

    expect(ctx.currentUser.id).toBe("u-1");
    expect(ctx.currentUser.role).toBe("USER");
    expect(ctx.dataScope.mode).toBe("member_projects");
    expect(ctx.dataScope.projectIds).toContain("proj-1");
    expect(ctx.activeProject?.id).toBe("proj-1");
    expect(ctx.activeTicket?.ticketNo).toBe(10208);
    expect(ctx.explicitMentions.ticketNumbers).toContain(10208);
  });

  it("resolveInvocationContext denies active entity attachment when resource is out of dataScope", async () => {
    const ctx = await resolveInvocationContext({
      userId: "u-1",
      role: "USER",
      message: "查看工单 #99999",
      projectId: "proj-secret",
    });

    // proj-secret is not in user's dataScope
    expect(ctx.activeProject).toBeNull();
    expect(ctx.activeTicket).toBeNull();
    // But explicit mention is preserved as fact
    expect(ctx.explicitMentions.ticketNumbers).toContain(99999);
  });
});
