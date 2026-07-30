import { NextResponse } from "next/server";
import { requireSession } from "@/shared/lib/permissions";
import { getEnabledModels } from "@/features/ai/llm/providers/registry";

/**
 * GET /api/ai/models
 * 返回用户可用的模型列表（系统模型 + 用户自定义 provider 动态发现的模型）
 */
export async function GET() {
  try {
    const session = await requireSession().catch(() => null);
    const userId = session?.user?.id;

    // getEnabledModels 会动态从用户 provider 的 /v1/models 拉取模型列表
    const models = await getEnabledModels(userId);

    return NextResponse.json({ data: models });
  } catch (error) {
    console.error("[GET /api/ai/models] error:", error);
    return NextResponse.json(
      { data: null, error: "Failed to fetch models" },
      { status: 500 }
    );
  }
}
