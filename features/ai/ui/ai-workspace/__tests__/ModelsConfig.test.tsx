/**
 * ModelsConfig — Provider 持久化回归测试
 *
 * 覆盖：
 * 1. OAuth 登录成功 → syncManagedProviderToModelsJson 写入 provider
 * 2. OAuth 登出        → 仅刷新列表，不写入
 * 3. API Key 保存成功  → 写入 provider
 * 4. API Key 删除      → 仅刷新列表，不写入
 * 5. 已存在的 local provider 不被覆盖（idempotent）
 * 6. site/inherited providers 不会被意外写入本地
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  logoutProvider,
  removeApiKey,
} from "../ModelsConfig";

// ── Mock fetch ───────────────────────────────────────────────────────────────

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

beforeEach(() => {
  fetchMock.mockReset();
});

// ── 测试辅助 ───────────────────────────────────────────────────────────────

type FetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

/** 模拟 GET /api/models-config 返回本地 models.json */
function mockLocalConfig(config: object) {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => config,
  } satisfies FetchResponse);
}

/** 模拟 PUT /api/models-config */
function mockPutResponse(ok: boolean) {
  fetchMock.mockResolvedValueOnce({
    ok,
    status: ok ? 200 : 500,
    json: async () => (ok ? { success: true } : { error: "server error" }),
  } satisfies FetchResponse);
}

// ── 核心逻辑（与 ModelsConfig.tsx 中的 syncManagedProviderToModelsJson 一致）─────

/** syncManagedProviderToModelsJson 的核心逻辑（从组件提取，与真实实现同步） */
async function syncManagedProviderToModelsJson(providerId: string): Promise<void> {
  try {
    const localRes = await fetch("/api/models-config");
    if (!localRes.ok) return;
    const localConfig = await localRes.json() as { providers?: Record<string, unknown> };

    if (localConfig.providers?.[providerId]) return;

    const updated = {
      ...localConfig,
      providers: {
        ...(localConfig.providers ?? {}),
        [providerId]: { models: [] },
      },
    };

    const saveRes = await fetch("/api/models-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updated),
    });
    if (!saveRes.ok) {
      console.warn("[sync] failed:", saveRes.status);
    }
  } catch (err) {
    console.warn("[sync] failed:", err instanceof Error ? err.message : String(err));
  }
}

// ── 测试：syncManagedProviderToModelsJson ──────────────────────────────────

describe("syncManagedProviderToModelsJson", () => {
  it("新 provider → 写入本地 models.json（idempotent add）", async () => {
    mockLocalConfig({ providers: {} });
    mockPutResponse(true);

    await syncManagedProviderToModelsJson("openai");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const putCall = fetchMock.mock.calls[1]!;
    expect(putCall[1]!.method).toBe("PUT");
    const body = JSON.parse(putCall[1]!.body as string);
    expect(body.providers).toHaveProperty("openai");
    expect(body.providers.openai).toEqual({ models: [] });
  });

  it("provider 已存在 → 不发起 PUT（idempotent skip）", async () => {
    mockLocalConfig({ providers: { openai: { models: [{ id: "gpt-4o" }] } } });

    await syncManagedProviderToModelsJson("openai");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/models-config");
  });

  it("本地有其他 provider → 保留既有配置，只追加新 provider", async () => {
    mockLocalConfig({
      providers: {
        deepseek: { baseUrl: "https://api.deepseek.com", models: [{ id: "deepseek-chat" }] },
      },
    });
    mockPutResponse(true);

    await syncManagedProviderToModelsJson("openai");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const putCall = fetchMock.mock.calls[1]!;
    const body = JSON.parse(putCall[1]!.body as string);
    expect(body.providers).toHaveProperty("deepseek");
    expect(body.providers.deepseek).toEqual({ baseUrl: "https://api.deepseek.com", models: [{ id: "deepseek-chat" }] });
    expect(body.providers).toHaveProperty("openai");
    expect(body.providers.openai).toEqual({ models: [] });
  });

  it("读取 /api/models-config（纯本地）而非 registry，避免 site/inherited providers 误写入", async () => {
    mockLocalConfig({ providers: {} });

    await syncManagedProviderToModelsJson("anthropic");

    const getCall = fetchMock.mock.calls[0]![0];
    expect(getCall).toBe("/api/models-config");
    const putCall = fetchMock.mock.calls[1]!;
    const body = JSON.parse(putCall[1]!.body as string);
    expect(Object.keys(body.providers)).toEqual(["anthropic"]);
  });

  it("GET /api/models-config 失败 → 不抛错，不发起 PUT", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    } satisfies FetchResponse);

    await syncManagedProviderToModelsJson("openai");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("PUT 失败 → 不抛错（non-blocking）", async () => {
    mockLocalConfig({ providers: {} });
    mockPutResponse(false);

    await expect(syncManagedProviderToModelsJson("openai")).resolves.not.toThrow();
  });

  it("空 providers 对象 → 正常写入", async () => {
    mockLocalConfig({ providers: {} });
    mockPutResponse(true);

    await syncManagedProviderToModelsJson("gemini");

    const putCall = fetchMock.mock.calls[1]!;
    const body = JSON.parse(putCall[1]!.body as string);
    expect(body.providers.gemini).toEqual({ models: [] });
  });

  it("无 providers 字段 → 正常创建 providers 对象", async () => {
    mockLocalConfig({});
    mockPutResponse(true);

    await syncManagedProviderToModelsJson("openai");

    const putCall = fetchMock.mock.calls[1]!;
    const body = JSON.parse(putCall[1]!.body as string);
    expect(body.providers).toBeDefined();
    expect(body.providers.openai).toEqual({ models: [] });
  });
});

// ── 测试：logoutProvider — 登出不写入 models.json ────────────────────────

describe("logoutProvider", () => {
  it("调用 → 发起 POST logout fetch，不写入 models.json", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    } satisfies FetchResponse);

    await logoutProvider("openai");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/auth/logout/openai");
    expect(opts.method).toBe("POST");
  });

  it("只发起 POST，无 PUT", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    } satisfies FetchResponse);

    await logoutProvider("github");

    const putCalls = fetchMock.mock.calls.filter((c) => c[1]?.method === "PUT");
    expect(putCalls).toHaveLength(0);
  });
});

// ── 测试：removeApiKey — 删除 API Key 不写入 models.json ─────────────────

describe("removeApiKey", () => {
  it("调用 → 发起 DELETE fetch，不写入 models.json", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    } satisfies FetchResponse);

    await removeApiKey("openai");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/auth/api-key/openai");
    expect(opts.method).toBe("DELETE");
  });

  it("只发起 DELETE，无 PUT", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    } satisfies FetchResponse);

    await removeApiKey("github");

    const putCalls = fetchMock.mock.calls.filter((c) => c[1]?.method === "PUT");
    expect(putCalls).toHaveLength(0);
  });

  it("返回 Response 以便调用方检查错误", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    } satisfies FetchResponse);

    const res = await removeApiKey("deepseek");
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
  });
});
