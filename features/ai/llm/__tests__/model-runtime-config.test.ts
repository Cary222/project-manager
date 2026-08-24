import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ModelCatalogEntry } from "../providers/types";

// 隔离 DB / Discovery 依赖：resolver 只测合并与查找逻辑
vi.mock("@/shared/db/client", () => ({ prisma: {} }));
vi.mock("../providers/registry", () => ({
  getEnabledModels: vi.fn(),
}));
vi.mock("@/lib/user-models-cache", () => ({
  loadUserModelsWithCache: vi.fn(async (_key: string, loader: () => unknown) => loader()),
}));
vi.mock("../preferences/user-model-preferences", () => ({
  getModelPreference: vi.fn(),
}));

import {
  availableReasoningLevels,
  buildReasoningProviderOptions,
  isReasoningLevel,
  isReasoningModel,
  mergeRuntimeConfig,
  reasoningLevelToOpenAiEffort,
  resolveModelRuntimeConfig,
} from "../model-runtime-config";
import { getEnabledModels } from "../providers/registry";
import { getModelPreference } from "../preferences/user-model-preferences";

function entry(partial: Partial<ModelCatalogEntry> = {}): ModelCatalogEntry {
  return {
    id: "test:model",
    modelName: "model",
    displayName: "Test Model",
    modelRef: "test:model",
    capabilities: ["standard"],
    enabled: true,
    provider: "test",
    apiFormat: "openai-chat",
    ...partial,
  };
}

describe("availableReasoningLevels", () => {
  it("不支持 reasoning 的模型返回空集（UI 不渲染 Thinking Selector）", () => {
    expect(availableReasoningLevels(entry({ capabilities: ["fast"] }))).toEqual([]);
  });

  it("catalog 显式 reasoning=false 时即使有 capability 也不支持", () => {
    expect(
      availableReasoningLevels(entry({ capabilities: ["reasoning"], reasoning: false })),
    ).toEqual([]);
  });

  it("DeepSeek 系推理模型返回 off/low/high", () => {
    expect(
      availableReasoningLevels(entry({ provider: "deepseek", modelName: "deepseek-r1", capabilities: ["reasoning"] })),
    ).toEqual(["off", "low", "high"]);
  });

  it("Anthropic 系推理模型返回 off/low/medium/high", () => {
    expect(
      availableReasoningLevels(entry({ provider: "anthropic", modelName: "claude-sonnet-4", reasoning: true })),
    ).toEqual(["off", "low", "medium", "high"]);
  });

  it("OpenAI o 系列支持 minimal", () => {
    expect(
      availableReasoningLevels(entry({ provider: "openai", modelName: "o3-mini", reasoning: true })),
    ).toEqual(["off", "minimal", "low", "medium", "high"]);
  });

  it("其他推理模型返回通用默认集（不含 Pi Workspace 的 max/xhigh 全集）", () => {
    expect(
      availableReasoningLevels(entry({ provider: "custom", modelName: "my-reasoner", capabilities: ["reasoning"] })),
    ).toEqual(["off", "low", "medium", "high"]);
  });
});

describe("isReasoningModel / isReasoningLevel", () => {
  it("capability reasoning → 支持", () => {
    expect(isReasoningModel(entry({ capabilities: ["reasoning"] }))).toBe(true);
  });

  it("level 校验拒绝未知值", () => {
    expect(isReasoningLevel("max")).toBe(false);
    expect(isReasoningLevel("high")).toBe(true);
    expect(isReasoningLevel(123)).toBe(false);
  });
});

describe("mergeRuntimeConfig（字段级合并）", () => {
  it("无覆盖时沿用 catalog / provider 默认", () => {
    const config = mergeRuntimeConfig(
      entry({ reasoning: true, contextWindow: 128_000, maxTokens: 8192 }),
      null,
    );
    expect(config.reasoning).toEqual({ enabled: true });
    expect(config.contextWindow).toBe(128_000);
    expect(config.maxTokens).toBe(8192);
    expect(config.temperature).toBeUndefined();
  });

  it("用户 temperature 只覆盖 temperature", () => {
    const config = mergeRuntimeConfig(
      entry({ reasoning: true, maxTokens: 8192 }),
      { thinkingLevel: null, temperature: 0.2, maxTokens: null },
    );
    expect(config.temperature).toBe(0.2);
    expect(config.maxTokens).toBe(8192);
    expect(config.reasoning).toEqual({ enabled: true });
  });

  it("thinkingLevel=off → reasoning.enabled=false", () => {
    const config = mergeRuntimeConfig(entry({ reasoning: true }), { thinkingLevel: "off" });
    expect(config.reasoning).toEqual({ enabled: false, level: "off" });
  });

  it("thinkingLevel 不在模型支持集内时被忽略", () => {
    const config = mergeRuntimeConfig(
      entry({ provider: "deepseek", modelName: "deepseek-r1", capabilities: ["reasoning"] }),
      { thinkingLevel: "minimal" }, // deepseek 只支持 off/low/high
    );
    expect(config.reasoning).toEqual({ enabled: true });
  });

  it("不支持 reasoning 的模型不携带 reasoning 字段", () => {
    const config = mergeRuntimeConfig(entry({ capabilities: ["fast"] }), { thinkingLevel: "high" });
    expect(config.reasoning).toBeUndefined();
  });

  it("用户 maxTokens 覆盖 catalog maxTokens", () => {
    const config = mergeRuntimeConfig(entry({ maxTokens: 8192 }), { maxTokens: 2048 });
    expect(config.maxTokens).toBe(2048);
  });
});

