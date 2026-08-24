/**
 * GET /api/ai/models/registry
 *
 * 返回统一合并后的 Provider/Model 视图（Site DB + Local model.json）。
 * 由 PiWorkspaceAdapter 通过此端点获取统一的 registry 视图，而不是自己 import
 * server-only 的 unified-model-registry.ts 或自己 fetch /api/ai/models。
 *
 * 合并规则：
 * 1. Site DB models（只读）：来自 UserApiKey + Discovery
 * 2. Local model.json：来自 ~/.pi/agent/models.json
 * 3. Local Provider 的连接元数据（baseURL / apiKey）覆盖 Site Provider
 * 4. 同名 model：local 覆盖 site 的显示/本地元数据
 * 5. Local modelRef 规范为 `${provider}:${modelId}`
 *
 * ⚠️ 无损往返保证（Settings 对话框 load→save）：
 * local providers 必须 **完整保留** models.json 里的所有字段（apiKey / headers /
 * compat / modelOverrides / model 级 thinkingLevelMap / cost / input 等）。
 * 因此这里用 buildFullModelsConfig() 做全量合并，而不是有损的 toProviderEntry()。
 *
 * 返回格式兼容 ModelSettingsAdapter.load() 期望的 ModelsJson 结构。
 *
 * =============================================================================
 * 缓存策略
 * =============================================================================
 * site models discovery 结果通过 unified-models-cache.ts 缓存（TTL 5min）。
 * 确保 /api/models 和 /api/ai/models/registry 共享同一缓存，避免重复 HTTP discovery。
 */

import { NextResponse } from "next/server";
import { requireSession } from "@/shared/lib/permissions";
import {
  buildFullModelsConfig,
  getLocalModels,
  getUnifiedModels,
} from "@/lib/unified-model-registry";
import { loadUnifiedModelsWithCache } from "@/lib/unified-models-cache";
import type { ModelsJson } from "@/features/ai/ui/model-settings/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession().catch(() => null);
    const userId = session?.user?.id ?? null;

    // site discovery（含合并视图）走 5min 缓存；local models.json 实时读取，保证最新
    const [unified, localConfig] = await Promise.all([
      loadUnifiedModelsWithCache(userId, () => getUnifiedModels(userId)),
      getLocalModels(),
    ]);

    const result: ModelsJson = buildFullModelsConfig(unified, localConfig);

    return NextResponse.json({ data: result });
  } catch (error) {
    console.error("[GET /api/ai/models/registry] error:", error);
    return NextResponse.json(
      { data: null, error: "Failed to fetch unified models" },
      { status: 500 }
    );
  }
}
