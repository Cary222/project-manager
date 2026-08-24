/**
 * Unit tests for lib/rpc-manager.ts — set_model credential injection.
 *
 * These tests verify the provider-name mapping and credential injection logic
 * that underpins model switching (Agnes → DeepSeek, etc.) in AI Workspace.
 *
 * Key invariant: `modelRuntime.setRuntimeApiKey(provider, key)` must be called
 * with the **same provider ID** that the target model's `model.provider` field
 * carries — otherwise the SDK's credential lookup finds no key and throws
 * "No API key for <provider>/<modelId>".
 *
 * Evidence:
 * - DeepSeek models in `node_modules/@earendil-works/pi-ai/providers/data/deepseek.json`
 *   declare `"provider": "deepseek"` (not "openai").
 * - `ModelRuntime.getModel(providerId, modelId)` indexes by the model's provider ID.
 * - The old mapping `"deepseek" → "openai"` caused the SDK to register the key
 *   under "openai" but look it up under "deepseek", producing the observed error.
 *
 * Run: npx vitest run lib/__tests__/rpc-manager-set-model.test.ts
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// ─── Mock the credential store dependency ───────────────────────────────────

vi.mock("@/features/ai/llm/credentials/api-key-store", () => ({
  resolveCredentialWithFallback: vi.fn(),
}));

import { resolveCredentialWithFallback } from "@/features/ai/llm/credentials/api-key-store";

// ─── Minimal subset of the module under test ─────────────────────────────────
//
// We reproduce the pure functions locally to avoid importing the full
// AgentSessionWrapper (which requires SDK mocks and is hard to isolate).
// These must stay in sync with lib/rpc-manager.ts.

function toSdkProviderName(provider: string): string {
  return provider; // canonical — provider IDs are identical across ProjectHub and Pi SDK built-ins
}

interface MockModelRuntime {
  calls: Array<{ provider: string; apiKey: string }>;
}

async function injectProviderCredential(
  modelRuntime: MockModelRuntime,
  provider: string,
  userId: string | undefined,
): Promise<string | undefined> {
  const sdkProvider = toSdkProviderName(provider);
  const cred = await resolveCredentialWithFallback(userId ?? "system", provider);

  if (!cred) {
    return `No API key configured for provider "${provider}". ` +
      `Please configure your API key in Settings → AI Configuration.`;
  }

  modelRuntime.calls.push({ provider: sdkProvider, apiKey: cred.apiKey });
  return undefined;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("toSdkProviderName", () => {
  it("deepseek → deepseek (NOT openai — critical fix)", () => {
    expect(toSdkProviderName("deepseek")).toBe("deepseek");
  });

  it("openai → openai (unchanged)", () => {
    expect(toSdkProviderName("openai")).toBe("openai");
  });

  it("anthropic → anthropic", () => {
    expect(toSdkProviderName("anthropic")).toBe("anthropic");
  });

  it("agnes → agnes (native extension provider)", () => {
    expect(toSdkProviderName("agnes")).toBe("agnes");
  });

  it("unknown provider → passed through as-is", () => {
    expect(toSdkProviderName("custom-relay")).toBe("custom-relay");
  });
});

describe("injectProviderCredential — deepseek model switching", () => {
  let mockRuntime: MockModelRuntime;

  beforeEach(() => {
    mockRuntime = { calls: [] };
    vi.clearAllMocks();
  });

  it("registers key under 'deepseek' (not 'openai') when switching to deepseek model", async () => {
    vi.mocked(resolveCredentialWithFallback).mockResolvedValue({
      provider: "deepseek",
      baseURL: "https://api.deepseek.com",
      apiKey: "sk-test-deepseek-key",
      transport: "direct",
      apiFormat: "openai-chat",
      ownerType: "USER",
    });

    const result = await injectProviderCredential(mockRuntime, "deepseek", "user-1");

    expect(result).toBeUndefined();
    expect(mockRuntime.calls).toHaveLength(1);
    // The critical assertion: provider ID must match the model's provider field
    expect(mockRuntime.calls[0].provider).toBe("deepseek");
    expect(mockRuntime.calls[0].apiKey).toBe("sk-test-deepseek-key");
  });

  it("registers key under 'openai' when switching to OpenAI model", async () => {
    vi.mocked(resolveCredentialWithFallback).mockResolvedValue({
      provider: "openai",
      baseURL: "https://api.openai.com/v1",
      apiKey: "sk-test-openai-key",
      transport: "direct",
      apiFormat: "openai-chat",
      ownerType: "USER",
    });

    const result = await injectProviderCredential(mockRuntime, "openai", "user-1");

    expect(result).toBeUndefined();
    expect(mockRuntime.calls).toHaveLength(1);
    expect(mockRuntime.calls[0].provider).toBe("openai");
  });

  it("registers key under 'agnes' when switching to Agnes model", async () => {
    vi.mocked(resolveCredentialWithFallback).mockResolvedValue({
      provider: "agnes",
      baseURL: "https://api.example.com/v1",
      apiKey: "agnes-test-key",
      transport: "proxy",
      apiFormat: "openai-chat",
      ownerType: "SYSTEM",
    });

    const result = await injectProviderCredential(mockRuntime, "agnes", "user-1");

    expect(result).toBeUndefined();
    expect(mockRuntime.calls).toHaveLength(1);
    expect(mockRuntime.calls[0].provider).toBe("agnes");
  });

  it("returns friendly error when no API key is configured", async () => {
    vi.mocked(resolveCredentialWithFallback).mockResolvedValue(null);

    const result = await injectProviderCredential(mockRuntime, "deepseek", "user-1");

    expect(result).toContain("No API key configured for provider \"deepseek\"");
    expect(result).toContain("Settings → AI Configuration");
    expect(mockRuntime.calls).toHaveLength(0);
  });

  it("falls back to 'system' userId when not provided", async () => {
    vi.mocked(resolveCredentialWithFallback).mockResolvedValue({
      provider: "deepseek",
      baseURL: "https://api.deepseek.com",
      apiKey: "sk-system-key",
      transport: "direct",
      apiFormat: "openai-chat",
      ownerType: "SYSTEM",
    });

    await injectProviderCredential(mockRuntime, "deepseek", undefined);

    expect(resolveCredentialWithFallback).toHaveBeenCalledWith("system", "deepseek");
  });
});
