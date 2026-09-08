import { z } from "zod";
import { prisma } from "@/shared/db/client";
import {
  normalizeTypos,
  generateSubQueries,
  resolveAliases,
  rewriteQuery,
  type QueryRewriteResult,
  COMMON_TYPO_MAP,
  DOMAIN_ALIAS_MAP,
} from "./query-rewrite";

export {
  normalizeTypos,
  generateSubQueries,
  resolveAliases,
  rewriteQuery,
  type QueryRewriteResult,
  COMMON_TYPO_MAP,
  DOMAIN_ALIAS_MAP,
};

export const entityTypes = [
  "project",
  "note",
  "ticket",
  "commit",
  "person",
  "meeting",
] as const;

export type RequestedType = (typeof entityTypes)[number];

export type QueryScope = "INTERNAL_ONLY" | "INTERNAL_FIRST" | "WEB_ALLOWED";

export type FineGrainedIntent =
  | "LOOKUP"
  | "SEARCH"
  | "RELATION"
  | "SUMMARY"
  | "TIMELINE"
  | "RECENT_ACTIVITY"
  | "COUNT"
  | "STATUS"
  | "COMPARE"
  | "EXPLAIN"
  | "CONVERSATION"
  | "EXTERNAL";

export type LegacyIntent =
  | "related_knowledge"
  | "lookup"
  | "activity"
  | "external"
  | "conversation";

export type QueryIntent = FineGrainedIntent | LegacyIntent;

export interface EntityBinding {
  entityType: "project" | "note" | "ticket" | "user";
  id: string;
  name: string;
  matchType: "exact" | "prefix" | "fuzzy";
  confidence: number; // 0.0 - 1.0
  projectId?: string;
}

export interface AmbiguityScore {
  score: number; // 0.0 (no ambiguity) to 1.0 (completely ambiguous)
  isAmbiguous: boolean;
  reason?: string;
  candidateEntities: EntityBinding[];
}
export interface DatabaseClient {
  ticket?: { findFirst: (args: unknown) => Promise<unknown> };
  project?: { findMany: (args: unknown) => Promise<unknown> };
  pkmNote?: { findMany: (args: unknown) => Promise<unknown> };
  user?: { findMany: (args: unknown) => Promise<unknown> };
}

export interface QueryUnderstanding {
  subject: string;
  scope: QueryScope;
  intent: QueryIntent;
  fineGrainedIntent: FineGrainedIntent;
  requestedTypes: RequestedType[];
  explicitTypes: RequestedType[];
  needsStructured: boolean;
  needsHybrid: boolean;
  needsGraph: boolean;
  needsWeb: boolean;
  /** Hints are not resolved identities. No suffix regex may promote them to a person. */
  entityHints: { ticketNo?: number; person?: string };
  /** Orthogonal sub-queries for diverse recall */
  subQueries?: string[];
  /** Pre-resolved entity bindings from database */
  bindings?: EntityBinding[];
  /** Ambiguity evaluation */
  ambiguity?: AmbiguityScore;
}

export const typeWords: Record<RequestedType, string[]> = {
  project: ["项目", "模块", "组件", "project"],
  note: ["笔记", "文档", "需求", "设计", "资料", "note"],
  ticket: ["工单", "单子", "ticket"],
  commit: ["提交", "代码", "分支", "commit"],
  person: ["人员", "负责人", "工程师", "成员", "谁"],
  meeting: ["会议", "周会", "纪要"],
};

const internalWords = [
  "站内",
  "系统内",
  "项目里",
  "项目内",
  "内部",
  "本系统",
  "不要联网",
  "别联网",
  "不联网",
  "禁止联网",
];

const webWords = ["联网", "公网", "外网", "网上", "互联网", "web search"];
const liveWords = ["天气", "气温", "下雨", "新闻", "股价", "汇率", "比赛结果"];

const relationWords = [
  "涉及",
  "关联",
  "相关",
  "哪些信息",
  "共同",
  "还处理",
  "还负责",
  "影响",
  "链路",
];

const activityWords = [
  "干了什么",
  "做了什么",
  "在做什么",
  "在干嘛",
  "在干什么",
  "工作近况",
  "工作内容",
  "周报",
  "工作动态",
  "提交了什么",
  "提交了啥",
  "提交记录",
  "提交了哪些",
  "写了什么",
  "写了啥",
  "改了什么",
  "更新了什么",
  "做了啥",
  "干了啥",
  "开发了什么",
  "开发了啥",
  "最近动态",
  "进展",
  "负责了什么",
  "负责什么",
  "在负责什么",
  "负责哪些",
  "负责了哪些",
  "跟进了什么",
];

