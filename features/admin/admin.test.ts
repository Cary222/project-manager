/**
 * actions/admin.test.ts — 用户管理 action 的单元测试
 *
 * 学习目标：
 * 1. 理解 AAA 模式（Arrange-Act-Assert）
 * 2. 学会用 vi.mock() 伪造依赖，让测试隔离
 * 3. 理解 describe / it / expect 的作用
 *
 * 每段注释对应一个知识点，边读边理解。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TicketStatus, UserRole } from "@prisma/client";

// ============================================================
// 第一步：Mock 所有外部依赖
// ============================================================
// action 函数依赖：
//   - requireRoot()（检查权限，返回一个 mock session）
//   - prisma（数据库操作）
//   - createModerationLog（写审计日志）
//   - revalidatePath（清除 Next.js 缓存）
//
// 这些都不是我们要测的内容，所以全部伪造。
// vi.mock() 的特点：只在这一批测试里有效，不影响真实代码。
vi.mock("@/shared/lib/permissions", () => ({
  // requireRoot() 返回一个 mock session，包含 id / name / role
  requireRoot: vi.fn(() =>
    Promise.resolve({
      user: { id: "admin-001", name: "测试管理员", role: UserRole.ROOT },
    })
  ),
  requireSession: vi.fn(() =>
    Promise.resolve({
      user: { id: "admin-001", name: "测试管理员", role: UserRole.ROOT },
    })
  ),
}));

vi.mock("@/shared/db/client", () => ({
  prisma: {
    // mock 一个 users 表
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    // mock 一个 tickets 表
    ticket: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/features/admin/moderation", () => ({
  createModerationLog: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// ============================================================
// 第二步：导入要测试的 action
// ============================================================
// 注意：必须在这里导入，而不是文件顶部
// 因为 vi.mock() 需要在 import 之前执行
// （vitest 会自动提升 mock，所以可以写在导入之前）
import {
  getUserByIdAction,
  getUserTicketsAction,
  getUsersAction,
  updateUserRoleAction,
  banUserAction,
  unbanUserAction,
} from "./admin";

// ============================================================
// 第三步：每个测试前重置 mock 状态
// ============================================================
// beforeEach 在每个 it() 运行前都会执行一次
// 作用：清空 vi.fn() 的调用记录，防止测试之间互相影响
beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// 测试开始
// ============================================================

/**
 * getUserByIdAction 的测试
 * 测试场景：
 *   1. 传入一个存在的用户 ID → 应返回用户对象
 *   2. 传入一个不存在的用户 ID → 应返回 null
 */
describe("getUserByIdAction", () => {
  it("存在的用户返回用户对象", async () => {
    // Arrange：准备 mock 数据
    // 让 prisma.user.findUnique 返回一个预设的用户
    const mockUser = {
      id: "user-123",
      name: "张三",
      email: "zhangsan@example.com",
      role: UserRole.USER,
      bannedAt: null,
      createdAt: new Date("2026-01-01"),
    };
    const { prisma } = await import("@/shared/db/client");
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as never);

    // Act：调用 action
    const result = await getUserByIdAction("user-123");

    // Assert：验证结果
    expect(result).not.toBeNull();          // 返回值不为 null
    expect(result?.name).toBe("张三");      // name 字段正确
    expect(result?.role).toBe(UserRole.USER); // role 字段正确
  });

  it("不存在的用户返回 null", async () => {
    // Arrange：让 findUnique 返回 null，模拟"找不到"
    const { prisma } = await import("@/shared/db/client");
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    // Act
    const result = await getUserByIdAction("not-exist-id");

    // Assert
    expect(result).toBeNull();
  });
});

/**
 * getUserTicketsAction 的测试
 * 测试场景：
 *   1. 无筛选条件 → 返回该用户所有单子
 *   2. 带 status 筛选 → 只返回对应状态的单子
 */
describe("getUserTicketsAction", () => {
  it("返回该用户所有单子（无筛选）", async () => {
    const mockTickets = [
      {
        id: "t-1",
        ticketNo: 10001,
        title: "修复登录页样式",
        status: TicketStatus.DEVELOPING,
        project: { id: "p-1", name: "PM 系统" },
        module: { name: "前端", responsibility: { kind: "PROGRAM" } },
      },
      {
        id: "t-2",
        ticketNo: 10002,
        title: "完成文档",
        status: TicketStatus.DONE,
        project: { id: "p-1", name: "PM 系统" },
        module: { name: "文档", responsibility: { kind: "DESIGN" } },
      },
    ];
    const { prisma } = await import("@/shared/db/client");
    vi.mocked(prisma.ticket.findMany).mockResolvedValue(mockTickets as never);

    const result = await getUserTicketsAction("user-123");

    expect(result).toHaveLength(2);
    expect(result[0].ticketNo).toBe(10001);
    expect(result[1].status).toBe(TicketStatus.DONE);
  });

  it("带 status 筛选只返回对应状态的单子", async () => {
    const { prisma } = await import("@/shared/db/client");
    vi.mocked(prisma.ticket.findMany).mockResolvedValue([]);

    await getUserTicketsAction("user-123", TicketStatus.DEVELOPING);

    // 验证 findMany 被调用时传入了 status 条件
    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: TicketStatus.DEVELOPING }),
      })
    );
  });
});

/**
 * getUsersAction 的测试（分页 + 搜索）
 * 测试场景：
 *   1. 无参数 → 返回第一页用户列表
 *   2. 带搜索词 → 返回匹配 name 或 email 的用户
 *   3. 带有 role 筛选 → 只返回对应角色的用户
 */
