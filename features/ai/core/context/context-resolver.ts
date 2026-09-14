/**
 * Unified Context Resolver — 全系统统一上下文解析器。
 *
 * 核心原则：
 * 1. 一次解析，多端共享：Chat / Work / Global Router 共享同一套上下文标准；
 * 2. 确定性 ACL：在解析期即计算好 DataScope，不把权限校验留给 Prompt；
 * 3. 事实提取：抽取显式 @人名、#工单号、URL、页面当前项目/工单，提供给上层决策器。
 */

import { prisma } from "@/shared/db/client";
import { resolveDataScope, type DataScope } from "../policy/data-scope";
import { extractId } from "../resolvers/query-parser";

export interface ExplicitMentions {
  ticketNumbers: number[];
  userMentions: string[];
  projectMentions: string[];
}

export interface InvocationContextInput {
  userId: string;
  role?: string | null;
  conversationId?: string | null;
  projectId?: string | null;
  ticketId?: string | null;
  pageContext?: Record<string, unknown> | null;
  attachments?: Array<{ id: string; url: string; name: string }>;
  message?: string;
  recentInputs?: string[];
}

export interface UnifiedContext {
  currentUser: {
    id: string;
    role: string;
    name?: string | null;
  };
  dataScope: DataScope;
  conversationId?: string | null;
  activeProject?: { id: string; name: string } | null;
  activeTicket?: {
    id: string;
    ticketNo: number;
    title: string;
    projectId: string;
  } | null;
  explicitMentions: ExplicitMentions;
  pageContext?: Record<string, unknown> | null;
  attachments: Array<{ id: string; url: string; name: string }>;
  recentInputs: string[];
}

/** 提取文本中的显式事实标记（@人名, #工单号） */
export function extractExplicitMentions(text: string): ExplicitMentions {
  const ticketNumbers: number[] = [];
  const userMentions: string[] = [];
  const projectMentions: string[] = [];

  if (!text) return { ticketNumbers, userMentions, projectMentions };

  // 1. #10208 工单匹配
  const ticketRegex = /#(\d+)/g;
  let match: RegExpExecArray | null;
  while ((match = ticketRegex.exec(text)) !== null) {
    const num = parseInt(match[1], 10);
    if (!isNaN(num)) ticketNumbers.push(num);
  }

  // 2. @人名 匹配
  const atRegex = /@([a-zA-Z0-9_\u4e00-\u9fa5]{1,20})/g;
  while ((match = atRegex.exec(text)) !== null) {
    userMentions.push(match[1]);
  }

  return {
    ticketNumbers: [...new Set(ticketNumbers)],
    userMentions: [...new Set(userMentions)],
    projectMentions: [...new Set(projectMentions)],
  };
}

/**
 * 统一解析调用上下文
 */
export async function resolveInvocationContext(
  input: InvocationContextInput,
): Promise<UnifiedContext> {
  const { userId, message = "", attachments = [], recentInputs = [] } = input;

  // 1. 获取用户信息与确定性权限
  let role = input.role;
  let name: string | null = null;
  if (!role || role === "USER") {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, name: true },
    });
    if (user) {
      role = user.role;
      name = user.name;
    }
  }

  const resolvedRole = role ?? "USER";
  const dataScope = await resolveDataScope(userId, resolvedRole);

  // 2. 提取显式事实标记
  const explicitMentions = extractExplicitMentions(message);

  // 如果 message 里有 #12345 但 input.ticketId 没传，自动把首个 ticketNo 补入事实
  const extractedTicketNo =
    explicitMentions.ticketNumbers[0] ??
    (extractId(message) ? parseInt(extractId(message)!, 10) : undefined);

  // 3. 校验并装配当前激活的项目
  let activeProject: { id: string; name: string } | null = null;
  if (input.projectId) {
    const p = await prisma.project.findUnique({
      where: { id: input.projectId },
      select: { id: true, name: true },
    });
    if (p) {
      if (
        dataScope.mode === "all_projects" ||
        dataScope.projectIds.includes(p.id)
      ) {
        activeProject = p;
      }
    }
  }

  // 4. 校验并装配当前激活的工单
  let activeTicket: {
    id: string;
    ticketNo: number;
    title: string;
    projectId: string;
  } | null = null;
  if (input.ticketId || extractedTicketNo) {
    const t = await prisma.ticket.findFirst({
      where: input.ticketId
        ? { id: input.ticketId }
        : { ticketNo: extractedTicketNo },
      select: { id: true, ticketNo: true, title: true, projectId: true },
    });
    if (t) {
      if (
        dataScope.mode === "all_projects" ||
        dataScope.projectIds.includes(t.projectId)
      ) {
        activeTicket = t;
        // 如果当前没有 activeProject，工单所属的项目也可以作为默认上下文
        if (!activeProject) {
          const p = await prisma.project.findUnique({
            where: { id: t.projectId },
            select: { id: true, name: true },
          });
          if (p) activeProject = p;
        }
      }
    }
  }

  return {
    currentUser: {
      id: userId,
      role: resolvedRole,
      name,
    },
    dataScope,
    conversationId: input.conversationId ?? null,
    activeProject,
    activeTicket,
    explicitMentions,
    pageContext: input.pageContext ?? null,
    attachments,
    recentInputs,
  };
}
