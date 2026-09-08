import type { QueryUnderstanding, RequestedType } from "./query-understanding";
import type { Evidence } from "./retrieval-router";

export type EvidenceStatus =
  | "SUFFICIENT"
  | "WEAK"
  | "INSUFFICIENT"
  | "AMBIGUOUS";

export interface ClarificationSuggestion {
  id: string;
  label: string;
  query: string;
  type?: RequestedType | "general";
  description?: string;
}

export interface EvidenceEvaluation {
  status: EvidenceStatus;
  score: number;
  reason: string;
  suggestions: ClarificationSuggestion[];
  coverage: {
    requestedTypes: RequestedType[];
    coveredTypes: RequestedType[];
    missingTypes: RequestedType[];
  };
}

const typeLabels: Record<RequestedType, string> = {
  project: "项目",
  note: "笔记",
  ticket: "工单",
  commit: "提交",
  person: "人员",
  meeting: "会议",
};

/**
 * Evaluates retrieved evidence against the query plan after all retrievers execute.
 * Never interrupts upfront; generates helpful follow-up suggestions at the end of the turn.
 */
export function evaluateEvidence(
  plan: QueryUnderstanding,
  evidence: Evidence[],
): EvidenceEvaluation {
  const usable = evidence.filter(
    (item) =>
      item.content.trim() &&
      item.url.startsWith("/") &&
      !item.url.startsWith("//"),
  );

  const coveredTypes = [...new Set(usable.map((item) => item.type))];
  const missingTypes = plan.requestedTypes.filter(
    (type) => !coveredTypes.includes(type),
  );
  const explicitMissing = plan.explicitTypes.filter(
    (type) => !coveredTypes.includes(type),
  );

  const suggestions: ClarificationSuggestion[] = [];

  // Case 1: Insufficient evidence
  if (usable.length === 0) {
    const fallbackQueries = [
      plan.subject
        ? `查看与「${plan.subject}」相关的全部文档`
        : "查看最近活跃项目",
      "查看本周活跃工单与任务",
    ];
    return {
      status: "INSUFFICIENT",
      score: 0.0,
      reason: `站内未检索到与「${plan.subject}」相关的直接证据。检索失败不等于站内不存在数据。`,
      suggestions: fallbackQueries.map((q, i) => ({
        id: `insufficient_${i}`,
        label: q,
        query: q,
        type: "general",
      })),
      coverage: {
        requestedTypes: plan.requestedTypes,
        coveredTypes: [],
        missingTypes: plan.requestedTypes,
      },
    };
  }

  // Deduplicate top candidate entities across types
  const distinctEntities = new Map<string, Evidence>();
  for (const item of usable) {
    const key = `${item.type}:${item.title}`;
    if (!distinctEntities.has(key)) {
      distinctEntities.set(key, item);
    }
  }
  const topEntities = Array.from(distinctEntities.values()).slice(0, 4);

  // Check ambiguity: multiple high-level distinct target entities matching the subject
  const topLevelCategories = new Set(topEntities.map((e) => e.type));
  const isMultiEntityAmbiguity =
    topLevelCategories.size >= 2 || topEntities.length >= 3;

  for (const entity of topEntities) {
    const labelPrefix = typeLabels[entity.type] || "相关";
    suggestions.push({
      id: `entity_${entity.type}_${entity.id}`,
      label: `查看${labelPrefix}「${entity.title}」`,
      query: `${labelPrefix} ${entity.title} 的详细信息与关联内容`,
      type: entity.type,
      description: entity.content.slice(0, 60),
    });
  }

  // If specific requested types are explicitly missing, suggest searching for them
  for (const missing of explicitMissing.slice(0, 2)) {
    const label = typeLabels[missing];
    suggestions.push({
      id: `missing_${missing}`,
      label: `专门查询「${plan.subject}」的${label}`,
      query: `${plan.subject} 相关的${label}有哪些`,
      type: missing,
      description: `针对缺失的${label}信息进行专门检索`,
    });
  }

  // Determine status & score
  if (explicitMissing.length > 0) {
    return {
      status: "WEAK",
      score: 0.45,
      reason: `已找到部分相关证据，但缺少显式要求的类型：${explicitMissing.map((t) => typeLabels[t]).join("、")}。`,
      suggestions: suggestions.slice(0, 4),
      coverage: {
        requestedTypes: plan.requestedTypes,
        coveredTypes,
        missingTypes,
      },
    };
  }

  if (isMultiEntityAmbiguity && plan.intent === "lookup") {
    return {
      status: "AMBIGUOUS",
      score: 0.7,
      reason: `检索到多个可能的目标实体（包含${Array.from(topLevelCategories)
        .map((t) => typeLabels[t])
        .join("、")}），已在回答中分别总结。`,
      suggestions: suggestions.slice(0, 4),
      coverage: {
        requestedTypes: plan.requestedTypes,
        coveredTypes,
        missingTypes,
      },
    };
  }

  if (usable.length < 2 && plan.requestedTypes.length > 2) {
    return {
      status: "WEAK",
      score: 0.55,
      reason: "仅找到单项局部线索，可能无法完全满足多实体综合查询要求。",
      suggestions: suggestions.slice(0, 3),
      coverage: {
        requestedTypes: plan.requestedTypes,
        coveredTypes,
        missingTypes,
      },
    };
  }

  return {
    status: "SUFFICIENT",
    score: 0.9,
    reason: "检索证据充沛，已覆盖核心业务实体范围。",
    suggestions: suggestions.slice(0, 3),
    coverage: {
      requestedTypes: plan.requestedTypes,
      coveredTypes,
      missingTypes,
    },
  };
}