describe("resolveModelRuntimeConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("modelRef → User Scope 模型 + preference 字段级覆盖", async () => {
    vi.mocked(getEnabledModels).mockResolvedValue([
      entry({ provider: "anthropic", modelName: "claude-sonnet-4", modelRef: "anthropic:claude-sonnet-4", reasoning: true }),
    ]);
    vi.mocked(getModelPreference).mockResolvedValue({
      provider: "anthropic",
      modelId: "claude-sonnet-4",
      enabled: true,
      favorite: false,
      thinkingLevel: "high",
      temperature: null,
      maxTokens: null,
      updatedAt: new Date().toISOString(),
    });

    const config = await resolveModelRuntimeConfig("user-1", "anthropic:claude-sonnet-4");
    expect(config.reasoning).toEqual({ enabled: true, level: "high" });
    expect(getModelPreference).toHaveBeenCalledWith("user-1", "anthropic", "claude-sonnet-4");
  });

  it("模型不在 User Scope 时抛出明确错误", async () => {
    vi.mocked(getEnabledModels).mockResolvedValue([]);
    await expect(resolveModelRuntimeConfig("user-1", "missing:model")).rejects.toThrow(
      /not found in user scope/i,
    );
  });

  it("匿名用户不查询 preference", async () => {
    vi.mocked(getEnabledModels).mockResolvedValue([entry()]);
    const config = await resolveModelRuntimeConfig(undefined, "test:model");
    expect(config.modelRef).toBe("test:model");
    expect(getModelPreference).not.toHaveBeenCalled();
  });
});

describe("buildReasoningProviderOptions（Stage 7 provider-specific 注入）", () => {
  it("未启用/无 level/off 时不注入（行为与接入前一致）", () => {
    expect(buildReasoningProviderOptions({ provider: "anthropic", modelId: "claude-3", apiFormat: "anthropic" })).toBeUndefined();
    expect(buildReasoningProviderOptions({ provider: "anthropic", modelId: "claude-3", apiFormat: "anthropic", reasoning: { enabled: false, level: "high" } })).toBeUndefined();
    expect(buildReasoningProviderOptions({ provider: "anthropic", modelId: "claude-3", apiFormat: "anthropic", reasoning: { enabled: true, level: "off" } })).toBeUndefined();
    expect(buildReasoningProviderOptions({ provider: "anthropic", modelId: "claude-3", apiFormat: "anthropic", reasoning: { enabled: true } })).toBeUndefined();
  });

  it("anthropic → thinking budgetTokens 映射", () => {
    const options = buildReasoningProviderOptions({
      provider: "anthropic",
      modelId: "claude-sonnet-4",
      apiFormat: "anthropic",
      reasoning: { enabled: true, level: "high" },
    }) as Record<string, Record<string, unknown>>;
    expect(options.anthropic.thinking).toEqual({ type: "enabled", budgetTokens: 16384 });
  });

  it("apiFormat=anthropic 的自定义中转站同样注入", () => {
    const options = buildReasoningProviderOptions({
      provider: "my-relay",
      modelId: "claude-3-5-sonnet",
      apiFormat: "anthropic",
      reasoning: { enabled: true, level: "low" },
    }) as Record<string, Record<string, unknown>>;
    expect(options.anthropic.thinking).toEqual({ type: "enabled", budgetTokens: 2048 });
  });

  it("openai → reasoningEffort 映射（xhigh 归并 high）", () => {
    const options = buildReasoningProviderOptions({
      provider: "openai",
      modelId: "gpt-5",
      apiFormat: "openai-chat",
      reasoning: { enabled: true, level: "xhigh" },
    }) as Record<string, Record<string, unknown>>;
    expect(options.openai.reasoningEffort).toBe("high");
    expect(reasoningLevelToOpenAiEffort("minimal")).toBe("minimal");
  });

  it("deepseek provider → thinking.type=enabled（不传无效的 reasoningEffort）", () => {
    const options = buildReasoningProviderOptions({
      provider: "deepseek",
      modelId: "deepseek-chat",
      apiFormat: "openai-chat",
      reasoning: { enabled: true, level: "high" },
    }) as Record<string, Record<string, unknown>>;
    expect(options.deepseek.thinking).toEqual({ type: "enabled" });
    expect(options.deepseek.reasoningEffort).toBeUndefined();
  });

  it("非 deepseek provider 但模型名包含 deepseek 也注入（中转站场景）", () => {
    const options = buildReasoningProviderOptions({
      provider: "my-relay",
      modelId: "deepseek-r1",
      apiFormat: "openai-chat",
      reasoning: { enabled: true, level: "medium" },
    }) as Record<string, Record<string, unknown>>;
    expect(options.deepseek.thinking).toEqual({ type: "enabled" });
  });

  it("其他 provider 暂不注入（不传无效参数）", () => {
    expect(buildReasoningProviderOptions({
      provider: "qwen",
      modelId: "qwen3-max",
      apiFormat: "openai-chat",
      reasoning: { enabled: true, level: "high" },
    })).toBeUndefined();
  });
});
