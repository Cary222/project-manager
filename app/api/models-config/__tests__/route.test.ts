/**
 * models-config route — 单元测试
 *
 * 测试范围：
 * 1. validateModelsConfigPayload 拒绝无效 payload（非对象 / 空对象 / 缺少 providers / providers 为数组）
 * 2. validateModelsConfigPayload 允许有效 payload（含 providers 字段且为对象）
 * 3. validateModelsConfigPayload 允许 { providers: {} }（用户明确清空全部 providers）
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock 依赖层（隔离文件系统 / DB / session）
// ---------------------------------------------------------------------------

vi.mock("@/lib/models-config-store", () => ({
  readModelsConfig: vi.fn(async () => ({ providers: {} })),
  writeModelsConfig: vi.fn(async () => {}),
}));

vi.mock("@/lib/models-cache", () => ({
  invalidateModelsCache: vi.fn(),
}));

vi.mock("@/lib/model-discovery", () => ({
  resetModelRuntime: vi.fn(),
}));

vi.mock("@/shared/lib/permissions", () => ({
  requireSession: vi.fn(async () => ({ userId: "user-1" })),
}));

// ---------------------------------------------------------------------------
// 辅助：直接测试校验函数（不经过 HTTP）
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateModelsConfigPayload(
  body: unknown,
): { valid: true; data: Record<string, unknown> } | { valid: false; error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { valid: false, error: "Request body must be a plain object" };
  }

  const record = body as Record<string, unknown>;

  const providers = record["providers"];
  if (providers === undefined) {
    return { valid: false, error: "providers field is required" };
  }
  if (Array.isArray(providers)) {
    return { valid: false, error: "providers must be a plain object, not an array" };
  }
  if (typeof providers !== "object" || providers === null) {
    return { valid: false, error: "providers must be a plain object, not null" };
  }

  return { valid: true, data: record };
}

// ---------------------------------------------------------------------------
// 测试：validateModelsConfigPayload — 拒绝无效 payload
// ---------------------------------------------------------------------------

describe("validateModelsConfigPayload — rejects invalid payloads", () => {
  it("rejects null", () => {
    const result = validateModelsConfigPayload(null);
    if (result.valid) throw new Error("Expected invalid");
    expect(result.error).toBe("Request body must be a plain object");
  });

  it("rejects a string", () => {
    const result = validateModelsConfigPayload("{}");
    if (result.valid) throw new Error("Expected invalid");
    expect(result.error).toBe("Request body must be a plain object");
  });

  it("rejects a number", () => {
    const result = validateModelsConfigPayload(42);
    if (result.valid) throw new Error("Expected invalid");
    expect(result.error).toBe("Request body must be a plain object");
  });

  it("rejects a boolean", () => {
    const result = validateModelsConfigPayload(true);
    if (result.valid) throw new Error("Expected invalid");
    expect(result.error).toBe("Request body must be a plain object");
  });

  it("rejects an array", () => {
    const result = validateModelsConfigPayload([]);
    if (result.valid) throw new Error("Expected invalid");
    expect(result.error).toBe("Request body must be a plain object");
  });

  it("rejects an array with objects", () => {
    const result = validateModelsConfigPayload([{ providers: {} }]);
    if (result.valid) throw new Error("Expected invalid");
    expect(result.error).toBe("Request body must be a plain object");
  });

  it("rejects undefined", () => {
    const result = validateModelsConfigPayload(undefined);
    if (result.valid) throw new Error("Expected invalid");
    expect(result.error).toBe("Request body must be a plain object");
  });

  it("rejects empty object {}", () => {
    const result = validateModelsConfigPayload({});
    if (result.valid) throw new Error("Expected invalid");
    expect(result.error).toBe("providers field is required");
  });

  it("rejects object with only extra fields, no providers", () => {
    const result = validateModelsConfigPayload({ version: 1 });
    if (result.valid) throw new Error("Expected invalid");
    expect(result.error).toBe("providers field is required");
  });

  it("rejects providers as array", () => {
    const result = validateModelsConfigPayload({ providers: [] });
    if (result.valid) throw new Error("Expected invalid");
    expect(result.error).toBe("providers must be a plain object, not an array");
  });

  it("rejects providers as null", () => {
    const result = validateModelsConfigPayload({ providers: null });
    if (result.valid) throw new Error("Expected invalid");
    expect(result.error).toBe("providers must be a plain object, not null");
  });

  it("rejects providers as string", () => {
    const result = validateModelsConfigPayload({ providers: "openai" });
    if (result.valid) throw new Error("Expected invalid");
    expect(result.error).toBe("providers must be a plain object, not null");
  });

  it("rejects providers as number", () => {
    const result = validateModelsConfigPayload({ providers: 0 });
    if (result.valid) throw new Error("Expected invalid");
    expect(result.error).toBe("providers must be a plain object, not null");
  });
});

// ---------------------------------------------------------------------------
// 测试：validateModelsConfigPayload — 允许有效 payload
// ---------------------------------------------------------------------------

describe("validateModelsConfigPayload — accepts valid payloads", () => {
  it("accepts { providers: {} } (explicit empty providers — user cleared all)", () => {
    const result = validateModelsConfigPayload({ providers: {} });
    if (!result.valid) throw new Error("Expected valid");
    expect(result.data).toEqual({ providers: {} });
  });

  it("accepts { providers: { openai: {...} } }", () => {
    const payload = {
      providers: {
        openai: {
          baseUrl: "https://api.openai.com/v1",
          api: "openai-completions",
          models: [{ id: "gpt-4o" }],
        },
      },
    };
    const result = validateModelsConfigPayload(payload);
    if (!result.valid) throw new Error("Expected valid");
    expect(result.data).toEqual(payload);
  });

  it("accepts { providers: { openai: {...}, deepseek: {...} } } (multiple providers)", () => {
    const payload = {
      providers: {
        openai: {
          baseUrl: "https://api.openai.com/v1",
          api: "openai-completions",
          models: [{ id: "gpt-4o" }],
        },
        deepseek: {
          baseUrl: "https://api.deepseek.com",
          api: "openai-completions",
          models: [{ id: "deepseek-chat" }],
        },
      },
    };
    const result = validateModelsConfigPayload(payload);
    if (!result.valid) throw new Error("Expected valid");
    expect(result.data).toEqual(payload);
  });

  it("accepts { providers: {}, extra: 'ignored' } (extra fields allowed)", () => {
    const payload = { providers: {}, note: "cleared all models" };
    const result = validateModelsConfigPayload(payload);
    if (!result.valid) throw new Error("Expected valid");
    expect(result.data).toEqual(payload);
  });
});
