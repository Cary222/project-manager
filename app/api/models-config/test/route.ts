import { NextResponse } from "next/server";
import { runModelConnectionTest } from "@/lib/model-connection-test";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { resolveSiteCredential } from "@/features/ai/llm/providers/user-providers";

export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ ok: false, error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json(
      { ok: false, error: "Content-Type must be application/json" },
      { status: 415 },
    );
  }

  try {
    const body = await req.json() as { providerName?: unknown; provider?: unknown; model?: unknown };
    const providerName = typeof body.providerName === "string" ? body.providerName.trim() : "";
    if (!providerName) return NextResponse.json({ ok: false, error: "providerName is required" }, { status: 400 });
    if (!isRecord(body.provider)) return NextResponse.json({ ok: false, error: "provider is required" }, { status: 400 });
    if (!isRecord(body.model)) return NextResponse.json({ ok: false, error: "model is required" }, { status: 400 });

    const modelId = typeof body.model.id === "string" ? body.model.id.trim() : "";
    if (!modelId) return NextResponse.json({ ok: false, error: "Model ID is required" }, { status: 400 });

    // Stage 7 继承链路：配置未携带 apiKey 时回落到站点凭证（USER → SYSTEM），
    // 凭证仅注入临时测试配置（阅后即焚），不下发到客户端。
    let provider = body.provider;
    const draftKey = typeof provider.apiKey === "string" ? provider.apiKey.trim() : "";
    if (!draftKey) {
      const siteCred = await resolveSiteCredential(providerName);
      if (siteCred) {
        provider = {
          ...provider,
          apiKey: siteCred.apiKey,
          ...(typeof provider.baseUrl === "string" && provider.baseUrl.trim() ? {} : { baseUrl: siteCred.baseURL }),
        };
      }
    }

    // 测试核心与 /api/ai/providers/test 共用 lib/model-connection-test.ts
    const result = await runModelConnectionTest({
      providerName,
      provider,
      model: { ...body.model, id: modelId },
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ ok: false, error: errorMessage(error) }, { status: 500 });
  }
}
