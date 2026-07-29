/**
 * 人物画像每周清扫任务
 * 
 * 功能：
 * 1. 遍历所有有画像的用户
 * 2. 检查是否需要清扫（本周是否已清扫）
 * 3. 清扫操作：重新生成最新画像（使用 summarizer 的规则自动限制字段数量）
 * 4. 版本号递增
 * 
 * 字段限制规则：
 * - roles: 最多 3 个
 * - interests: 最多 5 个
 * - expertise: 最多 5 个
 * - recentTopics: 最多 5 个
 * 
 * 运行方式：
 * - 通过 cron-scheduler 自动触发（每周一凌晨执行）
 * - 或手动运行：npx tsx scripts/profile-cleanup.ts
 */

import { prisma } from "@/shared/db/client";
import { cleanupUserProfile } from "@/features/ai/llm/summarizer";

/**
 * 获取本周的周一（00:00:00）
 */
function getWeekStart(date: Date = new Date()): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sunday, 1 = Monday, ...
  const diff = day === 0 ? -6 : 1 - day; // 如果是周日则回到上周一
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * 检查是否需要清扫：本周是否已更新
 */
function needsCleanup(existingWeekStart: Date | null): boolean {
  if (!existingWeekStart) return true; // 没有记录，需要创建
  
  const currentWeekStart = getWeekStart();
  const existingWeek = getWeekStart(existingWeekStart);
  
  // 本周还未清扫
  return currentWeekStart.getTime() !== existingWeek.getTime();
}

export interface ProfileCleanupResult {
  userId: string;
  email: string;
  previousVersion: number;
  newVersion: number;
  status: "cleaned" | "skipped" | "error";
  error?: string;
}

/**
 * 执行画像清扫
 * @returns 清扫结果统计
 */
export async function runProfileCleanup(): Promise<{
  total: number;
  cleaned: number;
  skipped: number;
  errors: number;
  results: ProfileCleanupResult[];
}> {
  const now = new Date();
  const currentWeekStart = getWeekStart(now);
  
  console.log(`[profile-cleanup] Starting cleanup at ${now.toISOString()}`);
  console.log(`[profile-cleanup] Current week start: ${currentWeekStart.toISOString()}`);

  // 获取所有有画像的用户
  const profiles = await prisma.aiUserProfile.findMany({
    select: {
      userId: true,
      version: true,
      weekStart: true,
      user: {
        select: {
          id: true,
          email: true,
        },
      },
    },
  });

  console.log(`[profile-cleanup] Found ${profiles.length} user profiles`);

  const results: ProfileCleanupResult[] = [];
  let cleaned = 0;
  let skipped = 0;
  let errors = 0;

  for (const profile of profiles) {
    const result: ProfileCleanupResult = {
      userId: profile.userId,
      email: profile.user.email,
      previousVersion: profile.version,
      newVersion: profile.version,
      status: "skipped",
    };

    try {
      // 检查是否需要清扫
      if (!needsCleanup(profile.weekStart)) {
        console.log(`[profile-cleanup] Skipping ${profile.user.email} - already cleaned this week`);
        result.status = "skipped";
        skipped++;
      } else {
        // 执行清扫：限制字段数量，去除冗余
        console.log(`[profile-cleanup] Cleaning profile for ${profile.user.email}`);
        const newProfile = await cleanupUserProfile(profile.userId);
        
        if (newProfile) {
          // 获取更新后的版本号
          const updated = await prisma.aiUserProfile.findUnique({
            where: { userId: profile.userId },
            select: { version: true },
          });
          result.newVersion = updated?.version ?? profile.version + 1;
          result.status = "cleaned";
          cleaned++;
          console.log(`[profile-cleanup] Cleaned ${profile.user.email}: v${result.previousVersion} -> v${result.newVersion}`);
        } else {
          result.status = "error";
          result.error = "Failed to generate new profile";
          errors++;
        }
      }
    } catch (error) {
      result.status = "error";
      result.error = error instanceof Error ? error.message : String(error);
      errors++;
      console.error(`[profile-cleanup] Error cleaning ${profile.user.email}:`, error);
    }

    results.push(result);
  }

  const summary = { total: profiles.length, cleaned, skipped, errors, results };
  console.log(`[profile-cleanup] Done: ${cleaned} cleaned, ${skipped} skipped, ${errors} errors`);

  return summary;
}

// CLI 入口
if (require.main === module) {
  runProfileCleanup()
    .then((result) => {
      console.log("\n=== Profile Cleanup Summary ===");
      console.log(`Total profiles: ${result.total}`);
      console.log(`Cleaned: ${result.cleaned}`);
      console.log(`Skipped: ${result.skipped}`);
      console.log(`Errors: ${result.errors}`);
      process.exit(result.errors > 0 ? 1 : 0);
    })
    .catch((error) => {
      console.error("[profile-cleanup] Fatal error:", error);
      process.exit(1);
    });
}
