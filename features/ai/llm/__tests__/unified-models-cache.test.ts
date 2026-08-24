/**
 * Unified Models Cache — 单元测试
 *
 * 测试范围：
 * 1. loadUnifiedModelsWithCache 命中缓存时直接返回，不调用 loader
 * 2. loadUnifiedModelsWithCache 缓存过期后重新调用 loader
 * 3. invalidateUnifiedModelsCache 全量失效（generation 递增，entries/inFlight 清空）
 * 4. USER 凭证变更（saveApiKey/deleteApiKeyById/deleteApiKey）
 *    → invalidateUnifiedModelsCache 全量失效
 * 5. SYSTEM 凭证变更（saveSystemProvider/deleteSystemProviderById/deleteSystemProvider）
 *    → invalidateUnifiedModelsCache 全量失效
 * 6. 失败路径不触发失效（loader throw 时缓存不写入）
 * 7. null userId 不走缓存，直接调用 loader
 * 8. 不同 userId 缓存独立，generation 递增对所有用户均生效
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// 环境变量（必须在 mock 之前设置）
// ---------------------------------------------------------------------------

process.env.ENCRYPTION_KEY = "0".repeat(64);

// ---------------------------------------------------------------------------
// Mock 层（模块级别）
// ---------------------------------------------------------------------------

// Mock DB — 凭证存储层隔离（提供完整 shape，避免运行时错误）
const mockPrisma = {
  userApiKey: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
};
vi.mock("@/shared/db/client", () => ({ prisma: mockPrisma }));

vi.mock("@/lib/user-models-cache", () => ({
  invalidateUserModelsCache: vi.fn(),
  invalidateAllUserModelsCache: vi.fn(),
}));

vi.mock("./encryption", () => ({
  encrypt: vi.fn(() => ({ encryptedKey: "encrypted", iv: "iv", authTag: "tag" })),
  decrypt: vi.fn(() => "decrypted-key"),
  hashApiKey: vi.fn(() => "hashed-key"),
}));

vi.mock("@/lib/normalize-base-url", () => ({
  normalizeBaseURL: vi.fn((url: string) => url.replace(/\/$/, "") + "/v1"),
  getEffectiveBaseURL: vi.fn(() => "https://default.example.com/v1"),
}));

// ---------------------------------------------------------------------------
// 辅助函数：重置 unified cache 状态
// ---------------------------------------------------------------------------

async function resetCache() {
  const { __resetUnifiedModelsCacheState } = await import("@/lib/unified-models-cache");
  __resetUnifiedModelsCacheState();
}

// ---------------------------------------------------------------------------
// 测试：缓存基础行为
// ---------------------------------------------------------------------------

describe("loadUnifiedModelsWithCache — 基础缓存行为", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    await resetCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("缓存未命中时调用 loader 并缓存结果", async () => {
    const { loadUnifiedModelsWithCache } = await import("@/lib/unified-models-cache");

    const loader = vi.fn().mockResolvedValue([
      { provider: "openai", baseURL: null, apiFormat: "openai-chat", models: [], source: "local" as const },
    ]);

    const result = await loadUnifiedModelsWithCache("user-1", loader);

    expect(result).toHaveLength(1);
    expect(loader).toHaveBeenCalledTimes(1);

    // 第二次调用应命中缓存，不再次调用 loader
    const cached = await loadUnifiedModelsWithCache("user-1", loader);
    expect(cached).toHaveLength(1);
    expect(loader).toHaveBeenCalledTimes(1);

    // 失效后重新调用 loader
    const { invalidateUnifiedModelsCache } = await import("@/lib/unified-models-cache");
    invalidateUnifiedModelsCache();
    const afterInvalidate = await loadUnifiedModelsWithCache("user-1", loader);
    expect(afterInvalidate).toHaveLength(1);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("缓存 TTL 过期后重新调用 loader", async () => {
    const { loadUnifiedModelsWithCache } = await import("@/lib/unified-models-cache");

    const loader = vi.fn().mockResolvedValue([
      { provider: "openai", baseURL: null, apiFormat: "openai-chat", models: [], source: "local" as const },
    ]);

    // 第一次调用，缓存
    await loadUnifiedModelsWithCache("user-1", loader);
    expect(loader).toHaveBeenCalledTimes(1);

    // 快进 4 分钟（未过期）
    await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
    await loadUnifiedModelsWithCache("user-1", loader);
    expect(loader).toHaveBeenCalledTimes(1);

    // 再快进 1 分钟（刚好 5 分钟过期）
    await vi.advanceTimersByTimeAsync(1 * 60 * 1000);
    await loadUnifiedModelsWithCache("user-1", loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("loader 抛出异常时 rejected，不写入缓存", async () => {
    const { loadUnifiedModelsWithCache } = await import("@/lib/unified-models-cache");

    const loader = vi.fn().mockRejectedValue(new Error("API error"));

    await expect(loadUnifiedModelsWithCache("user-1", loader)).rejects.toThrow("API error");
    expect(loader).toHaveBeenCalledTimes(1);

    // 缓存未写入，第二次调用 loader 仍应被调用
    const successLoader = vi.fn().mockResolvedValue([
      {
        provider: "openai",
        baseURL: null,
        apiFormat: "openai-chat",
        models: [],
        source: "local" as const,
      },
    ]);

    const result = await loadUnifiedModelsWithCache("user-1", successLoader);
    expect(result).toHaveLength(1);
    expect(successLoader).toHaveBeenCalledTimes(1);
  });

  it("null userId 不走缓存，直接调用 loader（每次都重新加载）", async () => {
    const { loadUnifiedModelsWithCache } = await import("@/lib/unified-models-cache");

    const loader = vi.fn().mockResolvedValue([
      {
        provider: "openai",
        baseURL: null,
        apiFormat: "openai-chat",
        models: [],
        source: "local" as const,
      },
    ]);

    const result = await loadUnifiedModelsWithCache(null, loader);
    expect(result).toHaveLength(1);
    expect(loader).toHaveBeenCalledTimes(1);

    // 多次调用不走缓存
    await loadUnifiedModelsWithCache(null, loader);
    await loadUnifiedModelsWithCache(null, loader);
    expect(loader).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// 测试：generation counter 失效
// ---------------------------------------------------------------------------

describe("invalidateUnifiedModelsCache — generation counter 全量失效", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    await resetCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("invalidateUnifiedModelsCache 递增 generation，废弃旧缓存", async () => {
    const { loadUnifiedModelsWithCache, invalidateUnifiedModelsCache } = await import(
      "@/lib/unified-models-cache"
    );

    const loader = vi.fn().mockResolvedValue([
      {
        provider: "openai",
        baseURL: null,
        apiFormat: "openai-chat",
        models: [],
        source: "local" as const,
      },
    ]);

    // 第一次填充缓存
    await loadUnifiedModelsWithCache("user-1", loader);
    expect(loader).toHaveBeenCalledTimes(1);

    // 第二次调用命中缓存
    await loadUnifiedModelsWithCache("user-1", loader);
    expect(loader).toHaveBeenCalledTimes(1);

    // 失效后，generation 递增，旧缓存被废弃
    invalidateUnifiedModelsCache();
    await loadUnifiedModelsWithCache("user-1", loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("invalidateUnifiedModelsCache 清空 entries 和 inFlight", async () => {
    const { loadUnifiedModelsWithCache, invalidateUnifiedModelsCache } = await import(
      "@/lib/unified-models-cache"
    );

    const loader = vi.fn().mockResolvedValue([
      {
        provider: "openai",
        baseURL: null,
        apiFormat: "openai-chat",
        models: [],
        source: "local" as const,
      },
    ]);

    await loadUnifiedModelsWithCache("user-1", loader);
    await loadUnifiedModelsWithCache("user-2", loader);
    expect(loader).toHaveBeenCalledTimes(2);

    // 全量失效
    invalidateUnifiedModelsCache();

    // 所有用户的缓存均被清空，重新调用 loader
    await loadUnifiedModelsWithCache("user-1", loader);
    await loadUnifiedModelsWithCache("user-2", loader);
    expect(loader).toHaveBeenCalledTimes(4);
  });

  it("generation 递增对所有用户均生效（不同于 userModelsCache 的 per-user 策略）", async () => {
    const { loadUnifiedModelsWithCache, invalidateUnifiedModelsCache } = await import(
      "@/lib/unified-models-cache"
    );

    const loader1 = vi.fn().mockResolvedValue([
      {
        provider: "openai",
        baseURL: null,
        apiFormat: "openai-chat",
        models: [{ provider: "openai", modelName: "gpt-4o", modelRef: "openai:gpt-4o", displayName: "GPT-4o", capabilities: [], apiFormat: "openai-chat", source: "local" as const }],
        source: "local" as const,
      },
    ]);
    const loader2 = vi.fn().mockResolvedValue([
      {
        provider: "deepseek",
        baseURL: null,
        apiFormat: "openai-chat",
        models: [{ provider: "deepseek", modelName: "deepseek-chat", modelRef: "deepseek:deepseek-chat", displayName: "DeepSeek Chat", capabilities: [], apiFormat: "openai-chat", source: "local" as const }],
        source: "local" as const,
      },
    ]);

    await loadUnifiedModelsWithCache("user-1", loader1);
    await loadUnifiedModelsWithCache("user-2", loader2);
    expect(loader1).toHaveBeenCalledTimes(1);
    expect(loader2).toHaveBeenCalledTimes(1);

    // 失效后，所有用户缓存均被清空（unified cache 为全局 generation）
    invalidateUnifiedModelsCache();

    const result1 = await loadUnifiedModelsWithCache("user-1", loader1);
    const result2 = await loadUnifiedModelsWithCache("user-2", loader2);
    expect(result1[0]!.provider).toBe("openai");
    expect(result2[0]!.provider).toBe("deepseek");
    expect(loader1).toHaveBeenCalledTimes(2);
    expect(loader2).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// 测试：api-key-store 凭证变更触发 unified cache 失效
// ---------------------------------------------------------------------------

describe("api-key-store — 凭证变更触发 unified cache 失效", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    await resetCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const userRecord = {
    id: "key-1",
    userId: "user-1",
    ownerType: "USER" as const,
    provider: "openai",
    name: "My OpenAI Key",
    baseURL: null,
    encryptedKey: "encrypted",
    iv: "iv",
    authTag: "tag",
    keyLast4: "1234",
    keyHash: "hashed",
    transport: "direct" as const,
    apiFormat: "openai-chat" as const,
    lastUsedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  const systemRecord = {
    id: "sys-key-1",
    userId: null as const,
    ownerType: "SYSTEM" as const,
    provider: "agnes",
    name: "Agnes System Key",
    baseURL: null,
    encryptedKey: "encrypted",
    iv: "iv",
    authTag: "tag",
    keyLast4: "5678",
    keyHash: "hashed",
    transport: "proxy" as const,
    apiFormat: "openai-responses" as const,
    lastUsedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  it("saveApiKey 成功后触发 invalidateUnifiedModelsCache（USER 凭证变更）", async () => {
    mockPrisma.userApiKey.findFirst.mockResolvedValue(null);
    mockPrisma.userApiKey.create.mockResolvedValue(userRecord);

    const { loadUnifiedModelsWithCache } = await import("@/lib/unified-models-cache");
    const { saveApiKey } = await import("@/features/ai/llm/credentials/api-key-store");

    const loader = vi.fn().mockResolvedValue([
      {
        provider: "openai",
        baseURL: null,
        apiFormat: "openai-chat",
        models: [],
        source: "local" as const,
      },
    ]);

    // 先填充缓存
    await loadUnifiedModelsWithCache("user-1", loader);
    expect(loader).toHaveBeenCalledTimes(1);

    // 保存 key，应触发失效
    await saveApiKey({
      userId: "user-1",
      provider: "openai",
      name: "My OpenAI Key",
      apiKey: "sk-test-1234",
    });

    // 缓存已失效，重新调用 loader
    await loadUnifiedModelsWithCache("user-1", loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("saveSystemProvider 成功后触发 invalidateUnifiedModelsCache（SYSTEM 影响全局）", async () => {
    mockPrisma.userApiKey.findFirst.mockResolvedValue(null);
    mockPrisma.userApiKey.create.mockResolvedValue(systemRecord);

    const { loadUnifiedModelsWithCache } = await import("@/lib/unified-models-cache");
    const { saveSystemProvider } = await import("@/features/ai/llm/credentials/api-key-store");

    const loader = vi.fn().mockResolvedValue([
      {
        provider: "agnes",
        baseURL: null,
        apiFormat: "openai-responses",
        models: [],
        source: "local" as const,
      },
    ]);

    // 填充两个用户的缓存
    await loadUnifiedModelsWithCache("user-1", loader);
    await loadUnifiedModelsWithCache("user-2", loader);
    expect(loader).toHaveBeenCalledTimes(2);

    // SYSTEM provider 变更，全量失效
    await saveSystemProvider({
      provider: "agnes",
      name: "Agnes System Key",
      apiKey: "sk-agnes-5678",
    });

    // 所有用户缓存均被清空
    await loadUnifiedModelsWithCache("user-1", loader);
    await loadUnifiedModelsWithCache("user-2", loader);
    expect(loader).toHaveBeenCalledTimes(4);
  });

  it("deleteApiKeyById 成功后触发 invalidateUnifiedModelsCache", async () => {
    mockPrisma.userApiKey.findFirst.mockResolvedValue({ id: "key-1" });
    mockPrisma.userApiKey.updateMany.mockResolvedValue({ count: 1 });

    const { loadUnifiedModelsWithCache } = await import("@/lib/unified-models-cache");
    const { deleteApiKeyById } = await import("@/features/ai/llm/credentials/api-key-store");

    const loader = vi.fn().mockResolvedValue([
      {
        provider: "deepseek",
        baseURL: null,
        apiFormat: "openai-chat",
        models: [],
        source: "local" as const,
      },
    ]);

    await loadUnifiedModelsWithCache("user-1", loader);
    expect(loader).toHaveBeenCalledTimes(1);

    await deleteApiKeyById("key-1", "user-1");

    await loadUnifiedModelsWithCache("user-1", loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("deleteSystemProvider 成功后触发 invalidateUnifiedModelsCache", async () => {
    mockPrisma.userApiKey.findFirst.mockResolvedValue({ id: "sys-key-1" });
    mockPrisma.userApiKey.updateMany.mockResolvedValue({ count: 1 });

    const { loadUnifiedModelsWithCache } = await import("@/lib/unified-models-cache");
    const { deleteSystemProvider } = await import("@/features/ai/llm/credentials/api-key-store");

    const loader = vi.fn().mockResolvedValue([
      {
        provider: "openai",
        baseURL: null,
        apiFormat: "openai-chat",
        models: [],
        source: "local" as const,
      },
    ]);

    await loadUnifiedModelsWithCache("user-1", loader);
    await loadUnifiedModelsWithCache("user-2", loader);
    expect(loader).toHaveBeenCalledTimes(2);

    await deleteSystemProvider("openai");

    await loadUnifiedModelsWithCache("user-1", loader);
    await loadUnifiedModelsWithCache("user-2", loader);
    expect(loader).toHaveBeenCalledTimes(4);
  });
});
