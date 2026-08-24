import { NextResponse } from "next/server";
import { requireSession } from "@/shared/lib/permissions";
import { getEnabledModels } from "@/features/ai/llm/providers/registry";
import { loadUserModelsWithCache } from "@/lib/user-models-cache";

/**
 * GET /api/ai/models
 * 返回用户可用的模型列表（系统模型 + 用户自定义 provider 动态发现的模型）
 *
 * 缓存：每个 userId 独立缓存，TTL 5 分钟。
 * 失效时机：Provider CRUD 时由 api-key-store 层主动失效。
 */
export async function GET() {
  try {
    const session = await requireSession().catch(() => null);
    const userId = session?.user?.id ?? undefined;

    // 使用缓存层，避免每次请求都访问 Provider API
    const models = await loadUserModelsWithCache(
      userId ?? "anonymous",
      () => getEnabledModels(userId)
    );

    return NextResponse.json({ data: models });
  } catch (error) {
    console.error("[GET /api/ai/models] error:", error);
    return NextResponse.json(
      { data: null, error: "Failed to fetch models" },
      { status: 500 }
    );
  }
}
