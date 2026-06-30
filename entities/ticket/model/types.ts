// Project entity types — canonical source
export type {
  Project,
  ModuleWithDetails,
  ResponsibilityWithDetails,
  MyTicket,
  ProjectStatus,
} from "@/entities/project/model/types";

export type TicketStatus = "DEVELOPING" | "READY_FOR_TEST" | "DELIVERED" | "DONE" | "OVERDUE" | "CLOSED";

export type UserBrief = {
  id: string;
  name: string | null;
  email: string;
  role: "ROOT" | "USER";
};

export type Module = {
  id: string;
  name: string;
  description?: string | null;
  tickets?: import("@/entities/project/model/types").MyTicket[];
};

export type Responsibility = {
  id: string;
  kind: "PROGRAM" | "DESIGN" | "BUG";
  modules: Module[];
};

export type Ticket = {
  id: string;
  ticketNo: number;
  title: string;
  description: string | null;
  progress: number;
  status: TicketStatus;
  creatorId: string;
  project: { id: string; name: string; responsibilities: Responsibility[] };
  assignees: UserBrief[];
  module: {
    id: string;
    name: string;
    responsibility: { kind: "PROGRAM" | "DESIGN" | "BUG" };
  };
  commits: {
    id: string;
    commitSha: string;
    author: string;
    committedAt: string;
    subject: string;
    repoPath: string;
    branches: string[];
  }[];
  assigneeHistory: {
    id: string;
    createdAt: string;
    assignees: UserBrief[];
    changedBy: UserBrief;
  }[];
  statusHistory: {
    id: string;
    status: TicketStatus;
    createdAt: string;
    changedBy: UserBrief;
  }[];
  pushSources: {
    sourceTicketId: string;
    sourceTicket: { id: string; ticketNo: number; title: string };
  }[];
  bugSources?: {
    programTicketId: string;
    programTicket: { id: string; ticketNo: number; title: string };
  }[];
};

export type TicketCreateUser = {
  id: string;
  name: string | null;
  email: string;
  role: "ROOT" | "USER";
};

export type TicketCreateResponsibility = {
  id: string;
  kind: "PROGRAM" | "DESIGN" | "BUG";
  modules: { id: string; name: string }[];
};

export type ProgramPushDraft = {
  title: string;
  description: string;
  designAssigneeIds: string[];
  programAssigneeIds: string[];
  /** Source program ticket's module id — used as the bug-form default. */
  moduleId?: string;
  /** Source program ticket's module name — used to seed the "new module name" field
   *  when the source module doesn't exist under the bug responsibility. */
  sourceModuleName?: string;
  newModuleName?: string;
};

export type PushRecordSnapshot = {
  status: "FAILED" | "SUCCEEDED" | "PENDING";
  errorMessage: string | null;
  draftTitle: string;
  draftDescription: string | null;
  programAssigneeIds: string[];
  designAssigneeIds: string[];
  targetTicket?: { id: string; ticketNo: number; title: string } | null;
};

export type BugRelation = {
  id: string;
  draftTitle: string;
  fixCommitIds: string[];
  createdAt: string;
  bugTicket: { id: string; ticketNo: number; title: string };
  boundBy: { id: string; name: string | null; email: string };
};

export type BugResolveResponse = {
  mode: "bound" | "candidate" | "unbound";
  candidateTicket?: { id: string; ticketNo: number; title: string } | null;
  shouldAutoCreate?: boolean;
  fixCommitCount?: number;
  fixCommitIds?: string[];
  fixCommits?: {
    id: string;
    commitSha: string;
    subject: string;
    author: string;
    committedAt: string;
    repoPath: string;
  }[];
};

export type PushResolveMode = "bound" | "candidate" | "unbound";

export const STATUS_LABEL: Record<TicketStatus, string> = {
  DEVELOPING: "开发中",
  READY_FOR_TEST: "待测试",
  DELIVERED: "已交付",
  DONE: "已完成",
  OVERDUE: "已逾期",
  CLOSED: "已关闭",
};

export const STATUS_STYLE: Record<TicketStatus, string> = {
  DEVELOPING: "bg-brand-50 text-brand-700",
  READY_FOR_TEST: "bg-amber-50 text-warning",
  DELIVERED: "bg-violet-50 text-purple",
  DONE: "bg-emerald-50 text-emerald-600",
  OVERDUE: "bg-red-50 text-red-600",
  CLOSED: "bg-ink-100 text-ink-500",
};

export const KIND_LABEL: Record<"PROGRAM" | "DESIGN" | "BUG", string> = {
  PROGRAM: "程序",
  DESIGN: "设计",
  BUG: "Bug",
};

export const STATUS_ORDER: Record<TicketStatus, number> = {
  DEVELOPING: 0,
  READY_FOR_TEST: 1,
  DELIVERED: 2,
  OVERDUE: 3,
  DONE: 4,
  CLOSED: 5,
};