const timeWords = [
  "最近",
  "近期",
  "本周",
  "这周",
  "上周",
  "昨天",
  "今天",
  "本月",
  "这个月",
];

const countWords = [
  "多少",
  "数量",
  "总数",
  "几条",
  "几个",
  "计数",
  "统计",
  "总共",
  "统计下",
];
const statusWords = [
  "状态",
  "进展如何",
  "进度",
  "完成率",
  "是否完成",
  "是否关闭",
  "进行中",
  "逾期",
  "目前状态",
];
const timelineWords = [
  "时间线",
  "历史",
  "演进",
  "脉络",
  "时间轴",
  "按时间",
  "演化",
  "先后顺序",
];
const summaryWords = [
  "总结",
  "概括",
  "总览",
  "全貌",
  "汇总",
  "梳理",
  "整体情况",
  "简介",
  "大纲",
];
const compareWords = [
  "对比",
  "区别",
  "比较",
  "差异",
  "不同",
  "vs",
  "相比",
  "优缺点",
];
const explainWords = [
  "为什么",
  "原因",
  "原理",
  "如何解释",
  "为何",
  "机理",
  "排查原因",
  "怎么回事",
];

const has = (text: string, words: string[]) =>
  words.some((word) => text.includes(word));

/** Scope is an independent policy decision; neither a model nor a mode can weaken it. */
export function resolveQueryScope(
  query: string,
  inherited?: QueryScope,
): QueryScope {
  const text = query.toLowerCase();
  if (has(text, internalWords)) return "INTERNAL_ONLY";
  if (has(text, webWords) || has(text, liveWords)) return "WEB_ALLOWED";
  return inherited === "INTERNAL_ONLY" ? inherited : "INTERNAL_FIRST";
}

/** Keep subject extraction independent of requested result types and person resolution. */
export function extractSubject(query: string): string {
  let subject = query.trim();
  const prefixes = [
    "请帮我",
    "帮我",
    "麻烦",
    "请问",
    "请",
    "查询一下",
    "查一下",
    "查看",
    "查询",
    "查找",
    "搜索",
    "搜一下",
    "了解一下",
    "梳理一下",
  ];
  for (let pass = 0; pass < 3; pass++) {
    const prefix = prefixes.find((word) => subject.startsWith(word));
    if (!prefix) break;
    subject = subject.slice(prefix.length).trim();
  }
  const boundaries = [
    "涉及",
    "关联",
    "相关",
    "的",
    ...timeWords,
    ...activityWords,
  ];
  const positions = boundaries
    .map((word) => subject.indexOf(word))
    .filter((index) => index > 0);
  if (positions.length) subject = subject.slice(0, Math.min(...positions));
  for (const word of [
    ...internalWords,
    "有哪些",
    "有什么",
    "信息",
    "设计",
    "需求",
    ...countWords,
    ...statusWords,
    ...summaryWords,
    ...compareWords,
    ...explainWords,
  ])
    subject = subject.split(word).join(" ");
  subject = subject.replace(/[，。！？?！:：]/g, " ").trim();
  return subject || query.trim();
}

/**
 * Detect fine-grained intent across 12 distinct categories.
 */
