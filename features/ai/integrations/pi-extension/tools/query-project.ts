/**
 * query_project Tool
 *
 * ProjectHub 业务工具：查询项目信息
 * Phase 4: Pi Extension 业务工具注册
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { prisma } from "@/shared/db/client";

export const queryProjectTool = tool(
  async ({ projectId, fields }) => {
    try {
      // 构建 select 对象
      const select: Record<string, unknown> = {
        id: true,
        name: true,
        description: true,
        ownerId: true,
        createdAt: true,
        updatedAt: true,
      };

      // 根据 fields 动态添加关联查询
      if (fields?.includes("tickets")) {
        select.tickets = {
          select: {
            id: true,
            ticketNo: true,
            title: true,
            status: true,
            priority: true,
            assigneeId: true,
          },
          orderBy: { createdAt: "desc" as const },
          take: 50,
        };
      }

      if (fields?.includes("members")) {
        select.members = {
          select: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
            role: true,
          },
        };
      }

      if (fields?.includes("modules")) {
        select.modules = {
          select: {
            id: true,
            name: true,
            description: true,
          },
        };
      }

      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select,
      });

      if (!project) {
        return {
          success: false,
          error: "Project not found",
          projectId,
        };
      }

      return {
        success: true,
        data: project,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[queryProjectTool] Error:", message);
      return {
        success: false,
        error: `Failed to query project: ${message}`,
        projectId,
      };
    }
  },
  {
    name: "query_project",
    description: `【精确查询 - 项目信息查询】

查询指定项目的详细信息，支持关联查询（工单、成员、模块）。

输入参数：
- projectId：项目 ID（必填）
- fields：可选，要查询的关联字段 ['tickets', 'members', 'modules']

返回字段：
- id：项目 ID
- name：项目名称
- description：项目描述
- ownerId：所有者 ID
- createdAt：创建时间

适用场景：
- 查询项目基本信息
- 查询项目下的工单列表
- 查询项目成员及角色
- 查询项目模块列表`,
    schema: z.object({
      projectId: z.string().describe("项目 ID"),
      fields: z
        .array(z.enum(["tickets", "members", "modules"]))
        .optional()
        .describe("要查询的关联字段"),
    }),
  }
);
