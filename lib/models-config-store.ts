import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { invalidateModelsCache } from "./models-cache";
import { invalidateUnifiedModelsCache } from "./unified-models-cache";
import { resetModelRuntime } from "./model-discovery";
import { resolveModelContextWindow } from "./model-catalog";
import { homedir } from "node:os";

/**
 * 获取 Pi Runtime 目录。
 *
 * 优先级：
 * 1. PI_RUNTIME_DIR（显式覆盖，运维兼容）
 * 2. Pi SDK 的 getAgentDir()（默认 ~/.pi/agent，支持 PI_CODING_AGENT_DIR 覆盖）
 *
 * ⚠️ 必须与 SDK 的 agentDir 保持一致：ai-workspace 对话会话
 * （rpc-manager → createAgentSessionServices）读的是 SDK agentDir 下的
 * models.json；若两处路径分叉，会出现"配置对话框与对话用不同 key"的
 * 双源漂移问题（qwen3.8-max 401 事故根因）。
 *
 * ProjectHub 的 Source of Truth 仍是 UserApiKey 表；此文件仅为
 * Pi Workspace Runtime 配置。
 */
export async function getAgentDir(): Promise<string> {
  if (process.env.PI_RUNTIME_DIR) return process.env.PI_RUNTIME_DIR;
  // 动态导入避免 build 时 webidl 错误（与 lib/session-reader.ts 同模式）
  try {
    const { getAgentDir: piGetAgentDir } = await import("@earendil-works/pi-coding-agent");
    return piGetAgentDir();
  } catch {
    // SDK 不可用时回落默认路径（与 SDK 默认值一致）
    return join(homedir(), ".pi", "agent");
  }
}

const MODEL_COST_KEYS = ["input", "output", "cacheRead", "cacheWrite"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeModelCost(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const providedKeys = MODEL_COST_KEYS.filter((key) => value[key] !== undefined);
  if (providedKeys.length === 0) return undefined;
  if (providedKeys.some((key) => (
    typeof value[key] !== "number" || !Number.isFinite(value[key])
  ))) return undefined;

  return Object.fromEntries([
    ...Object.entries(value),
    ...MODEL_COST_KEYS.map((key) => [key, value[key] ?? 0]),
  ]);
}

/** Normalize models config: complete partial costs and auto-fill missing/default contextWindow */
export function normalizeModelsConfig(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const normalized = structuredClone(data);
  if (!isRecord(normalized.providers)) return normalized;

  for (const [providerId, provider] of Object.entries(normalized.providers)) {
    if (!isRecord(provider) || !Array.isArray(provider.models)) continue;
    for (const model of provider.models) {
      if (!isRecord(model) || typeof model.id !== "string" || !model.id.trim()) continue;

      // Auto-fill contextWindow if missing or default (128k) when catalog/heuristics report better
      const currentWindow = typeof model.contextWindow === "number" && Number.isFinite(model.contextWindow) && model.contextWindow > 0
        ? model.contextWindow
        : undefined;

      const resolvedWindow = resolveModelContextWindow({
        modelId: model.id,
        providerHint: providerId,
        declaredContextWindow: currentWindow,
      });

      if (resolvedWindow && (currentWindow === undefined || (currentWindow === 128_000 && resolvedWindow !== 128_000))) {
        model.contextWindow = resolvedWindow;
      }

      if ("cost" in model) {
        const cost = normalizeModelCost(model.cost);
        if (cost) model.cost = cost;
        else delete model.cost;
      }
    }
  }
  return normalized;
}

/** Alias for backward compatibility */
export const normalizeModelsConfigCosts = normalizeModelsConfig;

function sanitizeModelsConfig(data: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(data.providers)) return data;

  const providers = Object.fromEntries(Object.entries(data.providers).map(([providerId, provider]) => {
    if (!isRecord(provider) || !Array.isArray(provider.models)) return [providerId, provider];
    const models = provider.models.filter((model) => (
      !isRecord(model) || typeof model.id !== "string" || model.id.trim().length > 0
    ));
    return [providerId, { ...provider, models }];
  }));

  return { ...data, providers };
}

export async function getModelsConfigPath(): Promise<string> {
  const agentDir = await getAgentDir();
  return join(agentDir, "models.json");
}

export async function readModelsConfig(
  modelsPath?: string,
): Promise<Record<string, unknown>> {
  const path = modelsPath ?? await getModelsConfigPath();
  if (!existsSync(path)) return { providers: {} };
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    return normalizeModelsConfig(raw);
  } catch {
    return { providers: {} };
  }
}

export async function writeModelsConfig(
  data: Record<string, unknown>,
  modelsPath?: string,
): Promise<void> {
  const path = modelsPath ?? await getModelsConfigPath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const normalized = normalizeModelsConfigCosts(sanitizeModelsConfig(data));
  writePrivateFileAtomicSync(path, JSON.stringify(normalized, null, 2));
  // Invalidate the in-memory caches AND the Pi SDK singleton.
  // writeModelsConfig() is the ONLY write path to models.json — both
  // the Settings dialog (via /api/models-config PUT) and direct callers
  // go through here. Failing to reset the singleton leaves stale
  // ModelRuntime data even when the cache is already warm.
  //
  // invalidateUnifiedModelsCache() ensures /api/ai/models/registry reflects
  // the freshly-written models.json immediately (otherwise the 5-min unified
  // cache would keep serving the pre-save view, making it look like the
  // provider/key wasn't saved).
  invalidateModelsCache();
  invalidateUnifiedModelsCache();
  resetModelRuntime();
}
