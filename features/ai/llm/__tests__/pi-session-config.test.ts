import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync } from "fs";

// 隔离 DB / Discovery 依赖：只测合成与合并逻辑
vi.mock("@/shared/db/client", () => ({ prisma: {} }));
vi.mock("../credentials/api-key-store", () => ({
  getUserProviderRecords: vi.fn(),
  getSystemCredentials: vi.fn(),
}));
vi.mock("../preferences/user-model-preferences", () => ({
  getUserModelPreferences: vi.fn(),
}));
vi.mock("@/lib/user-models-cache", () => ({
  loadUserModelsWithCache: vi.fn(async (_key: string, loader: () => unknown) => loader()),
}));
vi.mock("../providers/registry", () => ({
  getEnabledModels: vi.fn(),
}));
vi.mock("@/lib/models-config-store", () => ({
  readModelsConfig: vi.fn(),
}));

import { synthesizeSessionModelsConfig } from "../pi-session-config";
import { getUserProviderRecords, getSystemCredentials } from "../credentials/api-key-store";
import { getUserModelPreferences } from "../preferences/user-model-preferences";
import { getEnabledModels } from "../providers/registry";
import { readModelsConfig } from "@/lib/models-config-store";

describe("synthesizeSessionModelsConfig（Stage 8 会话级临时 models.json）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getUserProviderRecords).mockResolvedValue([]);
    vi.mocked(getSystemCredentials).mockResolvedValue([]);
    vi.mocked(getUserModelPreferences).mockResolvedValue([]);
    vi.mocked(getEnabledModels).mockResolvedValue([]);
    vi.mocked(readModelsConfig).mockResolvedValue({ providers: {} });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("站点模型补充进合成配置（含 api 字段），且不落任何 apiKey", async () => {
    vi.mocked(getSystemCredentials).mockResolvedValue([
      { provider: "agnes", baseURL: "https://agnes.example/v1", apiKey: "secret-key", transport: "proxy", apiFormat: "openai-chat", ownerType: "SYSTEM" },
    ]);
    vi.mocked(getEnabledModels).mockResolvedValue([
      {
        id: "agnes:agnes-2.5-flash", modelName: "agnes-2.5-flash", displayName: "Agnes 2.5 Flash",
        modelRef: "agnes:agnes-2.5-flash", capabilities: ["fast"], enabled: true,
        provider: "agnes", apiFormat: "openai-chat", ownerType: "SYSTEM",
      },
    ]);

    const handle = await synthesizeSessionModelsConfig("user-1");
    try {
      expect(existsSync(handle.modelsPath)).toBe(true);
      const written = JSON.parse(readFileSync(handle.modelsPath, "utf8")) as {
        providers: Record<string, { api?: string; apiKey?: string; models?: Array<{ id: string; name?: string }> }>;
      };
      expect(written.providers.agnes.models).toEqual([{ id: "agnes-2.5-flash", name: "Agnes 2.5 Flash" }]);
      expect(written.providers.agnes.api).toBe("openai-completions");
      // 安全：合成文件不包含任何站点凭证密钥
      expect(JSON.stringify(written)).not.toContain("secret-key");
      expect(written.providers.agnes.apiKey).toBeUndefined();
    } finally {
      handle.cleanup();
    }
  });

  it("workspace models.json 优先：同名 provider 不被站点视图覆盖", async () => {
    vi.mocked(readModelsConfig).mockResolvedValue({
      providers: {
        deepseek: { baseUrl: "https://api.deepseek.com", api: "openai-completions", apiKey: "ws-key", models: [{ id: "deepseek-chat" }] },
      },
    });
    vi.mocked(getEnabledModels).mockResolvedValue([
      {
        id: "deepseek:deepseek-v4-pro", modelName: "deepseek-v4-pro", displayName: "deepseek-v4-pro",
        modelRef: "deepseek:deepseek-v4-pro", capabilities: ["strong"], enabled: true,
        provider: "deepseek", apiFormat: "openai-chat", ownerType: "USER",
      },
    ]);

    const handle = await synthesizeSessionModelsConfig("user-1");
    try {
      const written = JSON.parse(readFileSync(handle.modelsPath, "utf8")) as {
        providers: Record<string, { models?: Array<{ id: string }> }>;
      };
      // workspace 版本保持原样（只有 deepseek-chat），站点模型未混入
      expect(written.providers.deepseek.models).toEqual([{ id: "deepseek-chat" }]);
    } finally {
      handle.cleanup();
    }
  });

  it("偏好注入：thinkingLevel → reasoning + thinkingLevelMap（字段级）", async () => {
    vi.mocked(getEnabledModels).mockResolvedValue([
      {
        id: "anthropic:claude-sonnet-4", modelName: "claude-sonnet-4", displayName: "claude-sonnet-4",
        modelRef: "anthropic:claude-sonnet-4", capabilities: ["reasoning"], enabled: true,
        provider: "anthropic", apiFormat: "anthropic", ownerType: "USER",
      },
    ]);
    vi.mocked(getUserProviderRecords).mockResolvedValue([{ provider: "anthropic", baseURL: null }]);
    vi.mocked(getUserModelPreferences).mockResolvedValue([
      { provider: "anthropic", modelId: "claude-sonnet-4", enabled: true, favorite: false, thinkingLevel: "high", temperature: null, maxTokens: null, updatedAt: new Date().toISOString() },
    ]);

    const handle = await synthesizeSessionModelsConfig("user-1");
    try {
      const written = JSON.parse(readFileSync(handle.modelsPath, "utf8")) as {
        providers: Record<string, { models?: Array<{ id: string; reasoning?: boolean; thinkingLevelMap?: Record<string, string | null> }> }>;
      };
      const model = written.providers.anthropic.models?.[0];
      expect(model?.reasoning).toBe(true);
      expect(model?.thinkingLevelMap).toEqual({ high: "high" });
    } finally {
      handle.cleanup();
    }
  });

  it("thinkingLevel=off 或缺失时不注入", async () => {
    vi.mocked(getEnabledModels).mockResolvedValue([
      {
        id: "anthropic:claude-sonnet-4", modelName: "claude-sonnet-4", displayName: "claude-sonnet-4",
        modelRef: "anthropic:claude-sonnet-4", capabilities: ["reasoning"], enabled: true,
        provider: "anthropic", apiFormat: "anthropic", ownerType: "USER",
      },
    ]);
    vi.mocked(getUserProviderRecords).mockResolvedValue([{ provider: "anthropic", baseURL: null }]);
    vi.mocked(getUserModelPreferences).mockResolvedValue([
      { provider: "anthropic", modelId: "claude-sonnet-4", enabled: true, favorite: false, thinkingLevel: "off", temperature: null, maxTokens: null, updatedAt: new Date().toISOString() },
    ]);

    const handle = await synthesizeSessionModelsConfig("user-1");
    try {
      const written = JSON.parse(readFileSync(handle.modelsPath, "utf8")) as {
        providers: Record<string, { models?: Array<{ thinkingLevelMap?: unknown }> }>;
      };
      expect(written.providers.anthropic.models?.[0]?.thinkingLevelMap).toBeUndefined();
    } finally {
      handle.cleanup();
    }
  });

  it("cleanup 幂等且真实删除临时目录", async () => {
    const handle = await synthesizeSessionModelsConfig("user-1");
    const dir = handle.modelsPath.replace(/\/models\.json$/, "");
    expect(existsSync(dir)).toBe(true);
    handle.cleanup();
    expect(existsSync(dir)).toBe(false);
    // 二次调用不抛错
    handle.cleanup();
  });

  it("system 用户（无会话上下文）仅用 SYSTEM 视图，不查偏好", async () => {
    const handle = await synthesizeSessionModelsConfig("system");
    try {
      expect(getUserModelPreferences).not.toHaveBeenCalled();
      expect(getUserProviderRecords).not.toHaveBeenCalled();
    } finally {
      handle.cleanup();
    }
  });
});
