/**
 * query_commits Tool
 *
 * ProjectHub 业务工具：查询 Git 提交记录
 * Phase 4: Pi Extension 业务工具注册
 * 
 * 注意：使用 TicketCommit 表（schema 中的实际表名）
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { prisma } from "@/shared/db/client";

export const queryCommitsTool = tool(
  async ({ ticketNo, limit = 20 }) => {
    try {
      const commits = await prisma.ticketCommit.findMany({
        where: ticketNo ? { ticketNo } : undefined,
        orderBy: { committedAt: "desc" },
        take: Math.min(limit, 100),
        select: {
          id: true,
          ticketNo: true,
          repoPath: true,
          commitSha: true,
          author: true,
          committedAt: true,
          subject: true,
          branches: true,
          createdAt: true,
        },
      });

      return {
        success: true,
        count: commits.length,
        data: commits.map((commit) => ({
          id: commit.id,
          ticketNo: commit.ticketNo,
          sha: commit.commitSha,
          message: commit.subject,
          author: commit.author,
          repoPath: commit.repoPath,
          branches: commit.branches,
          committedAt: commit.committedAt,
          createdAt: commit.createdAt,
        })),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[queryCommitsTool] Error:", message);
      return {
        success: false,
        error: `Failed to query commits: ${message}`,
      };
    }
  },
  {
    name: "query_commits",
    description: `【精确查询 - Git 提交记录查询】

查询工单关联的 Git 提交记录，用于周报生成等工作场景。

输入参数：
- ticketNo：工单号（可选，不填返回所有提交）
- limit：返回数量（默认 20，最大 100）

返回字段：
- id：提交记录 ID
- ticketNo：关联工单号
- sha：Git SHA
- message：提交信息
- author：提交者名称
- repoPath：仓库路径
- branches：关联分支列表
- committedAt：提交时间

适用场景：
- 周报生成：查询某个工单的所有提交
- 代码审查：查看某个工单关联的提交历史`,
    schema: z.object({
      ticketNo: z.number().optional().describe("工单号"),
      limit: z.number().default(20).describe("返回数量限制"),
    }),
  }
);
