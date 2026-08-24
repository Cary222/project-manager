/**
 * Unified Model Registry — 单元测试
 *
 * 测试范围：
 * 1. site + local 同名 provider 合并（baseURL 覆盖，模型列表合并）
 * 2. local 同名模型覆盖 site 模型（displayName / metadata）
 * 3. local modelRef 规范为 `${provider}:${modelId}`
 * 4. apiFormat 转换（toProviderEntry）
 * 5. 未登录时只返回 local 模型
 * 6. 不向 model.json 写入（通过检查 readModelsConfig 调用次数）
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ModelCatalogEntry } from "@/features/ai/llm/providers/types";

// ---------------------------------------------------------------------------
// Mock 层 — 隔离 DB / Discovery 依赖
// ---------------------------------------------------------------------------

vi.mock("@/shared/db/client", () => ({ prisma: {} }));
vi.mock("@/features/ai/llm/providers/registry", () => ({
  getEnabledModels: vi.fn(),
}));
vi.mock("@/lib/models-config-store", () => ({
  readModelsConfig: vi.fn(),
}));
vi.mock("@/lib/user-models-cache", () => ({
  loadUserModelsWithCache: vi.fn(async (_key: string, loader: () => unknown) => loader()),
}));

// ---------------------------------------------------------------------------
// 辅助构造器
// ---------------------------------------------------------------------------

function siteEntry(overrides: Partial<ModelCatalogEntry> = {}): ModelCatalogEntry {
  return {
    id: "openai:gpt-4o",
    modelName: "gpt-4o",
    displayName: "GPT-4o (Site)",
    modelRef: "openai:gpt-4o",
    capabilities: ["standard"],
    enabled: true,
    provider: "openai",
    apiFormat: "openai-chat",
    ...overrides,
  };
}

function localConfig(cfg: Record<string, { baseUrl?: string; api?: string; models?: { id: string; name?: string }[] }>) {
  return cfg;
}

// ---------------------------------------------------------------------------
// 测试：getUnifiedModels 合并策略
// ---------------------------------------------------------------------------

describe("getUnifiedModels — site + local 同名 provider 合并", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("无登录用户 → 只返回 local 模型（graceful degradation）", async () => {
    const { getEnabledModels } = await import("@/features/ai/llm/providers/registry");
    const { readModelsConfig } = await import("@/lib/models-config-store");

    vi.mocked(getEnabledModels).mockResolvedValue([]);
    vi.mocked(readModelsConfig).mockResolvedValue({
      providers: {
        openai: {
          baseUrl: "https://api.openai.com",
          api: "openai-completions",
          models: [{ id: "gpt-4o-mini", name: "GPT-4o Mini" }],
        },
      },
    });

    const { getUnifiedModels } = await import("@/lib/unified-model-registry");
    const result = await getUnifiedModels(null);

    expect(result).toHaveLength(1);
    expect(result[0]!.provider).toBe("openai");
    expect(result[0]!.models).toHaveLength(1);
    expect(result[0]!.models[0]!.modelName).toBe("gpt-4o-mini");
    expect(result[0]!.source).toBe("local");
  });

  it("site provider + local 同名 provider → local baseURL 覆盖 site baseURL", async () => {
    const { getEnabledModels } = await import("@/features/ai/llm/providers/registry");
    const { readModelsConfig } = await import("@/lib/models-config-store");

    vi.mocked(getEnabledModels).mockResolvedValue([siteEntry()]);
    vi.mocked(readModelsConfig).mockResolvedValue({
      providers: {
        openai: {
          baseUrl: "https://custom.openai.com/v1",
          api: "anthropic-messages",
          models: [{ id: "gpt-4o" }],
        },
      },
    });

    const { getUnifiedModels } = await import("@/lib/unified-model-registry");
    const result = await getUnifiedModels("user-1");

    expect(result).toHaveLength(1);
    expect(result[0]!.baseURL).toBe("https://custom.openai.com/v1"); // local 覆盖
    expect(result[0]!.apiFormat).toBe("anthropic-messages"); // local 覆盖
  });

  it("site provider + local 同名 provider → 模型列表合并，不重复", async () => {
    const { getEnabledModels } = await import("@/features/ai/llm/providers/registry");
    const { readModelsConfig } = await import("@/lib/models-config-store");

    vi.mocked(getEnabledModels).mockResolvedValue([
      siteEntry({ modelName: "gpt-4o", modelRef: "openai:gpt-4o" }),
      siteEntry({ modelName: "gpt-4o-mini", modelRef: "openai:gpt-4o-mini", id: "openai:gpt-4o-mini" }),
    ]);
    vi.mocked(readModelsConfig).mockResolvedValue({
      providers: {
        openai: {
          baseUrl: "https://custom.openai.com/v1",
          api: "openai-completions",
          models: [
            { id: "gpt-4o" }, // 同名，local 覆盖
            { id: "o3-mini", name: "O3 Mini" }, // 新增
          ],
        },
      },
    });

    const { getUnifiedModels } = await import("@/lib/unified-model-registry");
    const result = await getUnifiedModels("user-1");

    expect(result).toHaveLength(1);
    const models = result[0]!.models;
    expect(models.map((m) => m.modelName).sort()).toEqual(["gpt-4o", "gpt-4o-mini", "o3-mini"]);
  });

  it("local 新增 provider 不在 site 中 → 直接添加", async () => {
    const { getEnabledModels } = await import("@/features/ai/llm/providers/registry");
    const { readModelsConfig } = await import("@/lib/models-config-store");

    vi.mocked(getEnabledModels).mockResolvedValue([siteEntry()]);
    vi.mocked(readModelsConfig).mockResolvedValue({
      providers: {
        openai: { baseUrl: "https://api.openai.com", api: "openai-completions", models: [{ id: "gpt-4o" }] },
        deepseek: { baseUrl: "https://api.deepseek.com", api: "openai-completions", models: [{ id: "deepseek-chat" }] },
      },
    });

    const { getUnifiedModels } = await import("@/lib/unified-model-registry");
    const result = await getUnifiedModels("user-1");

    const providers = result.map((p) => p.provider).sort();
    expect(providers).toEqual(["deepseek", "openai"]);
  });

  it("site 无模型，local 有模型 → 正常返回 local 模型", async () => {
    const { getEnabledModels } = await import("@/features/ai/llm/providers/registry");
    const { readModelsConfig } = await import("@/lib/models-config-store");

    vi.mocked(getEnabledModels).mockResolvedValue([]);
    vi.mocked(readModelsConfig).mockResolvedValue({
      providers: {
        openai: { baseUrl: "https://api.openai.com", api: "openai-completions", models: [{ id: "gpt-4o" }] },
      },
    });

    const { getUnifiedModels } = await import("@/lib/unified-model-registry");
    const result = await getUnifiedModels("user-1");

    expect(result).toHaveLength(1);
    expect(result[0]!.models[0]!.modelName).toBe("gpt-4o");
  });
});

describe("getUnifiedModels — local 模型覆盖 site 模型", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("local 同名模型使用 local displayName 覆盖 site displayName", async () => {
    const { getEnabledModels } = await import("@/features/ai/llm/providers/registry");
    const { readModelsConfig } = await import("@/lib/models-config-store");

    vi.mocked(getEnabledModels).mockResolvedValue([
      siteEntry({ modelName: "gpt-4o", displayName: "GPT-4o (Site)" }),
    ]);
    vi.mocked(readModelsConfig).mockResolvedValue({
      providers: {
        openai: {
          baseUrl: "https://api.openai.com",
          api: "openai-completions",
          models: [{ id: "gpt-4o", name: "My Custom GPT-4o" }],
        },
      },
    });

    const { getUnifiedModels } = await import("@/lib/unified-model-registry");
    const result = await getUnifiedModels("user-1");

    const gpt4o = result[0]!.models.find((m) => m.modelName === "gpt-4o")!;
    expect(gpt4o.displayName).toBe("My Custom GPT-4o"); // local 覆盖
    expect(gpt4o.source).toBe("local");
  });

  it("local 同名模型保留 site 的 provider（不可被覆盖）", async () => {
    const { getEnabledModels } = await import("@/features/ai/llm/providers/registry");
    const { readModelsConfig } = await import("@/lib/models-config-store");

    vi.mocked(getEnabledModels).mockResolvedValue([
      siteEntry({ modelName: "gpt-4o", provider: "openai" }),
    ]);
    vi.mocked(readModelsConfig).mockResolvedValue({
      providers: {
        openai: {
          baseUrl: "https://api.openai.com",
          api: "openai-completions",
          models: [{ id: "gpt-4o" }],
        },
      },
    });

    const { getUnifiedModels } = await import("@/lib/unified-model-registry");
    const result = await getUnifiedModels("user-1");

    const gpt4o = result[0]!.models.find((m) => m.modelName === "gpt-4o")!;
    expect(gpt4o.provider).toBe("openai");
  });
});

describe("getUnifiedModels — modelRef 规范", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("local 模型 modelRef 规范为 `${provider}:${modelId}`", async () => {
    const { getEnabledModels } = await import("@/features/ai/llm/providers/registry");
    const { readModelsConfig } = await import("@/lib/models-config-store");

    vi.mocked(getEnabledModels).mockResolvedValue([]);
    vi.mocked(readModelsConfig).mockResolvedValue({
      providers: {
        openai: {
          baseUrl: "https://api.openai.com",
          api: "openai-completions",
          models: [{ id: "gpt-4o" }],
        },
      },
    });

    const { getUnifiedModels } = await import("@/lib/unified-model-registry");
    const result = await getUnifiedModels("user-1");

    const model = result[0]!.models[0]!;
    expect(model.modelRef).toBe("openai:gpt-4o");
  });

  it("site 模型 modelRef 保持原始格式", async () => {
    const { getEnabledModels } = await import("@/features/ai/llm/providers/registry");
    const { readModelsConfig } = await import("@/lib/models-config-store");

    vi.mocked(getEnabledModels).mockResolvedValue([siteEntry({ modelRef: "openai:gpt-4o" })]);
    vi.mocked(readModelsConfig).mockResolvedValue({ providers: {} });

    const { getUnifiedModels } = await import("@/lib/unified-model-registry");
    const result = await getUnifiedModels("user-1");

    const model = result[0]!.models[0]!;
    expect(model.modelRef).toBe("openai:gpt-4o");
  });
});

describe("getUnifiedModels — 不向 model.json 写入", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getUnifiedModels 只读取 model.json，不写入", async () => {
    const { getEnabledModels } = await import("@/features/ai/llm/providers/registry");
    const { readModelsConfig } = await import("@/lib/models-config-store");

    vi.mocked(getEnabledModels).mockResolvedValue([]);
    vi.mocked(readModelsConfig).mockResolvedValue({
      providers: {
        openai: { baseUrl: "https://api.openai.com", api: "openai-completions", models: [{ id: "gpt-4o" }] },
      },
    });

    const { getUnifiedModels } = await import("@/lib/unified-model-registry");
    await getUnifiedModels("user-1");

    expect(vi.mocked(readModelsConfig)).toHaveBeenCalledTimes(1);
  });
});

describe("toProviderEntry — apiFormat 转换", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("anthropic → anthropic-messages", async () => {
    const { getEnabledModels } = await import("@/features/ai/llm/providers/registry");
    const { readModelsConfig } = await import("@/lib/models-config-store");

    vi.mocked(getEnabledModels).mockResolvedValue([
      siteEntry({ provider: "anthropic", modelName: "claude-3-5-sonnet", apiFormat: "anthropic", id: "anthropic:claude-3-5-sonnet" }),
    ]);
    vi.mocked(readModelsConfig).mockResolvedValue({ providers: {} });

    const { getUnifiedModels, toProviderEntry } = await import("@/lib/unified-model-registry");
    const unified = await getUnifiedModels("user-1");
    const entry = toProviderEntry(unified[0]!);

    expect(entry.api).toBe("anthropic-messages");
  });

  it("openai-responses → openai-responses（不被降级）", async () => {
    const { getEnabledModels } = await import("@/features/ai/llm/providers/registry");
    const { readModelsConfig } = await import("@/lib/models-config-store");

    vi.mocked(getEnabledModels).mockResolvedValue([
      siteEntry({ provider: "agnes", modelName: "agnes-2.5-flash", apiFormat: "openai-responses", id: "agnes:agnes-2.5-flash" }),
    ]);
    vi.mocked(readModelsConfig).mockResolvedValue({ providers: {} });

    const { getUnifiedModels, toProviderEntry } = await import("@/lib/unified-model-registry");
    const unified = await getUnifiedModels("user-1");
    const entry = toProviderEntry(unified[0]!);

    expect(entry.api).toBe("openai-responses");
  });

  it("openai-chat → openai-completions", async () => {
    const { getEnabledModels } = await import("@/features/ai/llm/providers/registry");
    const { readModelsConfig } = await import("@/lib/models-config-store");

    vi.mocked(getEnabledModels).mockResolvedValue([
      siteEntry({ provider: "openai", modelName: "gpt-4o", apiFormat: "openai-chat", id: "openai:gpt-4o" }),
    ]);
    vi.mocked(readModelsConfig).mockResolvedValue({ providers: {} });

    const { getUnifiedModels, toProviderEntry } = await import("@/lib/unified-model-registry");
    const unified = await getUnifiedModels("user-1");
    const entry = toProviderEntry(unified[0]!);

    expect(entry.api).toBe("openai-completions");
  });

  it("google-generative-ai → google-generative-ai（不被降级为 openai-completions）", async () => {
    const { getEnabledModels } = await import("@/features/ai/llm/providers/registry");
    const { readModelsConfig } = await import("@/lib/models-config-store");

    vi.mocked(getEnabledModels).mockResolvedValue([
      siteEntry({ provider: "gemini", modelName: "gemini-pro", apiFormat: "openai-chat", id: "gemini:gemini-pro" }),
    ]);
    vi.mocked(readModelsConfig).mockResolvedValue({
      providers: {
        gemini: {
          baseUrl: "https://generativelanguage.googleapis.com",
          api: "google-generative-ai",
          models: [{ id: "gemini-pro" }],
        },
      },
    });

    const { getUnifiedModels, toProviderEntry } = await import("@/lib/unified-model-registry");
    const unified = await getUnifiedModels("user-1");
    const entry = toProviderEntry(unified[0]!);

    expect(entry.api).toBe("google-generative-ai");
  });
});

describe("buildFullModelsConfig — Settings 对话框无损往返", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("local provider 完整保留 apiKey / thinkingLevelMap / headers / compat / modelOverrides", async () => {
    const { getEnabledModels } = await import("@/features/ai/llm/providers/registry");
    const { readModelsConfig } = await import("@/lib/models-config-store");

    vi.mocked(getEnabledModels).mockResolvedValue([]);
    vi.mocked(readModelsConfig).mockResolvedValue({
      providers: {
        "new-provider": {
          baseUrl: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
          api: "openai-completions",
          apiKey: "sk-test-123",
          headers: { "User-Agent": "custom-agent" },
          compat: { supportsDeveloperRole: true },
          modelOverrides: { temperature: 0.5 },
          models: [
            {
              id: "qwen3.8-max",
              reasoning: true,
              thinkingLevelMap: { low: "qwen3.8-max", max: null },
              input: ["text", "image"],
              contextWindow: 128000,
              maxTokens: 16384,
              cost: { input: 1.2, output: 2.4 },
              headers: { "X-Model": "yes" },
              compat: { thinkingFormat: "deepseek" },
            },
          ],
        },
      },
    });

    const { getUnifiedModels, buildFullModelsConfig } = await import("@/lib/unified-model-registry");
    const unified = await getUnifiedModels("user-1");
    const result = buildFullModelsConfig(unified, await readModelsConfig());

    const provider = result.providers!["new-provider"]! as Record<string, unknown>;
    expect(provider.__source).toBe("local");
    expect(provider.apiKey).toBe("sk-test-123");
    expect(provider.baseUrl).toBe("https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1");
    expect(provider.headers).toEqual({ "User-Agent": "custom-agent" });
    expect(provider.compat).toEqual({ supportsDeveloperRole: true });
    expect(provider.modelOverrides).toEqual({ temperature: 0.5 });

    const model = (provider.models as Record<string, unknown>[])[0]!;
    expect(model.id).toBe("qwen3.8-max");
    expect(model.reasoning).toBe(true);
    expect(model.thinkingLevelMap).toEqual({ low: "qwen3.8-max", max: null });
    expect(model.input).toEqual(["text", "image"]);
    expect(model.cost).toEqual({ input: 1.2, output: 2.4 });
    expect(model.headers).toEqual({ "X-Model": "yes" });
    expect(model.compat).toEqual({ thinkingFormat: "deepseek" });
  });

  it("site-only provider 转为只读条目（__source=site，无 apiKey）", async () => {
    const { getEnabledModels } = await import("@/features/ai/llm/providers/registry");
    const { readModelsConfig } = await import("@/lib/models-config-store");

    vi.mocked(getEnabledModels).mockResolvedValue([
      siteEntry({ provider: "openai", modelName: "gpt-4o" }),
    ]);
    vi.mocked(readModelsConfig).mockResolvedValue({ providers: {} });

    const { getUnifiedModels, buildFullModelsConfig } = await import("@/lib/unified-model-registry");
    const unified = await getUnifiedModels("user-1");
    const result = buildFullModelsConfig(unified, await readModelsConfig());

    const provider = result.providers!["openai"]! as Record<string, unknown>;
    expect(provider.__source).toBe("site");
    expect(provider.apiKey).toBeUndefined();
    expect((provider.models as Record<string, unknown>[])[0]!.id).toBe("gpt-4o");
  });

  it("site+local 同名 provider → 合并 site 发现的额外模型，local 模型完整字段优先", async () => {
    const { getEnabledModels } = await import("@/features/ai/llm/providers/registry");
    const { readModelsConfig } = await import("@/lib/models-config-store");

    vi.mocked(getEnabledModels).mockResolvedValue([
      siteEntry({ provider: "deepseek", modelName: "deepseek-chat" }),
      siteEntry({ provider: "deepseek", modelName: "deepseek-reasoner", id: "deepseek:deepseek-reasoner" }),
    ]);
    vi.mocked(readModelsConfig).mockResolvedValue({
      providers: {
        deepseek: {
          api: "openai-completions",
          models: [{ id: "deepseek-chat", reasoning: true, thinkingLevelMap: { high: "deepseek-chat" } }],
        },
      },
    });

    const { getUnifiedModels, buildFullModelsConfig } = await import("@/lib/unified-model-registry");
    const unified = await getUnifiedModels("user-1");
    const result = buildFullModelsConfig(unified, await readModelsConfig());

    const provider = result.providers!["deepseek"]! as Record<string, unknown>;
    expect(provider.__source).toBe("local");
    const models = provider.models as Record<string, unknown>[];
    const ids = models.map((m) => m.id).sort();
    expect(ids).toEqual(["deepseek-chat", "deepseek-reasoner"]);

    const chat = models.find((m) => m.id === "deepseek-chat")!;
    expect(chat.reasoning).toBe(true);
    expect(chat.thinkingLevelMap).toEqual({ high: "deepseek-chat" });

    const reasoner = models.find((m) => m.id === "deepseek-reasoner")!;
    expect(reasoner.reasoning).toBeUndefined();
  });
});
