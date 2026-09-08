import type { QueryUnderstanding } from "./query-understanding";

/**
 * Common typo dictionary for domain terms, project names, and Chinese phonetic confusions.
 */
export const COMMON_TYPO_MAP: Record<string, string> = {
  // Project & device typos
  寻信望远镜: "寻星望远镜",
  寻星望远: "寻星望远镜",
  冷东相机: "冷冻相机",
  冷却相机: "冷冻相机",
  wifi相加: "wifi相机",
  wifi相继: "wifi相机",
  无线相加: "wifi相机",
  无线相机: "wifi相机",
  光污染仪: "光污染计",
  光污染器: "光污染计",
  光害计: "光污染计",
  光度计: "光污染计",
  经委仪: "经纬仪",
  经纬器: "经纬仪",
  滤镜切换: "滤镜切换器",
  目镜异常: "目镜切换异常",
  暴光: "曝光",
  增益控制: "增益",
  烧录包: "tools.zip",
  周报表: "周报",
};

/**
 * Domain-specific aliases and synonyms to bridge abbreviations and technical jargon.
 */
export const DOMAIN_ALIAS_MAP: Record<string, string[]> = {
  光污染: ["光污染计", "光污染设计需求文档", "SQM"],
  光污染计: ["光污染", "传感器校准", "SQM"],
  寻星望远镜: ["寻星", "经纬仪", "Unity主页面", "Telescope"],
  冷冻相机: ["冷冻", "制冷相机", "Cool-Camera", "目镜切换", "RV1103b"],
  wifi相机: ["无线相机", "wifi", "Skynex", "板端环境"],
  sc285sl: ["sc285", "摄像头驱动", "曝光控制", "增益控制"],
  ch585m: ["ch585", "585芯片", "蓝牙mcu", "芯片手册"],
  pkm: ["知识库", "笔记", "向量搜索", "文档检索"],
  "tools.zip": ["update.img", "烧录工具包", "一键烧录"],
};

/**
 * Normalizes colloquial and typo-prone words in the user query.
 */
export function normalizeTypos(query: string): string {
  const sortedKeys = Object.keys(COMMON_TYPO_MAP).sort(
    (a, b) => b.length - a.length,
  );
  const pattern = new RegExp(
    sortedKeys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
    "g",
  );
  return query.replace(
    pattern,
    (matched) => COMMON_TYPO_MAP[matched] ?? matched,
  );
}

/**
 * Retrieves known domain aliases and related technical identifiers for a given term.
 */
export function resolveAliases(term: string): string[] {
  const normalized = term.trim().toLowerCase();
  const aliases: string[] = [];

  for (const [key, list] of Object.entries(DOMAIN_ALIAS_MAP)) {
    if (
      key.toLowerCase() === normalized ||
      key.toLowerCase().includes(normalized) ||
      normalized.includes(key.toLowerCase())
    ) {
      aliases.push(...list);
    }
  }

  return [...new Set(aliases)];
}

/**
 * Generates 2 to 3 orthogonal sub-queries across distinct retrieval angles:
 * 1. Documentation & Architecture specification angle
 * 2. Ticket, task, and defect execution angle
 * 3. Git commit, firmware, and code change angle
 */
export function generateSubQueries(plan: QueryUnderstanding): string[] {
  const cleanSubject = normalizeTypos(plan.subject.trim());
  if (!cleanSubject) return [];

  const subQueries: string[] = [];
  const fineIntent = plan.fineGrainedIntent;

  // Case A: Person / Team activity queries
  if (fineIntent === "RECENT_ACTIVITY" || fineIntent === "TIMELINE") {
    const person = plan.entityHints.person || cleanSubject;
    subQueries.push(`${person} 代码提交 与 commit 记录`);
    subQueries.push(`${person} 负责工单 与 任务进展`);
    subQueries.push(`${person} 工作周报 与 总结`);
    return subQueries.slice(0, 3);
  }

  // Case B: Relation / Cross-entity exploration
  if (
    fineIntent === "RELATION" ||
    fineIntent === "COMPARE" ||
    plan.requestedTypes.length >= 2
  ) {
    const aliases = resolveAliases(cleanSubject).slice(0, 2);
    const aliasSupplement = aliases.length > 0 ? ` ${aliases[0]}` : "";

    // Angle 1: Documentation & Specifications
    subQueries.push(`${cleanSubject}${aliasSupplement} 设计需求 技术文档 架构`);

    // Angle 2: Work tickets & Tasks
    subQueries.push(`${cleanSubject} 关联工单 任务进度 缺陷排查`);

    // Angle 3: Code commits & Implementation
    subQueries.push(`${cleanSubject} 代码提交 commit 变更历史`);

    return subQueries.slice(0, 3);
  }

  // Case C: Summary & Overview
  if (fineIntent === "SUMMARY") {
    subQueries.push(`${cleanSubject} 项目总览 与 架构全貌`);
    subQueries.push(`${cleanSubject} 关键里程碑 与 核心工单`);
    return subQueries.slice(0, 2);
  }

  // Case D: Single lookup or doc search
  const aliases = resolveAliases(cleanSubject);
  subQueries.push(`${cleanSubject} 详细说明与文档`);
  if (aliases.length > 0) {
    subQueries.push(`${aliases[0]} 相关信息`);
  }
  if (plan.entityHints.ticketNo) {
    subQueries.push(`#${plan.entityHints.ticketNo} 详情与关联提交`);
  }

  return [...new Set(subQueries)].slice(0, 3);
}

export interface QueryRewriteResult {
  originalQuery: string;
  normalizedQuery: string;
  rewrittenSubject: string;
  aliases: string[];
  subQueries: string[];
}

/**
 * Comprehensive query rewrite integrating typo normalization, alias resolution,
 * subject distillation, and orthogonal multi-query generation.
 */
export function rewriteQuery(
  query: string,
  plan: QueryUnderstanding,
): QueryRewriteResult {
  const normalizedQuery = normalizeTypos(query);
  const aliases = resolveAliases(plan.subject);
  const subQueries = generateSubQueries(plan);

  // Distill subject with typo normalization
  const normalizedSubject = normalizeTypos(plan.subject);

  return {
    originalQuery: query,
    normalizedQuery,
    rewrittenSubject: normalizedSubject,
    aliases,
    subQueries,
  };
}
