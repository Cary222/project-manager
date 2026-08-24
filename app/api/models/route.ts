import { NextRequest, NextResponse } from "next/server";
import { stat } from "fs/promises";
import { resolve } from "path";
import {
  loadModelsWithCache,
  withSafeModelLoadFailure,
  type ModelsData,
} from "@/lib/models-cache";
import { resolveVisibleModels } from "@/lib/model-scope";
import { getModelRuntime } from "@/lib/model-discovery";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { requireSession } from "@/shared/lib/permissions";
import { getUnifiedModels } from "@/lib/unified-model-registry";
import { loadUnifiedModelsWithCache } from "@/lib/unified-models-cache";

export const dynamic = "force-dynamic";

const modelNameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compareModelEntries(
  a: { id: string; name: string; provider: string },
  b: { id: string; name: string; provider: string }
): number {
  return modelNameCollator.compare(a.name || a.id, b.name || b.id)
    || modelNameCollator.compare(a.provider, b.provider)
    || modelNameCollator.compare(a.id, b.id);
}

async function loadModels(cwd: string, userId?: string): Promise<ModelsData> {
  const runtime = await getModelRuntime(cwd);
  const scope = await resolveVisibleModels(runtime, undefined);
  const { visible, thinkingLevelPins, warnings } = scope;

  // Build local model list from Pi Runtime (models.json via enabledModels scope)
  const nameMap = new Map<string, string>();
  const modelList: { id: string; name: string; provider: string }[] = [];
  const thinkingLevels: Record<string, string[]> = {};
  const thinkingLevelMaps: Record<string, Record<string, string | null>> = {};

  // Build model list and name map from resolved visible models
  for (const m of visible) {
    const key = `${m.provider}:${m.id}`;
    nameMap.set(key, m.name);
    modelList.push({
      id: m.id,
      name: m.name,
      provider: m.provider,
    });
    // Get thinking levels from the model if available
    const modelAny = m as { thinking_levels?: string[]; thinkingLevelMap?: Record<string, string | null> };
    thinkingLevels[key] = modelAny.thinking_levels ?? [];
    if (modelAny.thinkingLevelMap) thinkingLevelMaps[key] = modelAny.thinkingLevelMap;
  }

  // Merge site DB models (from Unified Model Registry) into the list.
  // This ensures the workspace selector shows both Pi local models AND site DB models.
  // Site models are cached via unified-models-cache.ts (TTL 5min) to avoid repeated HTTP discovery.
  if (userId) {
    try {
      const unified = await loadUnifiedModelsWithCache(userId, () => getUnifiedModels(userId));
      for (const providerEntry of unified) {
        for (const model of providerEntry.models) {
          const key = `${model.provider}:${model.modelName}`;
          // Only add if not already present from Pi Runtime (local takes priority)
          if (!nameMap.has(key)) {
            nameMap.set(key, model.displayName);
            modelList.push({
              id: model.modelName,
              name: model.displayName,
              provider: model.provider,
            });
          }
        }
      }
    } catch (err) {
      console.warn("[GET /api/models] failed to merge site models:", err instanceof Error ? err.message : String(err));
    }
  }

  // Sort model list
  modelList.sort(compareModelEntries);

  // Default to first model if available
  const defaultModel = modelList.length > 0
    ? { provider: modelList[0].provider, modelId: modelList[0].id }
    : null;

  const runtimeAny = runtime as { getError?: () => string | undefined };
  const modelError = runtimeAny.getError?.() ?? undefined;

  const result: ModelsData = {
    models: Object.fromEntries(nameMap),
    modelList,
    defaultModel,
    thinkingLevels,
    thinkingLevelMaps,
    thinkingLevelPins,
  };

  if (warnings.length > 0) {
    result.modelScopeWarnings = warnings;
  }

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
      return NextResponse.json({ error: `Directory does not exist: ${cwd}` }, { status: 400 });
    }
    if (!cwdStat.isDirectory()) {
      return NextResponse.json({ error: `Not a directory: ${cwd}` }, { status: 400 });
    }

    // Check path is allowed
    const allowedRoots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Get userId if logged in (graceful degradation: unauthenticated → local models only)
    const session = await requireSession().catch(() => null);
    const userId = session?.user?.id;

    const modelsData = await loadModelsWithCache(cwd, () => loadModels(cwd, userId));
    return NextResponse.json(modelsData);
  } catch {
    return NextResponse.json(withSafeModelLoadFailure(EMPTY_MODELS));
  }
}
