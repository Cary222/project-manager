import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/shared/lib/permissions";
import { apiFormatToPiApi, resolveUserProviderAuth } from "@/features/ai/llm/providers/user-providers";
import { runModelConnectionTest } from "@/lib/model-connection-test";

export const dynamic = "force-dynamic";

const TestSchema = z.object({
  provider: z.string().min(1),
  modelId: z.string().min(1),
  baseURL: z.string().optional(),
  apiFormat: z.enum(["openai-chat", "openai-responses", "anthropic"]).optional(),
  /** 草稿 API Key（未保存时用于先测后存）。 */
  apiKey: z.string().optional(),
});

/**
 * POST /api/ai/providers/test
 * User Scope 连接测试：CredentialService 解析凭证 → 与 /api/models-config/test
 * 共用 lib/model-connection-test.ts 核心（不复制第二份测试逻辑）。
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession();
    const userId = session.user.id;

    const body = await request.json();
    const parsed = TestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid body" },
        { status: 400 },
      );
    }

    const auth = await resolveUserProviderAuth(userId, parsed.data);
    const result = await runModelConnectionTest({
      providerName: auth.provider,
      provider: {
        baseUrl: auth.baseURL,
        api: apiFormatToPiApi(auth.apiFormat),
        apiKey: auth.apiKey,
      },
      model: { id: parsed.data.modelId },
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "UNAUTHORIZED") {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
