import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/shared/lib/permissions";
import {
  saveApiKey,
  deleteApiKey,
  deleteApiKeyById,
  getMaskedKeyInfo,
  hasApiKey,
  getSystemProviders,
  saveSystemProvider,
  deleteSystemProvider,
  deleteSystemProviderById,
} from "@/features/ai/llm/credentials/api-key-store";

/**
 * GET: 返回用户已配置的 API Key 掩码信息
 * ROOT 管理员额外返回系统级 provider 配置
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireSession().catch(() => null);
    const userId = session?.user?.id;
    const isRoot = session?.user?.role === "ROOT";

    if (!userId && !isRoot) {
      return NextResponse.json({ data: { userKeys: [], systemKeys: [] } });
    }

    const userKeys = userId ? await getMaskedKeyInfo(userId) : [];
    const systemKeys = isRoot ? await getSystemProviders() : [];

    return NextResponse.json({
      data: {
        userKeys: userKeys.map((k) => ({
          id: k.id,
          provider: k.provider,
          name: k.name,
          baseURL: k.baseURL,
          keyLast4: k.keyLast4,
          lastUsedAt: k.lastUsedAt,
          createdAt: k.createdAt,
          ownerType: k.ownerType,
          transport: k.transport,
          apiFormat: k.apiFormat,
        })),
        systemKeys: systemKeys.map((k) => ({
          id: k.id,
          provider: k.provider,
          name: k.name,
          baseURL: k.baseURL,
          keyLast4: k.keyLast4,
          lastUsedAt: k.lastUsedAt,
          createdAt: k.createdAt,
          ownerType: k.ownerType,
          transport: k.transport,
          apiFormat: k.apiFormat,
        })),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "UNAUTHORIZED") {
      return NextResponse.json({ data: null, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { data: null, error: "Failed to fetch provider info" },
      { status: 500 }
    );
  }
}

// POST: 保存用户 API Key 或 SYSTEM API Key（ROOT）
const SaveKeySchema = z.object({
  provider: z.string().min(1, "Provider is required"),
  name: z.string().min(1, "Name is required"),
  apiKey: z.string().min(1, "API Key is required"),
  baseURL: z.string().url("Invalid baseURL").optional().or(z.literal("").transform(() => undefined)),
  transport: z.enum(["proxy", "direct"]).optional(),
  apiFormat: z.enum(["openai-chat", "openai-responses", "anthropic"]).optional(),
  ownerType: z.enum(["USER", "SYSTEM"]).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const session = await requireSession();
    const userId = session.user.id;
    const isRoot = session.user.role === "ROOT";

    const body = await request.json();
    const parsed = SaveKeySchema.parse(body);
    const { provider, name, apiKey, baseURL, transport, apiFormat, ownerType } = parsed;

    // SYSTEM 保存只允许 ROOT
    if (ownerType === "SYSTEM" && !isRoot) {
      return NextResponse.json(
        { data: null, error: "Only ROOT administrators can manage system providers" },
        { status: 403 }
      );
    }

    let maskedInfo;
    if (ownerType === "SYSTEM") {
      maskedInfo = await saveSystemProvider({ provider, name, apiKey, baseURL, transport, apiFormat });
    } else {
      maskedInfo = await saveApiKey({
        userId,
        provider,
        name,
        apiKey,
        baseURL,
        transport,
        apiFormat,
      });
    }

    return NextResponse.json(
      {
        data: maskedInfo,
        message: "API Key saved successfully",
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[POST /api/ai/providers] error:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { data: null, error: "Invalid input", details: error.issues },
        { status: 400 }
      );
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "UNAUTHORIZED") {
      return NextResponse.json({ data: null, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { data: null, error: `Failed to save API Key: ${message}` },
      { status: 500 }
    );
  }
}

// PUT: 测试 API Key（调用 /v1/models 接口验证连接）
const TestKeySchema = z.object({
  provider: z.string().min(1),
  apiKey: z.string().min(1).optional(),
  baseURL: z.string().optional(),
});

export async function PUT(request: NextRequest) {
  try {
    await requireSession();

    const body = await request.json();
    const { provider, apiKey, baseURL } = TestKeySchema.parse(body);

    // 已知 provider 默认 baseURL
    const KNOWN_BASEURL: Record<string, string> = {
      deepseek: "https://api.deepseek.com",
      openai: "https://api.openai.com/v1",
      anthropic: "https://api.anthropic.com",
      groq: "https://api.groq.com/openai/v1",
      openrouter: "https://openrouter.ai/api/v1",
      together: "https://api.together.xyz/v1",
    };

    const keyToTest = apiKey ?? process.env.AGNES_API_KEY;
    if (!keyToTest) {
      return NextResponse.json(
        { data: null, error: "No API key provided to test" },
        { status: 400 }
      );
    }

    // 确定 baseURL：优先用户输入，其次已知默认值
    const testBaseURL = baseURL?.trim() || KNOWN_BASEURL[provider] || `https://api.${provider}.com/v1`;

    // 调用 /v1/models 验证
    let testPassed = false;
    let errorMessage = "";
    const normalizedURL = testBaseURL.replace(/\/$/, "");

    try {
      const response = await fetch(`${normalizedURL}/v1/models`, {
        headers: {
          Authorization: `Bearer ${keyToTest}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok) {
        testPassed = true;
      } else {
        const errorData = await response.json().catch(() => ({}));
        errorMessage =
          errorData?.error?.message ??
          `HTTP ${response.status}: ${response.statusText}`;
      }
    } catch (fetchError) {
      errorMessage =
        fetchError instanceof Error ? fetchError.message : "Connection failed";
    }

    return NextResponse.json({
      data: {
        success: testPassed,
        message: testPassed ? "Connection successful" : `Connection failed: ${errorMessage}`,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { data: null, error: "Invalid input", details: error.issues },
        { status: 400 }
      );
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "UNAUTHORIZED") {
      return NextResponse.json({ data: null, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { data: null, error: "Failed to test API Key" },
      { status: 500 }
    );
  }
}

// DELETE: 软删除用户 API Key 或 SYSTEM provider（ROOT）
const DeleteKeySchema = z.object({
  id: z.string().min(1).optional(),
  provider: z.string().min(1).optional(),
  ownerType: z.enum(["USER", "SYSTEM"]).optional(),
});

// 按 id 删除（精确单条）或按 provider 删除（删除该 provider 下所有匹配的 key）
export async function DELETE(request: NextRequest) {
  try {
    const session = await requireSession();
    const userId = session.user.id;
    const isRoot = session.user.role === "ROOT";

    const body = await request.json().catch(() => ({}));
    const parsed = DeleteKeySchema.parse(body);
    const { id, provider, ownerType } = parsed;

    if (!id && !provider) {
      return NextResponse.json(
        { data: null, error: "Either id or provider is required" },
        { status: 400 }
      );
    }

    if (ownerType === "SYSTEM") {
      if (!isRoot) {
        return NextResponse.json(
          { data: null, error: "Only ROOT administrators can manage system providers" },
          { status: 403 }
        );
      }
      if (id) {
        await deleteSystemProviderById(id);
      } else if (provider) {
        await deleteSystemProvider(provider);
      }
    } else {
      if (id) {
        await deleteApiKeyById(id, userId);
      } else if (provider) {
        await deleteApiKey(userId, provider);
      }
    }

    return NextResponse.json({
      data: { success: true },
      message: "API Key deleted successfully",
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { data: null, error: "Invalid input", details: error.issues },
        { status: 400 }
      );
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "UNAUTHORIZED") {
      return NextResponse.json({ data: null, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { data: null, error: "Failed to delete API Key" },
      { status: 500 }
    );
  }
}
