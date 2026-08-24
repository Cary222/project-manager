/**
 * /api/auth/api-key/[provider] — Provider API Key 管理（GET / POST / DELETE）
 *
 * 行为：
 *   - GET    返回 provider 的 auth 状态（绝不返回真实 key）
 *   - POST   保存 API key 到 auth.json（经 provider-credential-store 的锁保护）
 *   - DELETE 删除存储的 API key（按类型精确匹配，避免误删 OAuth 凭证）
 *
 * 与 pi-web-ref 的差异：
 *   - 1. ModelRuntime 单例化（lib/model-discovery.ts 的 getModelRuntime）
 *        不再每次 ModelRuntime.create()；凭证变更后 resetModelRuntime() 强制重读 models.json
 *   - 2. POST/DELETE 后同时调用 invalidateUnifiedModelsCache()（unified-models-cache）
 *        这是 pi-web-ref 没有的，ProjectHub 跨端点（/api/ai/models/registry + /api/models）
 *        共享缓存，必须一并失效。
 *   - 3. POST 的 apiKeyAuth.login() 调用方式完全一致
 *        （保留 pi-web-ref 的"prompt → api-key → trim key"逻辑，确保与 Pi SDK 兼容）
 */
import type { Credential } from "@earendil-works/pi-ai";
import { NextResponse } from "next/server";
import { invalidateModelsCache } from "@/lib/models-cache";
import { getModelRuntime, resetModelRuntime } from "@/lib/model-discovery";
import { removeStoredCredentialIfType, storeProviderCredential } from "@/lib/provider-credential-store";
import { invalidateUnifiedModelsCache } from "@/lib/unified-models-cache";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ provider: string }> };

// GET /api/auth/api-key/[provider] — returns auth status (never returns the actual key)
export async function GET(_req: Request, { params }: Params) {
  const { provider } = await params;
  const modelRuntime = await getModelRuntime();
  const status = modelRuntime.getProviderAuthStatus(provider);
  const displayName = modelRuntime.getProvider(provider)?.name ?? provider;
  const models = modelRuntime.getModels(provider).length;
  return NextResponse.json({ provider, displayName, configured: status.configured, source: status.source, models });
}

// POST /api/auth/api-key/[provider]  body: { apiKey: string }
export async function POST(req: Request, { params }: Params) {
  const { provider } = await params;
  try {
    const { apiKey } = (await req.json()) as { apiKey?: string };
    if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
      return NextResponse.json({ error: "apiKey is required" }, { status: 400 });
    }
    const modelRuntime = await getModelRuntime();
    const apiKeyAuth = modelRuntime.getProvider(provider)?.auth.apiKey;
    if (!apiKeyAuth?.login) {
      throw new Error(`${provider} does not support API key login`);
    }
    let keySubmitted = false;
    const credential: Credential = await apiKeyAuth.login({
      signal: req.signal,
      notify: () => {},
      prompt: async (prompt) => {
        if (prompt.type === "select") {
          const keyOption = prompt.options.find((option) => option.id === "api-key" || option.id === "bearer-token");
          if (keyOption) return keyOption.id;
          throw new Error(`${provider} requires interactive authentication setup`);
        }
        if (!keySubmitted && prompt.type === "secret") {
          keySubmitted = true;
          return apiKey.trim();
        }
        throw new Error(`${provider} requires additional authentication settings`);
      },
    });
    // ModelRuntime.login() persists the credential and then performs an
    // unbounded network catalog refresh. Store the returned credential
    // directly so a slow catalog cannot leave the save request hanging.
    await storeProviderCredential(provider, credential);
    invalidateModelsCache();
    invalidateUnifiedModelsCache();
    resetModelRuntime();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/auth/api-key/[provider] — removes stored API key
export async function DELETE(_req: Request, { params }: Params) {
  const { provider } = await params;
  try {
    const removal = await removeStoredCredentialIfType(provider, "api_key");
    if (removal.status === "type_mismatch") {
      return NextResponse.json(
        { error: `${provider} is authenticated with OAuth, not an API key` },
        { status: 409 },
      );
    }
    invalidateModelsCache();
    invalidateUnifiedModelsCache();
    resetModelRuntime();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
