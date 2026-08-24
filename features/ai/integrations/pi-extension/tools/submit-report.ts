/**
 * submit_report Tool
 *
 * ProjectHub 业务工具：提交周报
 * Phase 4: Pi Extension 业务工具注册
 * 
 * 注意：WeeklyReport 使用 weekStart/weekEnd 而非 year/weekNumber
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { prisma } from "@/shared/db/client";

/**
 * 计算周开始和结束日期
 */
function getWeekRange(weekNumber?: number, year?: number): { weekStart: Date; weekEnd: Date } {
  const now = new Date();
  const targetYear = year || now.getFullYear();
  
  if (weekNumber) {
    // 计算指定周的开始日期（ISO 8601 周）
    const jan4 = new Date(targetYear, 0, 4);
    const dayOfWeek = jan4.getDay() || 7;
    const weekStart = new Date(jan4);
    weekStart.setDate(jan4.getDate() - dayOfWeek + 1 + (weekNumber - 1) * 7);
    
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);
    
    return { weekStart, weekEnd };
  } else {
    // 使用当前周
    const dayOfWeek = now.getDay() || 7;
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - dayOfWeek + 1);
    weekStart.setHours(0, 0, 0, 0);
    
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);
    
    return { weekStart, weekEnd };
  }
}

export const submitReportTool = tool(
  async ({ userId, title, content, weekNumber, year, projectIds }) => {
    try {
      const { weekStart, weekEnd } = getWeekRange(weekNumber, year);

      // 检查是否已存在该周的周报
      const existing = await prisma.weeklyReport.findUnique({
        where: {
          userId_weekStart: {
            userId,
            weekStart,
          },
        },
      });

      let report: any;

      if (existing) {
        // 更新现有周报
        report = await prisma.weeklyReport.update({
          where: { id: existing.id },
          data: {
            title,
            content,
            updatedAt: new Date(),
          },
        });

        // 更新项目关联
        if (projectIds && projectIds.length > 0) {
          // 删除旧的关联
          await prisma.weeklyReportProject.deleteMany({
            where: { reportId: report.id },
          });

          // 创建新的关联
          await prisma.weeklyReportProject.createMany({
            data: projectIds.map((projectId) => ({
              reportId: report.id,
              projectId,
            })),
          });
        }

        return {
          success: true,
          data: report,
          message: "Weekly report updated successfully",
          isUpdate: true,
        };
      } else {
        // 创建新周报
        report = await prisma.weeklyReport.create({
          data: {
            userId,
            weekStart,
            weekEnd,
            title,
            content,
          },
        });

        // 创建项目关联
        if (projectIds && projectIds.length > 0) {
          await prisma.weeklyReportProject.createMany({
            data: projectIds.map((projectId) => ({
              reportId: report.id,
              projectId,
            })),
          });
        }

        return {
          success: true,
          data: report,
          message: "Weekly report created successfully",
          isUpdate: false,
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[submitReportTool] Error:", message);
      return {
        success: false,
        error: `Failed to submit report: ${message}`,
      };
    }
  },
  {
    name: "submit_report",
    description: `【写入操作 - 提交周报】

将周报内容写入数据库，支持创建和更新操作。

输入参数：
- userId：用户 ID（必填）
- title：周报标题（必填）
- content：周报内容（必填，支持 Markdown）
- weekNumber：周数（可选，默认当前周）
- year：年份（可选，默认当前年）
- projectIds：关联项目 ID 列表（可选）

返回字段：
- success：操作是否成功
- data：周报数据
- message：操作结果消息
- isUpdate：是否为更新操作

注意事项：
- 同一用户在同一周只能有一份周报
- 如果该周已存在周报，会自动更新
- 支持关联多个项目`,
    schema: z.object({
      userId: z.string().describe("用户 ID"),
      title: z.string().describe("周报标题"),
      content: z.string().describe("周报内容（Markdown 格式）"),
      weekNumber: z.number().optional().describe("周数（1-53）"),
      year: z.number().optional().describe("年份"),
      projectIds: z.array(z.string()).optional().describe("关联项目 ID 列表"),
    }),
  }
);
