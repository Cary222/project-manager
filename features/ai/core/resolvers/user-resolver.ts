/**
 * User resolver for search-structured queries.
 * Resolves user identifiers (name/email prefix/id) to user records.
 */

import { prisma } from "@/shared/db/client";
import { chineseToPinyin } from "@/features/profile/lib/user-search";
import { pinyin as pinyinArray } from "pinyin-pro";
import type { ExtractedUser, MatchType, ResolveResult } from "@/features/ai/types/structured";

/**
 * Resolves a user identifier (name/email prefix/id) to a user record.
 * Returns resolved user, confidence score, match type, and optional candidates for disambiguation.
 */
export async function resolveUser(
  identifier: ExtractedUser | undefined,
  viewerUserId: string | undefined
): Promise<ResolveResult> {
  if (!identifier) return { user: null, confidence: 0, matchType: null };

  // === 自我引用处理：用户输入 "我"，直接返回当前登录用户 ===
  if (identifier.isSelf && viewerUserId) {
    const viewerUser = await prisma.user.findUnique({
      where: { id: viewerUserId },
      select: { id: true, name: true },
    });
    if (viewerUser) {
      return { user: { id: viewerUser.id, name: viewerUser.name ?? viewerUser.id }, confidence: 1.0, matchType: "self" };
    }
  }

  const { raw, normalized } = identifier;
  const rawTrimmed = raw.trim();
  const normTrimmed = normalized.trim();

  if (!normTrimmed) return { user: null, confidence: 0, matchType: null };

  // === 构建搜索词序列 ===
  // 原则：拆 token + 原始整体 + 变体都要搜
  const allTerms: string[] = [];

  // 1. 原始整体（小写）
  allTerms.push(normTrimmed.toLowerCase());

  // 2. 所有空格分隔的 token（小写）— "jing zhang" → "jing", "zhang"
  const tokens = normTrimmed.split(/\s+/).filter((t) => t.length >= 1);
  for (const t of tokens) {
    allTerms.push(t.toLowerCase());
  }

  // 3. 如果是纯中文，生成正序拼音 + 反序拼音（如 "张靖" → "zhangjing" + "gnijgnahz"）
  if (/^[\u4e00-\u9fa5]+$/.test(normTrimmed)) {
    const pinyin = chineseToPinyin(normTrimmed);
    if (pinyin) {
      allTerms.push(pinyin);
      allTerms.push(pinyin.split("").reverse().join(""));
    }
    // 拆字全拼 + 拆字全拼反序（如 "zhang jing" + "jing zhang"）
    const charPinyins = pinyinArray(normTrimmed, {
      toneType: "none",
      type: "array",
      nonZh: "removed",
      surname: "head",
    }) as string[];
    if (charPinyins.length > 0) {
      allTerms.push(charPinyins.join(" "));
      allTerms.push([...charPinyins].reverse().join(" "));
    }
    // 拆单字中文（如 "刘工" → "刘", "工"）— 让 Step 5 弱匹配能命中 name 含单字的用户。
    // 例：输入 "刘工" 时，name contains "刘" 命中所有姓刘的候选，触发 disambiguate。
    for (const ch of normTrimmed) {
      if (/[\u4e00-\u9fa5]/.test(ch)) {
        allTerms.push(ch);
      }
    }
    // 单字拼音（如 "刘工" → "liu", "gong"）— 让 searchName 里的 "liu"/"gong" 也能命中。
    for (const py of charPinyins) {
      if (py) allTerms.push(py.toLowerCase());
    }
  }

  // 4. 如果输入含空格，去空格后拼接（小写）— "jing zhang" → "jingzhang"
  if (/[a-zA-Z]/.test(normTrimmed) && /\s/.test(normTrimmed)) {
    allTerms.push(normTrimmed.replace(/\s+/g, "").toLowerCase());
  }

  // 去重（保留顺序）
  const uniqueTerms = [...new Set(allTerms)];

  // === 强匹配（直接返回）===
  // Step 1: Exact id match
  const byId = await prisma.user.findUnique({
    where: { id: rawTrimmed },
    select: { id: true, name: true },
  });
  if (byId) return { user: { id: byId.id, name: byId.name ?? byId.id }, confidence: 1.0, matchType: "id" };

  // Step 2: Exact name match (原始整体)
  const byName = await prisma.user.findFirst({
    where: { name: { equals: normTrimmed, mode: "insensitive" }, bannedAt: null },
    select: { id: true, name: true },
  });
  if (byName) return { user: { id: byName.id, name: byName.name ?? byName.id }, confidence: 1.0, matchType: "name" };

  // Step 3: searchName contains any allTerms - confidence 0.95
  // 将 allTerms 的每个拼音变体拿去查 searchName（allTerms 已含"jing"/"zhang"/"jingguo"等，
  // 配合存储的"jing zhang jingzhang"等值，实现中文昵称→拼音名的跨语言匹配）
  //
  // 收集所有搜索词命中的所有用户，合并后统一决策：
  // - 唯一匹配 → confidence 0.95 返回
  // - 多于一个匹配 → 交给 Step 5 disambiguate（避免 Step 3 用 findFirst 吞掉多候选场景）
  const allCandidates = new Map<string, { id: string; name: string | null; email: string; matchScore: number }>();
  const searchNameCandidates = new Map<string, { id: string; name: string | null }>();
  if (normTrimmed.length >= 1) {
    for (const term of uniqueTerms) {
      if (term.length < 1) continue;
      if (/^[\u4e00-\u9fa5]$/.test(term)) continue; // 跳过纯单字中文 term（区分度过低）
      const matches = await prisma.user.findMany({
        where: { searchName: { contains: term, mode: "insensitive" }, bannedAt: null },
        select: { id: true, name: true },
      });
      for (const m of matches) {
        if (!searchNameCandidates.has(m.id)) {
          searchNameCandidates.set(m.id, { id: m.id, name: m.name });
        }
      }
    }
    if (searchNameCandidates.size === 1) {
      const [only] = Array.from(searchNameCandidates.values());
      return { user: { id: only.id, name: only.name ?? only.id }, confidence: 0.95, matchType: "searchName" };
    }
    // size > 1 → 交给 Step 5 统一 disambiguate
    if (searchNameCandidates.size > 1) {
      for (const [id, info] of searchNameCandidates) {
        if (!allCandidates.has(id)) {
          allCandidates.set(id, { id, name: info.name ?? id, email: "", matchScore: 2 });
        } else {
          const existing = allCandidates.get(id)!;
          existing.matchScore += 2;
        }
      }
    }
  }

  // Step 4: UserAlias exact match - confidence 1.0 (requires schema migration)
  // const byAliasRaw = await prisma.userAlias.findFirst({
  //   where: { alias: { equals: rawTrimmed, mode: "insensitive" } },
  //   include: { user: { select: { id: true, name: true } } },
  // });
  // if (byAliasRaw) {
  //   return { user: { id: byAliasRaw.user.id, name: byAliasRaw.user.name ?? byAliasRaw.user.id }, confidence: 1.0, matchType: "alias" };
  // }

  // Step 5: UserAlias contains - confidence 0.9 (requires schema migration)
  // if (normTrimmed.length >= 2) {
  //   const byAliasNorm = await prisma.userAlias.findFirst({
  //     where: { alias: { contains: normTrimmed, mode: "insensitive" } },
  //     include: { user: { select: { id: true, name: true } } },
  //   });
  //   if (byAliasNorm) {
  //     return { user: { id: byAliasNorm.user.id, name: byAliasNorm.user.name ?? byAliasNorm.user.id }, confidence: 0.9, matchType: "alias" };
  //   }
  // }

  // === 弱匹配（用所有搜索词查原始 name 字段，返回 candidates）===
  for (const term of allTerms) {
    if (term.length < 1) continue;
    const matches = await prisma.user.findMany({
      where: { name: { contains: term, mode: "insensitive" }, bannedAt: null },
      select: { id: true, name: true, email: true },
    });
    for (const m of matches) {
      const existing = allCandidates.get(m.id);
      const score = existing ? existing.matchScore + 1 : 1;
      allCandidates.set(m.id, { ...m, matchScore: score });
    }
  }

  const candidates = Array.from(allCandidates.values());

  if (candidates.length === 1) {
    return { user: { id: candidates[0].id, name: candidates[0].name ?? candidates[0].id }, confidence: 0.7, matchType: "name" };
  }
  if (candidates.length > 1) {
    // 按匹配分数排序，分数高的排前面
    candidates.sort((a, b) => b.matchScore - a.matchScore);
    return { user: null, confidence: 0.5, matchType: "name", candidates };
  }

  // Step 7: email prefix → candidates
  const byEmailPrefix = await prisma.user.findMany({
    where: { email: { startsWith: normTrimmed, mode: "insensitive" }, bannedAt: null },
    select: { id: true, name: true, email: true },
  });
  if (byEmailPrefix.length > 0) {
    const first = byEmailPrefix[0];
    return {
      user: byEmailPrefix.length === 1 ? { id: first.id, name: first.name ?? first.id } : null,
      confidence: byEmailPrefix.length === 1 ? 0.85 : 0.6,
      matchType: "name",
      candidates: byEmailPrefix.length > 1 ? byEmailPrefix : undefined
    };
  }

  // Step 8: email contains → candidates
  if (normTrimmed.includes("@") || normTrimmed.includes(".")) {
    const byEmailContains = await prisma.user.findMany({
      where: { email: { contains: normTrimmed, mode: "insensitive" }, bannedAt: null },
      select: { id: true, name: true, email: true },
    });
    if (byEmailContains.length > 0) {
      const first = byEmailContains[0];
      return {
        user: byEmailContains.length === 1 ? { id: first.id, name: first.name ?? first.id } : null,
        confidence: byEmailContains.length === 1 ? 0.8 : 0.5,
        matchType: "name",
        candidates: byEmailContains.length > 1 ? byEmailContains : undefined
      };
    }
  }

  return { user: null, confidence: 0, matchType: null };
}
