/**
 * searchStructured LangGraph Node
 *
 * 职责：复用 core，复用 query-parser，不通过工具层调用
 * - 直接调用 executeStructuredQuery() 核心逻辑
 * - ambiguous 类型处理已移到 decision 节点（本节点不再触发 HIL）
 * - 与 tools/search-structured.ts 共用同一套 formatters 和 resolvers
 */

import type { AgentState } from "../agent";
import { executeStructuredQuery } from "@/features/ai/core/search-structured-core";
import { setSearchStructuredViewer } from "@/features/ai/tools/search-structured";
import { extractUserIdentifier, extractId, detectActivityWindow } from "@/features/ai/core/resolvers/query-parser";
import type { QueryType } from "@/features/ai/core/resolvers/query-parser";

/**
 * Inject runtime context into module-scoped closures.
 * Must be called before the tool executes.
 */
export function injectSearchStructuredContext(viewerUserId: string) {
  setSearchStructuredViewer(viewerUserId);
}

// ---------------------------------------------------------------------------
// Graph Node
// ---------------------------------------------------------------------------

/**
 * Wraps the core searchStructured logic as a graph node.
 * Executes structured DB queries (tickets, projects, users, commits, reports).
 *
 * Decision protocol:
 *   - Tool returns { decision: { type: "human", candidates: [...] } } when
 *     result count exceeds the per-entity threshold.
 *   - Node detects this and sets pendingHumanAction, pausing for human input.
 *   - Otherwise returns normal search results and proceeds to generateResponse.
 */
