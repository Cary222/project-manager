import { NextResponse } from "next/server";
import { requireSession } from "@/shared/lib/permissions";
import { getModelRuntime } from "@/lib/model-discovery";
import { buildApiKeyProviderList, buildOAuthProviderList } from "@/lib/provider-listing";
import { collectProviderListingInputs } from "@/lib/provider-listing-runtime";

export const dynamic = "force-dynamic";

// Providers that declare an OAuth login method, including anthropic
// (Claude Pro/Max) — see lib/provider-listing.ts (#309).
export async function GET() {
  try {
    await requireSession();
    const modelRuntime = await getModelRuntime();
    const inputs = await collectProviderListingInputs(modelRuntime);
    const oauthProviders = buildOAuthProviderList(inputs);
    const apiKeyProviders = buildApiKeyProviderList(inputs);
    return NextResponse.json({ providers: oauthProviders, oauthProviders, apiKeyProviders });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    const status = msg === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
