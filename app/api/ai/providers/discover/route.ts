import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/shared/lib/permissions";
import { apiFormatToPiApi, resolveUserProviderAuth } from "@/features/ai/llm/providers/user-providers";
import { buildModelsListUrl, parseDiscoveredModels } from "@/lib/model-discovery";

export const dynamic = "force-dynamic";

const DISCOVERY_TIMEOUT_MS = 20_000;

const DiscoverSchema = z.object({
  provider: z.string().min(1),
  baseURL: z.string().optional(),
  apiFormat: z.enum(["openai-chat", "openai-responses", "anthropic"]).optional(),
  /** 草稿 API Key（未保存时用于先测后存）。 */
  apiKey: z.string().optional(),
});

function buildHeaders(api: string, apiKey: string): Headers {
  const headers = new Headers();
  headers.set("Accept", "application/json");
  if (api === "anthropic-messages") {
    headers.set("x-api-key", apiKey);
    headers.set("anthropic-version", "2023-06-01");
  } else if (api === "google-generative-ai") {
    headers.set("x-goog-api-key", apiKey);
  } else {
    headers.set("Authorization", `Bearer ${apiKey}`);
  }
  return headers;
}

/**
 * POST /api/ai/providers/discover
 * User Scope 动态模型发现：CredentialService 解析凭证 → 复用 Shared Discovery
 * （buildModelsListUrl + parseDiscoveredModels），不建第二套 Discovery。
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession();
    const userId = session.user.id;

    const body = await request.json();
    const parsed = DiscoverSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { data: null, error: parsed.error.issues[0]?.message ?? "Invalid body" },
        { status: 400 },
      );
    }

    const auth = await resolveUserProviderAuth(userId, parsed.data);
    const api = apiFormatToPiApi(auth.apiFormat);

    let endpoint: URL;
    try {
      endpoint = buildModelsListUrl(auth.baseURL, api);
    } catch {
      return NextResponse.json({ data: null, error: "Base URL is invalid" }, { status: 400 });
    }

    const response = await fetch(endpoint, {
      cache: "no-store",
      headers: buildHeaders(api, auth.apiKey),
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
    const responseText = await response.text();
    if (!response.ok) {
      return NextResponse.json({
        data: null,
        error: responseText.slice(0, 500) || `Upstream returned HTTP ${response.status}`,
        status: 502,
      });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(responseText);
    } catch {
      return NextResponse.json({ data: null, error: "Upstream model list was not valid JSON" }, { status: 502 });
    }

    const models = parseDiscoveredModels(payload);
    if (models.length === 0) {
      return NextResponse.json({ data: null, error: "No models found in the upstream response" }, { status: 502 });
    }

    return NextResponse.json({ data: { models, endpoint: endpoint.toString() } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "UNAUTHORIZED") {
      return NextResponse.json({ data: null, error: "Unauthorized" }, { status: 401 });
    }
    const status = error instanceof DOMException && error.name === "TimeoutError" ? 504 : 500;
    return NextResponse.json({ data: null, error: message }, { status });
  }
}
