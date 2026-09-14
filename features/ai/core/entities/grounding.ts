/**
 * Passive Entity Grounding — 被动实体对齐与消歧判定层。
 *
 * 核心架构原则：
 * 1. 被动触发：Entity Resolver 绝不允许从任意自然语言中自主创造实体。
 *    只有 Chat Decision / Work Plan 明确声明需要某实体，或者 Preprocessor 抽取出显式 @/# 时才做 Grounding。
 * 2. 搜索多重性 ≠ 人工交互（Search Ambiguity != Human Interaction）：
 *    只有在 entity.required && !hasConfidentWinner && ambiguityBlocksTask 时才触发 HIL。
 * 3. 明确赢家自决：高置信度唯一或首位领先优势明显时，自动采信最佳结果，不打断用户。
 */

import { prisma } from "@/shared/db/client";
import { resolveUser } from "../resolvers/user-resolver";
import type { ResolveResult } from "@/features/ai/types/structured";

export type EntityType = "user" | "project" | "ticket" | "commit" | "meeting";

export interface DeclaredEntity {
  type: EntityType;
  value: string;
  required?: boolean;
}

export interface GroundedEntity {
  id: string;
  name: string;
  type: EntityType;
  metadata?: Record<string, unknown>;
}

export interface CandidateEntity {
  id: string;
  label: string;
  summary?: string;
  matchScore: number;
}

export interface EntityGroundingResult {
  resolved: Partial<Record<EntityType, GroundedEntity>>;
  ambiguities: Array<{
    type: EntityType;
    query: string;
    candidates: CandidateEntity[];
    isTaskBlocking: boolean;
    reason: string;
  }>;
}

/**
 * 判定消歧是否真正阻塞了核心任务（Task-Blocking Ambiguity）
 */
export function isAmbiguityTaskBlocking(
  entityType: EntityType,
  required: boolean,
  contextQueryType?: string,
): boolean {
  // 只有当该实体是完成目标所必需的（例如“查刘工周报”必须明确刘工），且当前是在查该实体的专属数据时，才阻塞
  if (!required) return false;
  if (entityType === "user") {
    return contextQueryType === "user" || contextQueryType === "weekly_report";
  }
  if (entityType === "ticket") {
    return contextQueryType === "ticket";
  }
  return false;
}

/**
 * 被动实体对齐主函数
 */
export async function groundDeclaredEntities(
  declared: DeclaredEntity[],
  viewerUserId?: string,
  contextQueryType?: string,
): Promise<EntityGroundingResult> {
  const result: EntityGroundingResult = {
    resolved: {},
    ambiguities: [],
  };

  for (const entity of declared) {
    const rawVal = entity.value?.trim();
    if (!rawVal) continue;

    if (entity.type === "user") {
      const resolved = await resolveUser(
        { raw: rawVal, normalized: rawVal },
        viewerUserId,
      );
      if (resolved.user) {
        result.resolved.user = {
          id: resolved.user.id,
          name: resolved.user.name,
          type: "user",
        };
      } else if (resolved.candidates && resolved.candidates.length > 0) {
        const candidates: CandidateEntity[] = resolved.candidates.map((c) => ({
          id: c.id,
          label: `${c.name ?? c.id}（${c.email}）`,
          summary: "",
          matchScore: (c as { matchScore?: number }).matchScore ?? 1,
        }));

        // 检查是否有明显高置信度赢家（首位分高且领先第 2 位 ≥ 2 分）
        const hasConfidentWinner =
          candidates.length > 0 &&
          candidates[0].matchScore >= 4 &&
          (candidates.length === 1 ||
            candidates[0].matchScore - candidates[1].matchScore >= 2);

        if (hasConfidentWinner) {
          // 自动采信第一名，不打断会话
          result.resolved.user = {
            id: candidates[0].id,
            name: candidates[0].label,
            type: "user",
          };
        } else {
          // 无高置信赢家时，判断是否 Task-Blocking
          const isBlocking = isAmbiguityTaskBlocking(
            "user",
            Boolean(entity.required),
            contextQueryType,
          );
          result.ambiguities.push({
            type: "user",
            query: rawVal,
            candidates,
            isTaskBlocking: isBlocking,
            reason: `找到 ${candidates.length} 个与"${rawVal}"匹配的用户，需要人工确认`,
          });
        }
      }
    }

    if (entity.type === "ticket") {
      // 工单号精确匹配
      const numMatch = rawVal.match(/#?(\d+)/);
      if (numMatch) {
        const ticketNo = parseInt(numMatch[1], 10);
        const ticket = await prisma.ticket.findUnique({
          where: { ticketNo },
          select: { id: true, ticketNo: true, title: true, projectId: true },
        });
        if (ticket) {
          result.resolved.ticket = {
            id: ticket.id,
            name: `#${ticket.ticketNo} ${ticket.title}`,
            type: "ticket",
            metadata: {
              ticketNo: ticket.ticketNo,
              projectId: ticket.projectId,
            },
          };
        }
      }
    }

    if (entity.type === "project") {
      const p = await prisma.project.findFirst({
        where: { name: { equals: rawVal, mode: "insensitive" } },
        select: { id: true, name: true },
      });
      if (p) {
        result.resolved.project = {
          id: p.id,
          name: p.name,
          type: "project",
        };
      }
    }
  }

  return result;
}