export function detectFineGrainedIntent(
  text: string,
  scope: QueryScope,
  types: RequestedType[],
  hasTicketNo: boolean,
): FineGrainedIntent {
  if (
    /^(?:你好|您好|谢谢|多谢|好的|收到|hi|hello|嗨|在吗|在不在|早安|晚上好)(?:呀|啊|呢|吧|啦)?(?:[，,\s]+(?:在吗|你好|您好|哈喽|嗨))?[!！?？.~。\s]*$/i.test(
      text.trim(),
    )
  ) {
    return "CONVERSATION";
  }
  if (scope === "WEB_ALLOWED" && !types.length) {
    return "EXTERNAL";
  }
  if (has(text, countWords)) {
    return "COUNT";
  }
  if (has(text, statusWords)) {
    return "STATUS";
  }
  if (has(text, timelineWords)) {
    return "TIMELINE";
  }
  if (has(text, summaryWords)) {
    return "SUMMARY";
  }
  if (/(?:查找|搜索|检索|搜一下).*(?:资料|文档|笔记|知识|说明)/.test(text)) {
    return "SEARCH";
  }
  if (has(text, relationWords) || types.length > 1) {
    return "RELATION";
  }
  const hasActivityWord =
    has(text, activityWords) ||
    (has(text, timeWords) &&
      /(?:干|做|写|提交|开发|负责|跟进)(?:了|过)?(?:什么|啥|哪些)?/.test(text));
  if (hasActivityWord) {
    return "RECENT_ACTIVITY";
  }
  if (has(text, compareWords)) {
    return "COMPARE";
  }
  if (has(text, explainWords)) {
    return "EXPLAIN";
  }
  if (
    hasTicketNo ||
    /(?:详情|具?体内容|单号|是谁|查一下)\b/.test(text) ||
    types.length === 1
  ) {
    return "LOOKUP";
  }
  return "SEARCH";
}

/**
 * Maps fine-grained intent to backward-compatible legacy intent.
 */
function toLegacyIntent(intent: FineGrainedIntent): LegacyIntent {
  switch (intent) {
    case "CONVERSATION":
      return "conversation";
    case "EXTERNAL":
      return "external";
    case "RECENT_ACTIVITY":
    case "TIMELINE":
      return "activity";
    case "LOOKUP":
    case "COUNT":
    case "STATUS":
      return "lookup";
    case "RELATION":
    case "SEARCH":
    case "SUMMARY":
    case "COMPARE":
    case "EXPLAIN":
    default:
      return "related_knowledge";
  }
}

/** Helper to test both fine-grained and legacy intent strings */
export function isIntent(
  plan: QueryUnderstanding,
  target: FineGrainedIntent | LegacyIntent,
): boolean {
  if (plan.fineGrainedIntent === target) return true;
  if (plan.intent === target) return true;
  if (
    target === "activity" &&
    (plan.fineGrainedIntent === "RECENT_ACTIVITY" ||
      plan.fineGrainedIntent === "TIMELINE")
  )
    return true;
  if (
    target === "lookup" &&
    (plan.fineGrainedIntent === "LOOKUP" ||
      plan.fineGrainedIntent === "COUNT" ||
      plan.fineGrainedIntent === "STATUS")
  )
    return true;
  if (
    target === "related_knowledge" &&
    (plan.fineGrainedIntent === "RELATION" ||
      plan.fineGrainedIntent === "SEARCH" ||
      plan.fineGrainedIntent === "SUMMARY" ||
      plan.fineGrainedIntent === "COMPARE" ||
      plan.fineGrainedIntent === "EXPLAIN")
  )
    return true;
  return false;
}

/**
 * Quantifies ambiguity across candidate entity bindings.
 */
export function calculateAmbiguity(
  subject: string,
  bindings: EntityBinding[],
  intent?: FineGrainedIntent,
): AmbiguityScore {
  if (bindings.length === 0) {
    return {
      score: 0.1,
      isAmbiguous: false,
      reason: "未检测到特定同名实体冲突",
      candidateEntities: [],
    };
  }

  if (bindings.length === 1) {
    const only = bindings[0];
    return {
      score: only.matchType === "exact" ? 0.0 : 0.2,
      isAmbiguous: false,
      reason: `命中唯一实体「${only.name}」(${only.entityType})`,
      candidateEntities: bindings,
    };
  }

  // Multiple candidates
  const top1 = bindings[0];
  const top2 = bindings[1];
  const confidenceDiff = Math.abs(top1.confidence - top2.confidence);

  // If both have high and close confidence across different entities
  if (confidenceDiff <= 0.25) {
    const typeDiversity = new Set(bindings.slice(0, 4).map((b) => b.entityType))
      .size;
    const isAmbiguous = intent !== "RELATION" || typeDiversity >= 2;
    return {
      score: 0.75,
      isAmbiguous,
      reason: `「${subject}」同时匹配到多个相近候选实体（如「${top1.name}」与「${top2.name}」）`,
      candidateEntities: bindings.slice(0, 4),
    };
  }

  // Clear dominant winner
  return {
    score: 0.25,
    isAmbiguous: false,
    reason: `首选实体「${top1.name}」匹配度明显高于其他候选`,
    candidateEntities: bindings.slice(0, 4),
  };
}