export async function searchStructuredNode(
  state: AgentState
): Promise<Partial<AgentState>> {
  const lastMessage = state.messages[state.messages.length - 1];
  if (!lastMessage) return {};

  const content =
    typeof lastMessage.content === "string"
      ? lastMessage.content
      : "";

  // Read original query type:
  // 1. resolvedEntities.originalQuery (set by humanConfirmationNode after disambiguation,
  //    survives across rounds since pendingHumanAction is cleared here)
  // 2. pendingHumanAction.sourceResult.queryType (from disambiguateIntent node)
  // 3. re-parse from content
  const resolvedOriginalQuery = state.resolvedEntities?.originalQuery;
  const savedQueryType = state.resolvedEntities?.originalQueryType
    ?? (state.pendingHumanAction?.sourceResult as { queryType?: string } | undefined)?.queryType;

  console.log(`[searchStructuredNode] pendingHumanAction=${state.pendingHumanAction ? "exists" : "null"} sourceResultQueryType=${(state.pendingHumanAction?.sourceResult as { queryType?: string } | undefined)?.queryType ?? "none"} resolvedEntities.originalQueryType=${state.resolvedEntities?.originalQueryType ?? "none"} savedQueryType=${savedQueryType ?? "none"} content="${content}"`);

  try {
    const resolvedUser = state.resolvedEntities?.user;
    const resolvedWeeklyReport = state.resolvedEntities?.weekly_report;
    const resolvedTicket = state.resolvedEntities?.ticket;
    const resolvedProject = state.resolvedEntities?.project;

    // Pending confirmation was set by the first disambiguation round.
    // originalQuery = pendingHumanAction.query = original user query (e.g. "刘工的周报有哪些")
    const effectiveQuery = state.originalQuery || content;

    let queryType: "ticket" | "project" | "user" | "commit" | "weekly_report";
    let filters: Record<string, unknown> | undefined;
    let queryText: string;

    if (resolvedUser) {
      // After disambiguation: use the original query (not the selection message) to
      // determine the query type and extract the user identifier.
      const queryForParsing = resolvedOriginalQuery || effectiveQuery;
      // Prefer state.queryType (set by detectIntent), then savedQueryType (carried
      // through resolvedEntities / pendingHumanAction), then fall back to nothing.
      // "ambiguous" / "note" are no longer handled here — decision node owns them.
      const candidateQueryType: QueryType | string | undefined =
        state.queryType ?? savedQueryType;
      queryType = candidateQueryType
        ? (candidateQueryType as typeof queryType)
        : "user";
      // ticket 查"我的工单"时也要提取用户（用于 resolvedUser / userId 兜底）
      const needsUserExtraction =
        queryType === "user" ||
        queryType === "ticket" ||
        queryType === "weekly_report" ||
        queryType === "commit";
      // Extract user from original query (e.g. "刘工的周报有哪些" → "刘工")
      const extractedUser = needsUserExtraction ? extractUserIdentifier(queryForParsing) : undefined;
      const activityWindow = (queryType === "user" || queryType === "commit") ? detectActivityWindow(queryForParsing) : undefined;

      console.log(`[AI-LangGraph] searchStructured: resolvedUser id=${resolvedUser.id} name=${resolvedUser.name} resolvedBy=${resolvedUser.resolvedBy} queryType=${queryType} originalQuery="${resolvedOriginalQuery?.slice(0, 40) ?? "none"}" queryForParsing="${queryForParsing.slice(0, 40)}"`);
      queryText = `user:${resolvedUser.id}`;
      filters = needsUserExtraction
        ? { userId: resolvedUser.id, ...(activityWindow ? { activityWindow } : {}) }
        : undefined;
    } else if (resolvedWeeklyReport) {
      // User selected a specific weekly_report from disambiguation candidates.
      queryType = "weekly_report";
      queryText = `weekly_report:${resolvedWeeklyReport.id}`;
      filters = { id: resolvedWeeklyReport.id };
      console.log(`[AI-LangGraph] searchStructured: resolvedWeeklyReport id=${resolvedWeeklyReport.id}`);
    } else if (resolvedTicket) {
      queryType = "ticket";
      queryText = `ticket:${resolvedTicket.id}`;
      filters = { id: resolvedTicket.id };
      console.log(`[AI-LangGraph] searchStructured: resolvedTicket id=${resolvedTicket.id}`);
    } else if (resolvedProject) {
      queryType = "project";
      queryText = `project:${resolvedProject.id}`;
      filters = { id: resolvedProject.id };
      console.log(`[AI-LangGraph] searchStructured: resolvedProject id=${resolvedProject.id}`);
    } else {
      // Normal flow: read queryType from state (set by detectIntent) instead of
      // re-parsing. savedQueryType is still honored as a fallback when the user
      // is on a HIL follow-up round (state.queryType may be "user" from a previous
      // round's selection — we want the *original* type).
      const candidateQueryType: QueryType | string | undefined =
        state.queryType ?? savedQueryType;
      queryType = (candidateQueryType as typeof queryType) ?? "user";
      const extractedId = extractId(content);
      // ticket 查"我的工单"时也要提取用户（用于 resolvedUser / userId 兜底）
      const needsUserExtraction =
        queryType === "user" ||
        queryType === "ticket" ||
        queryType === "weekly_report" ||
        queryType === "commit";
      let extractedUser = needsUserExtraction ? extractUserIdentifier(effectiveQuery) : undefined;

      // 当 needsUserExtraction=true（ticket/weekly_report/commit 查）但没提取到用户，
      // 说明用户在查"我的 XXX"，用 viewerUserId 兜底，让 resolveUser 用 viewerUserId。
      if (!extractedUser && needsUserExtraction && state.userId) {
        console.log(`[AI-LangGraph] no extractedUser for ${queryType} query, using viewerUserId=${state.userId}`);
        extractedUser = { raw: "我", normalized: "我", isSelf: true };
      }

      // 检测代词：如果消息是"他/她/这..."等代词，即使不是 user_activity 查询也使用 lastMentionedUser
      // 放宽判断：只要包含代词相关关键词且消息较短，就是代词查询
      const pronounKeywords = ["他", "她", "它", "谁", "哪", "怎么样", "怎么", "如何"];
      const isPronoun = content.length < 15 && pronounKeywords.some(p => content.includes(p));

      // 从 context 加载的 lastMentionedUser（更可靠）
      const contextUser = state.lastMentionedUser?.name;
      // 从 detectIntent 返回的 lastMentionedUser（可能是错误的）
      const detectUser = state.lastMentionedUser?.name;

      // 提取纯名字：去掉括号内的邮箱/备注部分
      const extractPureName = (name: string): string => {
        return name.replace(/[（(][^）)]+[）)]/g, "").trim();
      };

      // 自我引用类脏数据：DB 里残留的 "我最近的工" / "我" 等，不应覆盖真正的 isSelf 提取结果
      const isSelfLike = (name: string) =>
        /^(我|我自己|自己|我最近的|我的|此人?|本人|当前用户)$/.test(name);

      // 当 extractedUser 已包含有效用户名（≥2字符）时，消息本身已提供用户信号，
      // 不应用 contextUser 覆盖。但如果 extractedUser 是 isSelf 或无效，则可读 contextUser。
      const extractedUserIsValid = extractedUser && extractedUser.raw && extractedUser.raw.length >= 2;

      let effectiveUserName: string | undefined;
      if (!extractedUser?.isSelf && !extractedUserIsValid) {
        if (contextUser && contextUser.length > 1 && !isSelfLike(contextUser)) {
          effectiveUserName = extractPureName(contextUser);
        } else if (detectUser && detectUser.length > 1 && !isSelfLike(detectUser) && !detectUser.includes("最近")) {
          effectiveUserName = extractPureName(detectUser);
        }
      }

      // 当 effectiveUserName 有值时，用它覆盖 extractedUser（保留原有的 isSelf 标记）
      if (effectiveUserName && (isPronoun || needsUserExtraction)) {
        console.log(`[AI-LangGraph] using lastMentionedUser: ${effectiveUserName}`);
        const existingIsSelf = extractedUser?.isSelf;
        extractedUser = { raw: effectiveUserName, normalized: effectiveUserName, ...(existingIsSelf ? { isSelf: true } : {}) };
        // 强制设置为 user 查询类型
        if (isPronoun && !needsUserExtraction) {
          queryType = "user";
        }
      }

      // 优先使用 state.activityWindow（由 detectIntent 提取，已处理 isSelfReference 的 early return）
      // 次选本地 detectActivityWindow（用于 disambiguation 场景等非主流程）
      const activityWindow = state.activityWindow ?? (
        (queryType === "user" || queryType === "commit")
          ? detectActivityWindow(effectiveQuery)
          : undefined
      );
      queryText = extractedUser?.raw ?? extractedId ?? "(未指定)";

      console.log(`[AI-LangGraph] searchStructured type=${queryType} id=${extractedId ?? "none"} extractedUser=${extractedUser ? JSON.stringify(extractedUser) : "none"} window=${activityWindow ?? "none"} content="${effectiveQuery.slice(0, 50)}"${state.originalQuery ? " (from originalQuery)" : ""}`);

      // 当 isSelf=true 时（"我最近的工单"），ticket 查询走 filters.userId 路径
      // 其他查询类型走 extractedUser → resolveUser(isSelf=true) 路径
      filters = needsUserExtraction || isPronoun
        ? {
            ...((extractedUser as { isSelf?: boolean })?.isSelf === true && queryType === "ticket"
              ? { userId: state.userId }
              : extractedUser
                ? { extractedUser }
                : {}),
            ...(activityWindow ? { activityWindow } : {}),
          }
        : undefined;
    }

    // Determine the ID to pass to the core (for specific entity lookups after disambiguation).
    let resolvedId: string | undefined;
    if (resolvedWeeklyReport) resolvedId = resolvedWeeklyReport.id;
    else if (resolvedTicket) resolvedId = resolvedTicket.id;
    else if (resolvedProject) resolvedId = resolvedProject.id;
    else if (resolvedUser) resolvedId = resolvedUser.id;
    else resolvedId = extractId(effectiveQuery ?? content);

    // Directly call the core function, not the tool
    const result = await executeStructuredQuery(
      {
        type: queryType,
        id: resolvedId,
        filters,
        limit: 5,
      },
      state.userId || undefined
    );

    const resultText =
      typeof result === "string"
        ? result
        : JSON.stringify(result, null, 2);

    console.log(`[AI-LangGraph] searchStructured result length=${resultText.length}, content=${resultText.slice(0, 200)}`);

    // Return tool result for disambiguateIntent node to handle decision.
    // queryType is included so disambiguateIntentNode can extract it and carry it
    // through the pendingHumanAction pipeline (sourceResult), so the subsequent
    // searchStructuredNode after human confirmation knows the original query type
    // (e.g. "刘工的周报" → queryType=weekly_report, not queryType=user).
    //
    // Clear pendingHumanAction only when:
    // - result has no decision (user confirmed, no more HIL needed) AND
    // - resolvedUser is set (user picked from Round 1 candidates)
    // In all other cases, leave pending alone so routeAfterSearchStructured
    // can route to the right node based on decision/resolvedEntities.
    const resultRecord = typeof result === "object" && result !== null
      ? result as unknown as Record<string, unknown>
      : null;
    const hasDecision = Boolean(resultRecord?.decision);
    return {
      searchResults: [resultText],
      toolResults: {
        searchStructured: {
          ...result,
          queryType,
          _debug: "structured_with_sources"
        }
      },
      pendingHumanAction: (!hasDecision && resolvedUser) ? null : undefined,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[AI-LangGraph] searchStructured error: ${msg}`);
    return {
      searchResults: [`[searchStructured error] ${msg}`],
      toolResults: { searchStructured: { error: msg } },
    };
  }
}
