import { describe, expect, it, vi } from "vitest";
import { isAmbiguityTaskBlocking, groundDeclaredEntities } from "../grounding";

// Mock user resolver & prisma
vi.mock("@/features/ai/core/resolvers/user-resolver", () => ({
  resolveUser: vi.fn().mockImplementation(({ raw }) => {
    if (raw === "张伟") {
      return Promise.resolve({
        user: null,
        confidence: 0.5,
        candidates: [
          {
            id: "u-1",
            name: "张伟(后端)",
            email: "zw1@test.com",
            matchScore: 5,
          },
          {
            id: "u-2",
            name: "张伟(前端)",
            email: "zw2@test.com",
            matchScore: 2,
          },
        ],
      });
    }
    if (raw === "李四") {
      return Promise.resolve({
        user: { id: "u-4", name: "李四" },
        confidence: 1.0,
      });
    }
    return Promise.resolve({ user: null, confidence: 0 });
  }),
}));

vi.mock("@/shared/db/client", () => ({
  prisma: {
    user: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    ticket: {
      findUnique: vi.fn().mockImplementation(({ where }) => {
        if (where.ticketNo === 10208) {
          return Promise.resolve({
            id: "t-1",
            ticketNo: 10208,
            title: "重构登录逻辑",
            projectId: "p-1",
          });
        }
        return Promise.resolve(null);
      }),
    },
    project: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
  },
}));
describe("Passive Entity Grounding & Task-Blocking Ambiguity", () => {
  it("isAmbiguityTaskBlocking correctly identifies blocking scenarios", () => {
    expect(isAmbiguityTaskBlocking("user", true, "user")).toBe(true);
    expect(isAmbiguityTaskBlocking("user", true, "weekly_report")).toBe(true);
    // Exploratory or not required is NOT blocking
    expect(isAmbiguityTaskBlocking("user", false, "user")).toBe(false);
    expect(isAmbiguityTaskBlocking("user", true, "note")).toBe(false);
  });

  it("groundDeclaredEntities resolves exact user directly", async () => {
    const res = await groundDeclaredEntities([
      { type: "user", value: "李四", required: true },
    ]);
    expect(res.resolved.user?.id).toBe("u-4");
    expect(res.ambiguities).toHaveLength(0);
  });

  it("groundDeclaredEntities automatically picks confident winner when score gap >= 2", async () => {
    // 张伟 has matchScore 5 vs 2 -> gap 3 >= 2, confident winner
    const res = await groundDeclaredEntities([
      { type: "user", value: "张伟", required: true },
    ]);
    expect(res.resolved.user).toBeDefined();
    expect(res.resolved.user?.id).toBe("u-1");
    expect(res.ambiguities).toHaveLength(0);
  });

  it("groundDeclaredEntities grounds ticket by number", async () => {
    const res = await groundDeclaredEntities([
      { type: "ticket", value: "#10208", required: true },
    ]);
    expect(res.resolved.ticket?.id).toBe("t-1");
    expect(res.resolved.ticket?.name).toContain("#10208 重构登录逻辑");
  });
});