/**
 * Resolves candidate database entity bindings for the query subject.
 * Supports optional Prisma client injection for test isolation.
 */
export async function resolveEntityBindings(
  subject: string,
  options?: {
    db?: DatabaseClient | typeof prisma;
    viewerUserId?: string;
    limit?: number;
  },
): Promise<EntityBinding[]> {
  const text = subject.trim();
  if (!text) return [];

  const db = options?.db ?? prisma;
  const limit = options?.limit ?? 4;
  const bindings: EntityBinding[] = [];

  // 1. Explicit ticket number
  const ticketMatch = text.match(/(?:#|工单\s*#?)(\d{3,})(?!\d)/);
  if (ticketMatch) {
    const ticketNo = parseInt(ticketMatch[1], 10);
    try {
      if (db.ticket) {
        const ticket = (await db.ticket.findFirst({
          where: { ticketNo },
          select: { id: true, ticketNo: true, title: true, projectId: true },
        })) as {
          id: string;
          ticketNo: number;
          title: string;
          projectId: string | null;
        } | null;
        if (ticket) {
          bindings.push({
            entityType: "ticket",
            id: ticket.id,
            name: `#${ticket.ticketNo} ${ticket.title}`,
            matchType: "exact",
            confidence: 1.0,
            projectId: ticket.projectId ?? undefined,
          });
        }
      }
    } catch {
      /* ignore db error during fast binding */
    }
  }

  // 2. Project matching
  try {
    if (db.project) {
      const projects = (await db.project.findMany({
        where: { name: { contains: text, mode: "insensitive" } },
        take: limit,
        select: { id: true, name: true },
      })) as Array<{ id: string; name: string }>;
      for (const p of projects) {
        const isExact = p.name.toLowerCase() === text.toLowerCase();
        bindings.push({
          entityType: "project",
          id: p.id,
          name: p.name,
          matchType: isExact ? "exact" : "fuzzy",
          confidence: isExact ? 1.0 : 0.85,
          projectId: p.id,
        });
      }
    }
  } catch {
    /* ignore */
  }

  // 3. PKM Note matching
  try {
    if (db.pkmNote) {
      const notes = (await db.pkmNote.findMany({
        where: { title: { contains: text, mode: "insensitive" } },
        take: limit,
        select: { id: true, title: true, projectId: true },
      })) as Array<{ id: string; title: string; projectId: string | null }>;
      for (const n of notes) {
        const isExact = n.title.toLowerCase() === text.toLowerCase();
        bindings.push({
          entityType: "note",
          id: n.id,
          name: n.title,
          matchType: isExact ? "exact" : "fuzzy",
          confidence: isExact ? 0.95 : 0.8,
          projectId: n.projectId ?? undefined,
        });
      }
    }
  } catch {
    /* ignore */
  }

  // 4. User matching (short queries only)
  if (text.length <= 10 && !ticketMatch) {
    try {
      if (db.user) {
        const users = (await db.user.findMany({
          where: {
            OR: [
              { name: { contains: text, mode: "insensitive" } },
              { email: { contains: text, mode: "insensitive" } },
            ],
            bannedAt: null,
          },
          take: limit,
          select: { id: true, name: true, email: true },
        })) as Array<{ id: string; name: string | null; email: string }>;
        for (const u of users) {
          const isExact = u.name?.toLowerCase() === text.toLowerCase();
          bindings.push({
            entityType: "user",
            id: u.id,
            name: u.name ?? u.email,
            matchType: isExact ? "exact" : "fuzzy",
            confidence: isExact ? 0.95 : 0.75,
          });
        }
      }
    } catch {
      /* ignore */
    }
  }

  // Sort descending by confidence
  bindings.sort((a, b) => b.confidence - a.confidence);

  // Deduplicate by entityType + id
  const deduped: EntityBinding[] = [];
  const seen = new Set<string>();
  for (const b of bindings) {
    const key = `${b.entityType}:${b.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(b);
    }
  }

  return deduped.slice(0, limit * 2);
}

/**
 * Synchronous query understanding.
 * Returns fine-grained intent, scope, requested types, and optional pre-resolved bindings/ambiguity.
 */
export function understandQuery(
  query: string,
  inherited?: QueryScope,
  preloadedBindings?: EntityBinding[],
): QueryUnderstanding {
  const text = query.trim().toLowerCase();
  const scope = resolveQueryScope(query, inherited);
  const types = entityTypes.filter((type) => has(text, typeWords[type]));
  const ticket = query.match(/(?:#|工单\s*#?)(\d{3,})(?!\d)/);
  const hasTicketNo = Boolean(ticket);

  const fineGrainedIntent = detectFineGrainedIntent(
    text,
    scope,
    types,
    hasTicketNo,
  );
  const legacyIntent = toLegacyIntent(fineGrainedIntent);

  const subject = extractSubject(query);

  const requestedTypes: RequestedType[] =
    fineGrainedIntent === "RELATION" || types.length > 1
      ? [
          ...new Set<RequestedType>([
            "project",
            ...types,
            ...(types.length < 2
              ? (["note", "ticket", "commit", "person"] as RequestedType[])
              : []),
          ]),
        ]
      : fineGrainedIntent === "RECENT_ACTIVITY" ||
          fineGrainedIntent === "TIMELINE"
        ? [...new Set<RequestedType>(["person", ...types, "ticket", "commit"])]
        : types.length
          ? types
          : ["project", "note", "ticket", "commit"];

  const bindings = preloadedBindings;
  const cleanSubject = normalizeTypos(subject);
  const planDraft: QueryUnderstanding = {
    subject: cleanSubject,
    scope,
    intent: legacyIntent,
    fineGrainedIntent,
    requestedTypes,
    explicitTypes: types,
    needsStructured: fineGrainedIntent !== "CONVERSATION",
    needsHybrid: fineGrainedIntent !== "CONVERSATION",
    needsGraph:
      fineGrainedIntent !== "CONVERSATION" && fineGrainedIntent !== "EXTERNAL",
    needsWeb: false,
    entityHints: {
      ...(ticket ? { ticketNo: Number(ticket[1]) } : {}),
      ...(fineGrainedIntent === "RECENT_ACTIVITY" ? { person: cleanSubject } : {}),
    },
    bindings: preloadedBindings,
    ambiguity: preloadedBindings
      ? calculateAmbiguity(cleanSubject, preloadedBindings, fineGrainedIntent)
      : undefined,
  };
  planDraft.subQueries = generateSubQueries(planDraft);
  return planDraft;
}

/**
 * Asynchronous query understanding with full database entity pre-resolution and ambiguity scoring.
 */
export async function understandQueryWithEntities(
  query: string,
  options?: {
    inherited?: QueryScope;
    viewerUserId?: string;
    db?: DatabaseClient | typeof prisma;
  },
): Promise<QueryUnderstanding> {
  const syncPlan = understandQuery(query, options?.inherited);
  try {
    const bindings = await resolveEntityBindings(syncPlan.subject, {
      db: options?.db,
      viewerUserId: options?.viewerUserId,
    });
    const ambiguity = calculateAmbiguity(
      syncPlan.subject,
      bindings,
      syncPlan.fineGrainedIntent,
    );
    return {
      ...syncPlan,
      bindings,
      ambiguity,
      subQueries: generateSubQueries({ ...syncPlan, bindings }),
    };
  } catch {
    return syncPlan;
  }
}

export const understandingSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  intent: z.enum([
    "related_knowledge",
    "lookup",
    "activity",
    "external",
    "conversation",
  ]),
  requestedTypes: z.array(z.enum(entityTypes)).min(1).max(6),
});

/** A model may refine semantics, but never authorize Web or remove explicit requested types. */
export function refineUnderstanding(
  base: QueryUnderstanding,
  output: unknown,
): QueryUnderstanding {
  const parsed = understandingSchema.safeParse(output);
  if (!parsed.success) return base;
  return {
    ...base,
    subject: parsed.data.subject,
    intent:
      base.intent === "related_knowledge" ? base.intent : parsed.data.intent,
    requestedTypes: [
      ...new Set([...base.requestedTypes, ...parsed.data.requestedTypes]),
    ],
    explicitTypes: base.explicitTypes,
  };
}

export function rewriteSubject(plan: QueryUnderstanding): string {
  const segments = [
    ...new Intl.Segmenter("zh", { granularity: "word" }).segment(plan.subject),
  ]
    .filter((part) => part.isWordLike)
    .map((part) => part.segment);
  const words = new Set(Object.values(typeWords).flat());
  return (
    segments
      .filter((word) => !words.has(word) && !internalWords.includes(word))
      .join(" ") || plan.subject
  );
}
