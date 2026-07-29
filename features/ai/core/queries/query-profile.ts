/**
 * User profile query for greeting and personalization.
 */

import { prisma } from "@/shared/db/client";
import { updateUserProfile } from "@/features/ai/llm/summarizer";
import type { StructuredResult } from "@/features/ai/types/structured";

export interface ProfileQueryInput {
  userId: string;
  /** 强制刷新画像（忽略缓存，触发 LLM 重新构建） */
  forceRefresh?: boolean;
  /** 异步触发构建但不等待结果（用于新用户/无画像时） */
  asyncBuild?: boolean;
}

interface UserProfileRecord {
  profile: {
    roles?: string[];
    interests?: string[];
    expertise?: string[];
    recentTopics?: string[];
    preferences?: Record<string, unknown>;
  } | null;
  updatedAt: Date;
  sourceSummaryCount: number;
}

/**
 * 格式化画像为可读文本（与 greeting/route.ts 保持一致）
 */
export function formatProfileForGreeting(profile: UserProfileRecord["profile"]): string {
  const sections: string[] = [];

  if (profile?.roles?.length) {
    sections.push(`角色：${profile.roles.join("、")}`);
  }
  if (profile?.expertise?.length) {
    sections.push(`专长：${profile.expertise.join("、")}`);
  }
  if (profile?.interests?.length) {
    sections.push(`兴趣：${profile.interests.join("、")}`);
  }
  if (profile?.recentTopics?.length) {
    sections.push(`近期话题：${profile.recentTopics.join("、")}`);
  }

  return sections.length > 0 ? sections.join("\n") : "（暂无画像数据）";
}

/**
 * Query user profile for greeting personalization.
 *
 * 流程：
 * 1. 查 DB 缓存画像 → 直接返回（快路径）
 * 2. 无画像且 !asyncBuild → 返回空结构 + 触发异步构建
 * 3. 无画像且 asyncBuild=true → 只触发异步构建，返回空结构
 *
 * 画像构建是异步的，不会阻塞 greeting 响应。
 */
export async function queryProfile(
  input: ProfileQueryInput
): Promise<StructuredResult> {
  const { userId, forceRefresh = false, asyncBuild = false } = input;

  // 查询缓存画像
  const profileRecord = await prisma.aiUserProfile.findUnique({
    where: { userId },
  });

  // 有画像缓存
  if (profileRecord && !forceRefresh) {
    const profile = profileRecord.profile as UserProfileRecord["profile"];
    const profileText = formatProfileForGreeting(profile);

    return {
      summary: profileText,
      sources: [],
      // 附加画像元数据（attribution 用于前端展示）
      attribution: {
        kind: "user_profile",
        profile,
        sourceSummaryCount: profileRecord.sourceSummaryCount ?? 0,
        updatedAt: profileRecord.updatedAt.toISOString(),
      } as unknown as StructuredResult["attribution"],
    };
  }

  // 无画像或强制刷新：触发异步构建
  if (!asyncBuild) {
    // 同步触发（不等待结果），静默更新
    updateUserProfile(userId).catch((err) => {
      console.error("[queryProfile] async build failed:", err);
    });
  }

  // 返回空画像结构
  return {
    summary: "（暂无画像数据）",
    sources: [],
    attribution: {
      kind: "user_profile",
      profile: null,
      sourceSummaryCount: 0,
      updatedAt: new Date().toISOString(),
      pendingBuild: true,
    } as unknown as StructuredResult["attribution"],
  };
}

/**
 * 快速获取画像文本（用于直接嵌入 system prompt）
 * 内部调用 queryProfile，返回格式化后的文本。
 */
export async function getProfileTextForGreeting(
  userId: string
): Promise<string> {
  const result = await queryProfile({ userId });
  return result.summary;
}
