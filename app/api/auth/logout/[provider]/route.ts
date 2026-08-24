/**
 * /api/auth/logout/[provider] — OAuth 登出
 *
 * 与 pi-web-ref 完全一致：
 *   - 仅当存储类型是 oauth 时才删除（type_mismatch → 409）
 *   - 删除后 invalidateModelsCache()（项目侧增加 invalidateUnifiedModelsCache）
 *   - 用 getModelRuntime() 单例
 */
import { NextResponse } from "next/server";
import { invalidateModelsCache } from "@/lib/models-cache";
import { getModelRuntime, resetModelRuntime } from "@/lib/model-discovery";
import { removeStoredCredentialIfType } from "@/lib/provider-credential-store";
import { invalidateUnifiedModelsCache } from "@/lib/unified-models-cache";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  const modelRuntime = await getModelRuntime();
  if (!modelRuntime.getProvider(provider)?.auth.oauth) {
    return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 400 });
  }
  const removal = await removeStoredCredentialIfType(provider, "oauth");
  if (removal.status === "type_mismatch") {
    return NextResponse.json({ error: `${provider} is authenticated with an API key, not OAuth` }, { status: 409 });
  }
  invalidateModelsCache();
  invalidateUnifiedModelsCache();
  resetModelRuntime();
  return NextResponse.json({ ok: true });
}
