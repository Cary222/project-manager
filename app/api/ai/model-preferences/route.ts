import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/shared/lib/permissions";
import {
  getUserModelPreferences,
  upsertModelPreferences,
} from "@/features/ai/llm/preferences/user-model-preferences";
import { isReasoningLevel } from "@/features/ai/llm/model-runtime-config";

export const dynamic = "force-dynamic";

/**
 * GET /api/ai/model-preferences
 * 返回当前用户的 User Scope 模型偏好（enabled/favorite/thinkingLevel/temperature/maxTokens）。
 * 语义：无行 = 默认启用；enabled=false 行 = 显式禁用。
 */
export async function GET() {
  try {
    const session = await requireSession();
    const userId = session.user.id;
    const preferences = await getUserModelPreferences(userId);
    return NextResponse.json({ data: { preferences } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "UNAUTHORIZED") {
      return NextResponse.json({ data: null, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ data: null, error: "Failed to fetch model preferences" }, { status: 500 });
  }
}

const PreferenceItemSchema = z.object({
  provider: z.string().min(1),
  modelId: z.string().min(1),
  enabled: z.boolean().optional(),
  favorite: z.boolean().optional(),
  thinkingLevel: z.string().nullable().optional(),
  temperature: z.number().min(0).max(2).nullable().optional(),
  maxTokens: z.number().int().positive().nullable().optional(),
});

const PutSchema = z.object({
  items: z.array(PreferenceItemSchema).max(500),
});

/**
 * PUT /api/ai/model-preferences
 * 批量 upsert 偏好（字段级写入，按 provider+modelId 定位）。
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await requireSession();
    const userId = session.user.id;

    const body = await request.json();
    const parsed = PutSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { data: null, error: parsed.error.issues[0]?.message ?? "Invalid body" },
        { status: 400 },
      );
    }

    // thinkingLevel 必须是统一 ReasoningLevel 语义（或 null = 清除覆盖）
    for (const item of parsed.data.items) {
      if (item.thinkingLevel !== undefined && item.thinkingLevel !== null && !isReasoningLevel(item.thinkingLevel)) {
        return NextResponse.json(
          { data: null, error: `Invalid thinkingLevel: "${item.thinkingLevel}"` },
          { status: 400 },
        );
      }
    }

    const updated = await upsertModelPreferences(userId, parsed.data.items);
    return NextResponse.json({ data: { updated } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "UNAUTHORIZED") {
      return NextResponse.json({ data: null, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ data: null, error: "Failed to save model preferences" }, { status: 500 });
  }
}