describe("getUsersAction", () => {
  beforeEach(async () => {
    const { prisma } = await import("@/shared/db/client");
    vi.mocked(prisma.user.findMany).mockResolvedValue([]);
    vi.mocked(prisma.user.count).mockResolvedValue(0);
  });

  it("无参数时默认第一页，每页 20 条", async () => {
    const { prisma } = await import("@/shared/db/client");
    await getUsersAction();

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 20 })
    );
  });

  it("带搜索词时按 name 或 email 过滤", async () => {
    const { prisma } = await import("@/shared/db/client");
    await getUsersAction({ search: "张三" });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.any(Array),
        }),
      })
    );
  });

  it("带 role 参数时按角色过滤", async () => {
    const { prisma } = await import("@/shared/db/client");
    await getUsersAction({ role: UserRole.ROOT });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ role: UserRole.ROOT }),
      })
    );
  });

  it("返回 { users, total } 结构", async () => {
    const mockUsers = [{ id: "u1", name: "张三", email: "a@b.com", role: UserRole.USER, bannedAt: null, createdAt: new Date() }];
    const { prisma } = await import("@/shared/db/client");
    vi.mocked(prisma.user.findMany).mockResolvedValue(mockUsers as never);
    vi.mocked(prisma.user.count).mockResolvedValue(1);

    const result = await getUsersAction();

    expect(result).toHaveProperty("users");
    expect(result).toHaveProperty("total");
    expect(result.total).toBe(1);
  });
});

/**
 * updateUserRoleAction 的测试
 * 测试场景：
 *   1. 正常修改角色 → 返回 success: true
 *   2. 修改自己 → 返回错误"不能修改自己的角色"
 *   3. 目标用户不存在 → 返回错误"用户不存在"
 */
describe("updateUserRoleAction", () => {
  beforeEach(async () => {
    const { prisma } = await import("@/shared/db/client");
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "target-user",
      name: "目标用户",
      email: "target@example.com",
      role: UserRole.USER,
      bannedAt: null,
      createdAt: new Date(),
    } as never);
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);
  });

  it("正常修改角色返回 success: true", async () => {
    const result = await updateUserRoleAction("target-user", UserRole.ROOT);
    expect(result).toEqual({ success: true });
  });

  it("修改自己的角色返回错误", async () => {
    // 注意：requireRoot mock 返回的 session.user.id 是 "admin-001"
    const result = await updateUserRoleAction("admin-001", UserRole.USER);
    expect(result).toEqual({ error: "不能修改自己的角色" });
  });

  it("目标用户不存在返回错误", async () => {
    const { prisma } = await import("@/shared/db/client");
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    const result = await updateUserRoleAction("not-exist", UserRole.ROOT);
    expect(result).toEqual({ error: "用户不存在" });
  });
});

/**
 * banUserAction 的测试
 * 测试场景：
 *   1. 正常封禁 → 返回 success: true
 *   2. 封禁自己 → 返回错误
 *   3. 封禁 ROOT 用户 → 返回错误
 *   4. 重复封禁 → 返回错误"该用户已被封禁"
 */
describe("banUserAction", () => {
  beforeEach(async () => {
    const { prisma } = await import("@/shared/db/client");
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "target-user",
      name: "目标用户",
      email: "target@example.com",
      role: UserRole.USER,
      bannedAt: null,
      createdAt: new Date(),
    } as never);
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);
  });

  it("正常封禁返回 success: true", async () => {
    const result = await banUserAction("target-user", "违规发言");
    expect(result).toEqual({ success: true });
  });

  it("封禁自己返回错误", async () => {
    const result = await banUserAction("admin-001");
    expect(result).toEqual({ error: "不能封禁自己" });
  });

  it("封禁 ROOT 用户返回错误", async () => {
    const { prisma } = await import("@/shared/db/client");
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "root-user",
      name: "ROOT",
      email: "root@example.com",
      role: UserRole.ROOT,
      bannedAt: null,
      createdAt: new Date(),
    } as never);

    const result = await banUserAction("root-user");
    expect(result).toEqual({ error: "不能封禁 ROOT 用户" });
  });

  it("重复封禁返回错误", async () => {
    const { prisma } = await import("@/shared/db/client");
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "target-user",
      name: "目标用户",
      email: "target@example.com",
      role: UserRole.USER,
      bannedAt: new Date(),   // 已有 bannedAt，表示已被封禁
      createdAt: new Date(),
    } as never);

    const result = await banUserAction("target-user");
    expect(result).toEqual({ error: "该用户已被封禁" });
  });
});

/**
 * unbanUserAction 的测试
 * 测试场景：
 *   1. 正常解封 → 返回 success: true
 *   2. 解封自己 → 返回错误
 *   3. 解封未封禁的用户 → 返回错误
 */
describe("unbanUserAction", () => {
  beforeEach(async () => {
    const { prisma } = await import("@/shared/db/client");
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "banned-user",
      name: "已封禁用户",
      email: "banned@example.com",
      role: UserRole.USER,
      bannedAt: new Date(),   // 已封禁状态
      createdAt: new Date(),
    } as never);
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);
  });

  it("正常解封返回 success: true", async () => {
    const result = await unbanUserAction("banned-user");
    expect(result).toEqual({ success: true });
  });

  it("解封自己返回错误", async () => {
    const result = await unbanUserAction("admin-001");
    expect(result).toEqual({ error: "不能解封自己" });
  });

  it("解封未封禁的用户返回错误", async () => {
    const { prisma } = await import("@/shared/db/client");
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "normal-user",
      name: "正常用户",
      email: "normal@example.com",
      role: UserRole.USER,
      bannedAt: null,   // 未封禁
      createdAt: new Date(),
    } as never);

    const result = await unbanUserAction("normal-user");
    expect(result).toEqual({ error: "该用户未被封禁" });
  });
});
