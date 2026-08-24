import { NextResponse } from "next/server";
import { readModelsConfig, writeModelsConfig } from "@/lib/models-config-store";
import { invalidateModelsCache } from "@/lib/models-cache";
import { resetModelRuntime } from "@/lib/model-discovery";
import { requireSession } from "@/shared/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await readModelsConfig());
}

/**
 * Validates the models-config PUT body.
 *
 * Allowed (200 → passes through to writeModelsConfig):
 *   - { providers: {} }          ← explicit empty providers (user deleted all)
 *   - { providers: { openai: {...}, ... } }
 *
 * Rejected (400):
 *   - non-object (null / string / number / array / boolean / undefined)
 *   - plain object without `providers` field
 *   - `providers` is an array
 *
 * Refusing these prevents accidental writes that could overwrite existing
 * model configurations with an empty or meaningless payload.
 */
function validateModelsConfigPayload(
  body: unknown,
): { valid: true; data: Record<string, unknown> } | { valid: false; error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { valid: false, error: "Request body must be a plain object" };
  }

  const record = body as Record<string, unknown>;

  // `providers` field must be present and be an object (not an array)
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

export async function PUT(req: Request) {
  // 写入 model.json 会影响全 workspace 的模型路由（Pi ModelRuntime + Unified Registry），
  // 必须要求登录用户，防止未授权覆盖。
  const session = await requireSession().catch(() => null);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();

    const validation = validateModelsConfigPayload(body);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    await writeModelsConfig(validation.data);
    // 配置更新后立即失效模型缓存 + 重置 ModelRuntime 单例
    // （否则 getModelRuntime 返回旧实例，/api/models 模型列表不更新）
    invalidateModelsCache();
    resetModelRuntime();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
