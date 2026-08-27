import { NextRequest, NextResponse } from "next/server";
import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { stat } from "fs/promises";
import { resolve } from "path";
import {
  loadModelsWithCache,
  withSafeModelLoadFailure,
  type ModelsData,
} from "@/lib/models-cache";
import { getModelRuntime } from "@/lib/model-discovery";
import {
  getAllowedFileRoots,
  isExistingFilePathAllowed,
} from "@/lib/file-access";
import { requireSession } from "@/shared/lib/permissions";
import {
  getUnifiedModels,
  type UnifiedProviderEntry,
} from "@/lib/unified-model-registry";
import { loadUnifiedModelsWithCache } from "@/lib/unified-models-cache";

export const dynamic = "force-dynamic";

const modelNameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

function compareModelEntries(
  a: { id: string; name: string; provider: string },
  b: { id: string; name: string; provider: string },
): number {
  return (
    modelNameCollator.compare(a.name || a.id, b.name || b.id) ||
    modelNameCollator.compare(a.provider, b.provider) ||
    modelNameCollator.compare(a.id, b.id)
  );
}

async function loadModels(cwd: string, userId?: string): Promise<ModelsData> {
  const runtime = await getModelRuntime(cwd);

  // 模型列表以统一 registry 为准 —— 与设置弹窗 /api/ai/models/registry 同源（同一 5min 缓存），
  // 只列出已配置的 provider/model（models.json 本地配置 + Site DB），
  // 不再直接铺开 pi 内置目录（如 openrouter 的内置 346 个模型），保持两个视图作用域一致。
  // runtime 仅用于模型元数据（thinking 等级），并在 registry 为空时兜底。
  const runtimeModels = await runtime.getAvailable();
  const runtimeByName = new Map(
    runtimeModels.map((m) => [`${m.provider}:${m.id}`, m] as const),
  );

  const nameMap = new Map<string, string>();
  const modelList: { id: string; name: string; provider: string }[] = [];
  const thinkingLevels: Record<string, string[]> = {};
  const thinkingLevelMaps: Record<string, Record<string, string | null>> = {};

  const addModel = (
    provider: string,
    modelId: string,
    displayName: string,
  ): void => {
    const key = `${provider}:${modelId}`;
    if (nameMap.has(key)) return;
    nameMap.set(key, displayName);
    modelList.push({ id: modelId, name: displayName, provider });
    const runtimeModel = runtimeByName.get(key as `${string}:${string}`);
    if (runtimeModel) {
      // 用 Pi SDK 计算模型可用思考等级（对齐 pi-web-ref 参考实现；
      // 不要读 m.thinking_levels —— Pi 模型对象没有该字段，恒为 [] 会导致思考菜单只剩 auto）
      thinkingLevels[key] = getSupportedThinkingLevels(runtimeModel);
      if (runtimeModel.thinkingLevelMap) {
        thinkingLevelMaps[key] = runtimeModel.thinkingLevelMap;
      }
    }
  };

  let unified: UnifiedProviderEntry[] = [];
  try {
    unified = await loadUnifiedModelsWithCache(userId ?? null, () =>
      getUnifiedModels(userId ?? null),
    );
  } catch (err) {
    console.warn(
      "[GET /api/models] failed to load unified models:",
      err instanceof Error ? err.message : String(err),
    );
  }
  for (const providerEntry of unified) {
    for (const model of providerEntry.models) {
      addModel(model.provider, model.modelName, model.displayName);
    }
  }

  // 兜底：未登录或统一 registry 为空时退回 runtime 全量列表，避免下拉无模型可选
  if (modelList.length === 0) {
    for (const m of runtimeModels) addModel(m.provider, m.id, m.name);
  }

  // Sort model list
  modelList.sort(compareModelEntries);

  // 与 pi-web 对齐：默认模型读 pi settings（用户在会话里切换模型时，
  // AgentSession.setModel 会持久化为新的默认），而不是简单取列表第一个。
  const settings = SettingsManager.create(cwd, await getAgentDir());
  const defaultProvider = settings.getDefaultProvider();
  const defaultModelId = settings.getDefaultModel();
  const savedDefault =
    defaultProvider && defaultModelId
      ? modelList.find(
          (m) => m.provider === defaultProvider && m.id === defaultModelId,
        )
      : undefined;
  const chosen = savedDefault ?? modelList[0];
  const defaultModel = chosen
    ? { provider: chosen.provider, modelId: chosen.id }
    : null;

  const runtimeAny = runtime as { getError?: () => string | undefined };
  const modelError = runtimeAny.getError?.() ?? undefined;

  const result: ModelsData = {
    models: Object.fromEntries(nameMap),
    modelList,
    defaultModel,
    thinkingLevels,
    thinkingLevelMaps,
    thinkingLevelPins: {},
  };

  if (modelError) {
    result.modelError = modelError;
  }

  return result;
}

const EMPTY_MODELS: ModelsData = {
  models: {},
  modelList: [],
  defaultModel: null,
  thinkingLevels: {},
  thinkingLevelMaps: {},
  thinkingLevelPins: {},
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const requestedCwd = searchParams.get("cwd") || process.cwd();
    const cwd = resolve(requestedCwd);

    // Validate directory exists
    let cwdStat;
    try {
      cwdStat = await stat(cwd);
    } catch {
      return NextResponse.json(
        { error: `Directory does not exist: ${cwd}` },
        { status: 400 },
      );
    }
    if (!cwdStat.isDirectory()) {
      return NextResponse.json(
        { error: `Not a directory: ${cwd}` },
        { status: 400 },
      );
    }

    // Check path is allowed
    const allowedRoots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Get userId if logged in (graceful degradation: unauthenticated → local models only)
    const session = await requireSession().catch(() => null);
    const userId = session?.user?.id;

    const modelsData = await loadModelsWithCache(cwd, () =>
      loadModels(cwd, userId),
    );
    return NextResponse.json(modelsData);
  } catch {
    return NextResponse.json(withSafeModelLoadFailure(EMPTY_MODELS));
  }
}
