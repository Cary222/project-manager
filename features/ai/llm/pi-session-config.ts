/**
 * Pi Session Config — 会话级临时 models.json 合成器（Stage 8，评估方案 C）
 *
 * =============================================================================
 * 职责边界
 * =============================================================================
 * ✅ 负责：
 *   - 为 PiSubAgent 会话合成临时 models.json（mkdtemp，会话结束清理）
 *   - 合并规则：workspace models.json 优先；站点（USER+SYSTEM）已启用模型补充
 *   - 注入 UserAiModelPreference 的 thinkingLevel → reasoning + thinkingLevelMap
 *
 * ❌ 不负责：
 *   - 凭证注入（继续由 PiSdkRuntime.setRuntimeApiKey 完成，临时文件不落任何密钥）
 *   - 修改全局 models.json（严格只写临时目录，不建立双向同步）
 *
 * 先例：lib/model-discovery-auth.ts / lib/model-connection-test.ts 的
 * "临时 models.json + Pi ModelRuntime + 阅后即焚" 模式。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync, chmodSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { readModelsConfig } from "@/lib/models-config-store";
import { getUserProviderRecords, getSystemCredentials } from "./credentials/api-key-store";
import { getUserModelPreferences } from "./preferences/user-model-preferences";
import { loadUserModelsWithCache } from "@/lib/user-models-cache";
import { getEnabledModels } from "./providers/registry";
import { apiFormatToPiApi } from "./providers/user-providers";

export interface SessionModelsConfigHandle {
  /** 临时 models.json 路径（会话结束调用 cleanup 清理）。 */
  modelsPath: string;
  /** 清理临时目录（幂等）。 */
  cleanup: () => void;
}

interface SessionModelEntry {
  id: string;
  name?: string;
  reasoning?: boolean;
  thinkingLevelMap?: Record<string, string | null>;
  [key: string]: unknown;
}

interface SessionProviderEntry {
  baseUrl?: string;
  api?: string;
  models?: SessionModelEntry[];
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 合成 PiSubAgent 会话的临时 models.json。
 *
 * @param userId 用户 id（"system" 表示无用户上下文，仅用 SYSTEM 视图）
 * @throws 基础设施异常才抛错；数据为空时返回最小有效配置
 */
export async function synthesizeSessionModelsConfig(
  userId: string,
): Promise<SessionModelsConfigHandle> {
  // 1. workspace models.json 为基底（用户手动维护的 Pi Workspace 配置，优先）
  const workspace = await readModelsConfig();
  const base: Record<string, unknown> = isRecord(workspace)
    ? structuredClone(workspace)
    : {};
  const providers: Record<string, SessionProviderEntry> =
    isRecord(base.providers)
      ? (structuredClone(base.providers) as Record<string, SessionProviderEntry>)
      : {};

  // 2. 站点模型视图（/api/ai/models 同源缓存：SYSTEM + USER 已启用模型）
  let siteModelCount = 0;
  try {
    const effectiveUserId = userId === "system" ? undefined : userId;
    const models = await loadUserModelsWithCache(
      effectiveUserId ?? "anonymous",
      () => getEnabledModels(effectiveUserId),
    );

    const siteProviderIds = new Set<string>();
    if (effectiveUserId) {
      for (const record of await getUserProviderRecords(effectiveUserId)) {
        siteProviderIds.add(record.provider);
      }
    }
    for (const cred of await getSystemCredentials()) {
      siteProviderIds.add(cred.provider);
    }

    // workspace 基底已有的 provider（优先，不被站点视图覆盖）
    const workspaceProviderIds = new Set(Object.keys(providers));

    for (const model of models) {
      const providerId = model.provider ?? model.modelRef.split(":")[0];
      if (!providerId) continue;

      // workspace 已有该 provider → workspace 优先，不覆盖
      if (workspaceProviderIds.has(providerId)) continue;

      const entry: SessionProviderEntry = providers[providerId] ?? {};
      entry.models = entry.models ?? [];
      if (!entry.models.some((m) => m.id === model.modelName)) {
        entry.models.push({
          id: model.modelName,
          name: model.displayName !== model.modelName ? model.displayName : undefined,
        });
        siteModelCount += 1;
      }
      // 站点 provider 补 baseUrl / api（凭证不在文件里，运行时经 setRuntimeApiKey 注入）
      if (siteProviderIds.has(providerId)) {
        entry.api = entry.api ?? apiFormatToPiApi(model.apiFormat ?? "openai-chat");
      }
      providers[providerId] = entry;
    }
  } catch (error) {
    console.warn(
      "[pi-session-config] site model view unavailable, using workspace config only:",
      error instanceof Error ? error.message : String(error),
    );
  }

  // 3. 用户偏好注入：thinkingLevel → reasoning + thinkingLevelMap（字段级，仅补不改）
  let preferenceApplied = 0;
  try {
    if (userId !== "system") {
      const prefs = await getUserModelPreferences(userId);
      for (const pref of prefs) {
        if (!pref.thinkingLevel || pref.thinkingLevel === "off") continue;
        const provider = providers[pref.provider];
        const model = provider?.models?.find((m) => m.id === pref.modelId);
        if (!model) continue;
        model.reasoning = model.reasoning ?? true;
        model.thinkingLevelMap = {
          ...(model.thinkingLevelMap ?? {}),
          [pref.thinkingLevel]: pref.thinkingLevel,
        };
        preferenceApplied += 1;
      }
    }
  } catch (error) {
    console.warn(
      "[pi-session-config] preference injection skipped:",
      error instanceof Error ? error.message : String(error),
    );
  }

  // 4. 写临时目录（权限 0700，阅后即焚）
  const tempDir = mkdtempSync(join(tmpdir(), "projecthub-pi-session-"));
  chmodSync(tempDir, 0o700);
  const modelsPath = join(tempDir, "models.json");
  mkdirSync(tempDir, { recursive: true });
  writeFileSync(
    modelsPath,
    JSON.stringify({ ...base, providers }, null, 2),
    { encoding: "utf8", mode: 0o600 },
  );

  console.log(
    `[pi-session-config] synthesized session models.json for user=${userId}: ` +
    `${Object.keys(providers).length} providers, +${siteModelCount} site models, ` +
    `${preferenceApplied} preference injections`,
  );

  let cleaned = false;
  return {
    modelsPath,
    cleanup: () => {
      if (cleaned) return;
      cleaned = true;
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // 清理失败不影响业务（临时目录由系统回收）
      }
    },
  };
}
