import { NextResponse } from "next/server";
import { PROVIDER_PRESETS } from "@/features/ai/llm/providers/presets";

export const dynamic = "force-dynamic";

/**
 * GET /api/ai/providers/presets
 * Provider 目录（40+ 预设：id / 展示名 / 默认 baseURL / 默认协议 / 分类 / icon）。
 * 仅 UI 预设，不涉及凭证。
 */
export async function GET() {
  return NextResponse.json({ data: { presets: PROVIDER_PRESETS } });
}
