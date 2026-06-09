export const SEARCH_DOCUMENT_SOURCE_TYPES = {
  TICKET: "TICKET",
  COMMIT: "COMMIT",
  KNOWLEDGE_DOC: "KNOWLEDGE_DOC",
  PKM_NOTE: "PKM_NOTE",
} as const;

export type SearchDocumentSourceType =
  (typeof SEARCH_DOCUMENT_SOURCE_TYPES)[keyof typeof SEARCH_DOCUMENT_SOURCE_TYPES];

export const SEARCH_RESULT_TYPES = ["ticket", "commit", "note"] as const;

export type SearchResultType = (typeof SEARCH_RESULT_TYPES)[number];

export type SearchDocumentMetadata = {
  ticketNo?: number;
  projectId?: string;
  projectName?: string;
  moduleName?: string;
  repoPath?: string;
  commitSha?: string;
  author?: string;
  committedAt?: string;
  branches?: string[];
  embeddingHash?: string;
  noteUserId?: string;
  noteUserName?: string;
  noteTags?: string[];
};

export type SearchResultItem = {
  id: string;
  type: SearchResultType;
  title: string;
  snippet: string;
  project: {
    id: string;
    name: string;
  } | null;
  url: string;
  score: number;
  metadata: SearchDocumentMetadata;
};

export type SearchResponseMode = "search" | "suggest";

export type SearchResponse = {
  mode: SearchResponseMode;
  query: string;
  tookMs: number;
  total: number;
  results: SearchResultItem[];
  grouped: Record<SearchResultType, SearchResultItem[]>;
};

export type SearchableRecord = {
  sourceType: SearchDocumentSourceType;
  sourceId: string;
  projectId?: string | null;
  title: string;
  content: string;
  url: string;
  metadata?: SearchDocumentMetadata;
};

export type SearchDocumentTicketRecord = {
  id: string;
  ticketNo: number;
  title: string;
  description: string | null;
  projectId: string;
  project: { id: string; name: string };
  module: { name: string; responsibility: { kind: string } };
  assignees: { user: { id: string; name: string | null; email: string } }[];
  creator: { name: string | null; email: string };
  status: string;
};

export type SearchDocumentCommitRecord = {
  id: string;
  ticketNo: number;
  subject: string;
  author: string;
  repoPath: string;
  commitSha: string;
  committedAt: Date;
  branches: string[];
  ticket: {
    project: { id: string; name: string };
    module: { name: string };
  };
};

export type SearchDocumentPkmNoteRecord = {
  id: string;
  title: string;
  content: string;
  tags: string[];
  userId: string;
  projectId: string | null;
  user: { id: string; name: string | null; email: string };
  project: { id: string; name: string } | null;
};
