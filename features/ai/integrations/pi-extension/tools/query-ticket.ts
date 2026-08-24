/**
 * query_ticket Tool
 *
 * ProjectHub 业务工具：查询工单信息
 * Phase 4: Pi Extension 业务工具注册
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { prisma } from "@/shared/db/client";

export const queryTicketTool = tool(
  async ({ ticketNo }) => {
    try {
      const ticket = await prisma.ticket.findUnique({
        where: { ticketNo },
        select: {
          id: true,
          ticketNo: true,
          title: true,
          description: true,
          status: true,
          priority: true,
          progress: true,
          projectId: true,
          moduleId: true,
          creatorId: true,
          deadline: true,
          createdAt: true,
          updatedAt: true,
          // 关联查询
          project: {
            select: {
              id: true,
              name: true,
            },
          },
          module: {
            select: {
              id: true,
              name: true,
            },
          },
          creator: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          // 当前指派的用户
          assignees: {
            select: {
              userId: true,
              createdAt: true,
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
            },
          },
          // 状态历史
          statusHistory: {
            select: {
              status: true,
              changedById: true,
              createdAt: true,
              changedBy: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
            orderBy: { createdAt: "desc" },
            take: 5,
          },
          // 指派历史
          assigneeHistory: {
            select: {
              assigneeIds: true,
              changedById: true,
              createdAt: true,
            },
            orderBy: { createdAt: "desc" },
            take: 5,
          },
          // 关联提交
          commits: {
            select: {
              commitSha: true,
              author: true,
              subject: true,
              committedAt: true,
            },
            orderBy: { committedAt: "desc" },
            take: 10,
          },
        },
      });

      if (!ticket) {
        return {
          success: false,
          error: `Ticket #${ticketNo} not found`,
        };
      }

      return {
        success: true,
        data: ticket,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[queryTicketTool] Error:", message);
      return {
        success: false,
        error: `Failed to query ticket: ${message}`,
      };
    }
  },
  {
    name: "query_ticket",
    description: `【精确查询 - 工单详情查询】

查询工单的完整信息，包括状态历史、指派记录、关联提交等。

输入参数：
- ticketNo：工单号（必填）

返回字段：
- 基础信息：ticketNo, title, description, status, priority, progress
- 关联信息：project, module, creator
- 当前指派：assignees（数组）
- 状态历史：statusHistory（最近 5 条）
- 指派历史：assigneeHistory（最近 5 条）
- 关联提交：commits（最近 10 条）

适用场景：
- 工单详情查看
- 周报生成：获取工单描述和进展
- 代码审查：查看工单关联的提交`,
    schema: z.object({
      ticketNo: z.number().describe("工单号"),
    }),
  }
);
