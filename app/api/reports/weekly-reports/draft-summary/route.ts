/**
 * app/api/reports/weekly-reports/draft-summary/route.ts
 *
 * PR7 新增：周报编辑页 AI 总结生成 API。
 *
 * POST /api/reports/weekly-reports/draft-summary
 *
 * 请求体：
 * {
 *   weekStart: ISOString,
 *   weekEnd: ISOString,
 *   formDraft: { title?, content?, projectIds?[] },
 *   currentDraft?: WeeklyDraftSummary,  // 重新生成时传入
 *   force?: boolean  // 跳过限流
 * }
 *
 * 响应：
 * { draft: WeeklyDraftSummary, contextVersion: string, computedAt: string }
 *
 * 限流：同一 userId 10s 内最多 1 次（force=true 跳过限流但记录）
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { aggregateWeeklyContext } from "@/features/reports/weekly-reports/lib/context-aggregator";
import { generateWeeklyDraftSummary, reviseWeeklyDraftSummary } from "@/features/reports/weekly-reports/lib/draft-summary";
import { createHash } from "node:crypto";

const draftSummarySchema = z.object({
  highlights: z.array(z.string()),
  tasks: z.array(z.string()),
  nextPlan: z.array(z.string()),
  rawMarkdown: z.string(),
  projectIds: z.array(z.string()),
  projectNames: z.array(z.string()),
  _error: z.string().optional(),
});

const requestSchema = z.object({
  weekStart: z.string().datetime(),
  weekEnd: z.string().datetime(),
  formDraft: z.object({
    title: z.string().optional(),
    content: z.string().optional(),
    projectIds: z.array(z.string()).optional(),
  }).optional(),
  currentDraft: draftSummarySchema.optional(),
  force: z.boolean().optional(),
});

const RATE_LIMIT_MS = 10 * 1000; // 10s

// In-process rate limit map
const rateLimitMap = new Map<string, number>();

function checkRateLimit(userId: string, force: boolean): boolean {
  if (force) {
    // Log but don't block
    return true;
  }
  const last = rateLimitMap.get(userId);
  if (last && Date.now() - last < RATE_LIMIT_MS) {
    return false;
  }
  rateLimitMap.set(userId, Date.now());
  return true;
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof requestSchema>;
  try {
    body = requestSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: err.issues },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const { weekStart, weekEnd, formDraft, currentDraft, force } = body;
  const userId = session.user.id;

  // Rate limit
  if (!checkRateLimit(userId, !!force)) {
    return NextResponse.json(
      { error: "请求过于频繁，请 10 秒后再试" },
      { status: 429 }
    );
  }

  try {
    const weekStartDate = new Date(weekStart);
    const weekEndDate = new Date(weekEnd);

    // Aggregate context
    const context = await aggregateWeeklyContext(userId, weekStartDate, weekEndDate);

    // Compute contextVersion (hash of serialized context for cache busting)
    const contextVersion = createHash("sha256")
      .update(JSON.stringify(context), "utf8")
      .digest("hex")
      .slice(0, 16);

    // If currentDraft exists, this is a "regenerate" request — revise based on existing draft
    let draft;
    if (currentDraft) {
      const feedback = "请结合最新数据对原草稿进行二次优化，补充遗漏内容、修正过时信息，而不是完全推翻重写";
      draft = await reviseWeeklyDraftSummary(
        userId,
        currentDraft,
        feedback,
        context,
        formDraft
      );
    } else {
      // First time generation
      draft = await generateWeeklyDraftSummary(
        userId,
        weekStartDate,
        weekEndDate,
        formDraft,
        context
      );
    }

    // If LLM call failed, surface the error message in the response so the
    // frontend can display it clearly instead of a misleading "暂无数据" state.
    if (draft._error) {
      return NextResponse.json({
        draft,
        contextVersion,
        computedAt: new Date().toISOString(),
        _error: draft._error,
      });
    }

    return NextResponse.json({
      draft,
      contextVersion,
      computedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[draft-summary] POST failed:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
