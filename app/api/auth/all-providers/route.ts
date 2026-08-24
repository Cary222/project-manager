import { NextResponse } from "next/server";
import { getModelRuntime } from "@/lib/model-discovery";
import { buildApiKeyProviderList } from "@/lib/provider-listing";
import { collectProviderListingInputs } from "@/lib/provider-listing-runtime";

export const dynamic = "force-dynamic";

// Providers that accept an API key, including dual-auth ones such as anthropic —
// see lib/provider-listing.ts for why membership is capability-based (#309).
export async function GET() {
  const modelRuntime = await getModelRuntime();
  const providers = buildApiKeyProviderList(await collectProviderListingInputs(modelRuntime));
  return NextResponse.json({ providers });
}
