export const SEARCH_DOCUMENT_SOURCE_TYPES = {
  TICKET: "TICKET",
  COMMIT: "COMMIT",
  DOCUMENT: "DOCUMENT",
  PKM_NOTE: "PKM_NOTE",
} as const;

export type SearchDocumentSourceType =
  (typeof SEARCH_DOCUMENT_SOURCE_TYPES)[keyof typeof SEARCH_DOCUMENT_SOURCE_TYPES];

export const SEARCH_RESULT_TYPES = ["ticket", "commit", "note", "doc"] as const;

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
  noteIsPublic?: boolean;
  noteAttachmentCount?: number;
  noteIndexedAttachmentCount?: number;
  chunkIndex?: number;
  totalChunks?: number;
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
  keywordScore: number;
  semanticScore: number;
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
  commitSha: string;
  subject: string;
  author: string;
  body?: string | null;
  branches: string[];
  committedAt: Date;
  ticketNo: number;
  ticket: {
    id: string;
    project: { id: string; name: string };
    module: { name: string };
  };
};

export type SearchDocumentPkmAttachmentRecord = {
  name: string;
  url: string;
  mimeType: string;
  size: number;
};

export type SearchDocumentPkmNoteRecord = {
  id: string;
  title: string;
  content: string;
  tags: string[];
  attachments?: SearchDocumentPkmAttachmentRecord[] | null;
  isPublic: boolean;
  userId: string;
  projectId: string | null;
  user: { id: string; name: string | null; email: string };
  project: { id: string; name: string } | null;
};
