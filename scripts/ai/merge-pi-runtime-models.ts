/**
 * 一次性迁移：合并 ~/.pi-runtime/models.json → Pi SDK agentDir/models.json
 *
 * 背景（qwen3.8-max 401 事故）：
 * 历史上 models-config-store 默认写 ~/.pi-runtime/models.json，而 ai-workspace
 * 对话会话（Pi SDK createAgentSessionServices）读 SDK agentDir（~/.pi/agent）
 * 下的 models.json —— 两份文件各自演化，key 漂移导致对话 401、测试却通过。
 *
 * 修复后 models-config-store 已对齐 SDK agentDir（单一 SoT）。本脚本把
 * ~/.pi-runtime/models.json 的内容按 provider 级合并进 agentDir/models.json：
 * - 同名 provider：~/.pi-runtime 版本胜出（它是配置对话框最近写入的）
 * - 仅 agentDir 存在的 provider：保留
 * - 合并前对目标文件做 .bak.<timestamp> 备份
 *
 * 用法：npx tsx scripts/ai/merge-pi-runtime-models.ts [--dry-run]
 */

import { existsSync, readFileSync, writeFileSync, copyFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const dryRun = process.argv.includes("--dry-run");

function readJson(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch (error) {
    console.warn(`[merge] 跳过无法解析的文件 ${path}:`, error instanceof Error ? error.message : String(error));
    return null;
  }
}

function providersOf(config: Record<string, unknown> | null): Record<string, unknown> {
  const providers = config?.providers;
  return providers && typeof providers === "object" && !Array.isArray(providers)
    ? (providers as Record<string, unknown>)
    : {};
}

async function main() {
  const legacyPath = join(homedir(), ".pi-runtime", "models.json");

  // 目标：与修复后的 models-config-store 一致（动态取 SDK agentDir）
  const { getModelsConfigPath } = await import("../../lib/models-config-store");
  const targetPath = await getModelsConfigPath();

  console.log(`[merge] legacy : ${legacyPath} (exists=${existsSync(legacyPath)})`);
  console.log(`[merge] target : ${targetPath} (exists=${existsSync(targetPath)})`);

  if (legacyPath === targetPath) {
    console.log("[merge] 两路径相同，无需迁移");
    return;
  }

  const legacy = readJson(legacyPath);
  const target = readJson(targetPath);

  const legacyProviders = providersOf(legacy);
  const targetProviders = providersOf(target);

  if (Object.keys(legacyProviders).length === 0) {
    console.log("[merge] legacy 无 provider 内容，无需迁移");
    return;
  }

  const mergedProviders: Record<string, unknown> = { ...targetProviders };
  const overwritten: string[] = [];
  const added: string[] = [];
  for (const [name, provider] of Object.entries(legacyProviders)) {
    if (name in mergedProviders) overwritten.push(name);
    else added.push(name);
    // legacy（配置对话框最近写入）胜出
    mergedProviders[name] = provider;
  }

  const merged: Record<string, unknown> = { ...(target ?? {}), providers: mergedProviders };

  console.log(`[merge] 覆盖 provider: ${overwritten.join(", ") || "(无)"}`);
  console.log(`[merge] 新增 provider: ${added.join(", ") || "(无)"}`);

  if (dryRun) {
    console.log("[merge] --dry-run：不写文件");
    console.log(JSON.stringify(merged, null, 2).slice(0, 800) + "\n... (truncated)");
    return;
  }

  // 备份目标文件
  if (existsSync(targetPath)) {
    const backupPath = `${targetPath}.bak.${Date.now()}`;
    copyFileSync(targetPath, backupPath);
    console.log(`[merge] 已备份目标文件 → ${backupPath}`);
  }

  writeFileSync(targetPath, JSON.stringify(merged, null, 2), "utf8");
  console.log(`[merge] ✅ 合并完成：${Object.keys(mergedProviders).length} 个 provider → ${targetPath}`);
}

main().catch((error) => {
  console.error("[merge] 失败:", error);
  process.exit(1);
});
