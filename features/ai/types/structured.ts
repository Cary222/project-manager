/**
 * Structured query result types for search-structured operations.
 */

export type MatchType = "id" | "name" | "searchName" | "alias" | "fuzzy" | "self";

export interface ResolveResult {
  user: { id: string; name: string } | null;
  confidence: number;
  matchType: MatchType | null;
  candidates?: Array<{ id: string; name: string | null; email: string }>;
}

export interface SourceReference {
  index: number;
  title: string;
  url: string;
  type: "ticket" | "project" | "user" | "commit" | "weekly_report" | "meeting";
}

export interface UserActivityAttribution {
  kind: "user_activity";
  targetUserName: string;
  windowLabel: string;
  hasDirectEvidence: boolean;
  directEvidenceCount: number;
  directNoteCount: number;
  directTicketActionCount: number;
  directCommentCount: number;
  relatedTicketCount: number;
  relatedCommitCount: number;
  relatedReportCount: number;
  candidates?: Array<{ id: string; name: string | null; email: string }>;
  matchType?: MatchType | null;
}

export interface DisambiguationAttribution {
  kind: "disambiguation";
  entityType: "user" | "ticket" | "project" | "weekly_report" | "commit";
  candidates: Array<{
    id: string;
    label: string;
    summary: string;
  }>;
  count: number;
}

export type Attribution = UserActivityAttribution | DisambiguationAttribution;

export interface StructuredResult {
  summary: string;
  sources: SourceReference[];
  attribution?: Attribution;
  decision?: {
    type: "human";
    reason: string;
    entityType: string;
    candidates: Array<{ id: string; label: string; summary: string }>;
  };
}

export interface ExtractedUser {
  raw: string;
  normalized: string;
  /** 标记自我引用，当前用户查询 "我最近干了什么" 等 */
  isSelf?: boolean;
}

/** Per-entity-type disambiguation thresholds */
export const DISAMBIGUATION_THRESHOLDS = {
  user: 2,
  ticket: 999,
  project: 999,
  weekly_report: 999,
  commit: 999,
} as const;
/** Activity window types for time-based queries */
export type ActivityWindow = "today" | "yesterday" | "this_week" | "last_week" | "this_month" | "recent";
