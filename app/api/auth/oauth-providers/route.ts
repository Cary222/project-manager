/**
 * /api/auth/oauth-providers — OAuth provider 列表
 *
 * 注意：不能使用 /api/auth/providers —— 该路径被 next-auth 的 catch-all
 * ([...nextauth]) 占用，覆盖后会导致 signIn("credentials") 找不到
 * credentials provider，登录失败。
 *
 * 调用 lib/model-discovery.ts 的 getModelRuntime() 单例（避免重复 create）。
 * 与 pi-web-ref 完全一致。
 */
import { NextResponse } from "next/server";
import { buildOAuthProviderList } from "@/lib/provider-listing";
import { collectProviderListingInputs } from "@/lib/provider-listing-runtime";
import { getModelRuntime } from "@/lib/model-discovery";

export const dynamic = "force-dynamic";

// Providers that declare an OAuth login method, including anthropic
// (Claude Pro/Max) — see lib/provider-listing.ts (#309).
export async function GET() {
  const modelRuntime = await getModelRuntime();
  const providers = buildOAuthProviderList(await collectProviderListingInputs(modelRuntime));
  return NextResponse.json({ providers });
}
