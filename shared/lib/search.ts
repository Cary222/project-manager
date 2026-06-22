import { Prisma } from "@prisma/client";
import type { SearchDocumentSourceType as PrismaSearchDocumentSourceType } from "@prisma/client";
import { prisma } from "@/shared/db/client";
import {
  buildEmbeddingHash,
  buildEmbeddingInput,
  fetchEmbedding,
  getEmbeddingApiUrl,
} from "@/shared/lib/embedding";
import type {
  SearchDocumentCommitRecord,
  SearchDocumentMetadata,
  SearchDocumentPkmAttachmentRecord,
  SearchDocumentPkmNoteRecord,
  SearchDocumentTicketRecord,
  SearchResponse,
  SearchResponseMode,
  SearchResultItem,
  SearchResultType,
  SearchableRecord,
} from "@/shared/lib/search-types";
import { SEARCH_DOCUMENT_SOURCE_TYPES } from "@/shared/lib/search-types";
import {
  normalizePkmAttachments,
  PKM_ATTACHMENT_MAX_SIZE,
  type PkmAttachment,
} from "@/shared/lib/pkm";
import { cleanExtractedTextForEmbedding, cleanMarkdownForEmbedding, formatAttachmentLabel } from "@/shared/lib/markdown";

const SEARCH_LIMIT_DEFAULT = 8;
const SEARCH_LIMIT_MAX = 20;
const VECTOR_CANDIDATE_MULTIPLIER = 2;
const KEYWORD_CANDIDATE_MULTIPLIER = 3;
const EXTRACT_TEXT_TIMEOUT_MS = 15_000;
const MAX_EXTRACTED_CHARS = 2000;

type SearchDocumentRow = {
  id: string;
  sourceType: string;
  sourceId: string;
  projectId: string | null;
  title: string;
  content: string;
  url: string;
  metadata: Prisma.JsonValue | null;
  updatedAt: Date;
  project: { id: string; name: string } | null;
};

type SearchDocumentEmbeddingStateRow = {
  id: string;
  title: string;
  content: string;
  metadata: Prisma.JsonValue | null;
  hasEmbedding: boolean;
};

type VectorSearchRow = {
  id: string;
  sourceType: string;
  sourceId: string;
  projectId: string | null;
  title: string;
  content: string;
  url: string;
  metadata: Prisma.JsonValue | null;
  updatedAt: Date;
  projectName: string | null;
  distance: number;
};

type RankedCandidate = SearchResultItem & {
  keywordScore: number;
  semanticScore: number;
  updatedAt: number;
};

function normalizeQuery(query: string) {
  return query.trim().replace(/\s+/g, " ");
}

function truncate(text: string, max = 180) {
  const value = text.replace(/\s+/g, " ").trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

function splitTerms(query: string) {
  return normalizeQuery(query)
    .split(" ")
    .map((term) => term.trim())
    .filter(Boolean)
    .slice(0, 6);
}

function toResultType(sourceType: string): SearchResultType | null {
  if (sourceType === SEARCH_DOCUMENT_SOURCE_TYPES.TICKET) return "ticket";
  if (sourceType === SEARCH_DOCUMENT_SOURCE_TYPES.COMMIT) return "commit";
  if (sourceType === SEARCH_DOCUMENT_SOURCE_TYPES.PKM_NOTE) return "note";
  return null;
}

function coerceMetadata(value: Prisma.JsonValue | null): SearchDocumentMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const data = value as Record<string, Prisma.JsonValue>;
  return {
    ticketNo: typeof data.ticketNo === "number" ? data.ticketNo : undefined,
    projectId: typeof data.projectId === "string" ? data.projectId : undefined,
    projectName: typeof data.projectName === "string" ? data.projectName : undefined,
    moduleName: typeof data.moduleName === "string" ? data.moduleName : undefined,
    repoPath: typeof data.repoPath === "string" ? data.repoPath : undefined,
    commitSha: typeof data.commitSha === "string" ? data.commitSha : undefined,
    author: typeof data.author === "string" ? data.author : undefined,
    committedAt: typeof data.committedAt === "string" ? data.committedAt : undefined,
    branches: Array.isArray(data.branches)
      ? data.branches.filter((branch): branch is string => typeof branch === "string")
      : undefined,
    embeddingHash: typeof data.embeddingHash === "string" ? data.embeddingHash : undefined,
    noteUserId: typeof data.noteUserId === "string" ? data.noteUserId : undefined,
    noteUserName: typeof data.noteUserName === "string" ? data.noteUserName : undefined,
    noteTags: Array.isArray(data.noteTags)
      ? data.noteTags.filter((tag): tag is string => typeof tag === "string")
      : undefined,
    noteIsPublic: typeof data.noteIsPublic === "boolean" ? data.noteIsPublic : undefined,
  };
}

function buildSnippet(content: string, terms: string[]) {
  const plain = content.replace(/\s+/g, " ").trim();
  if (!plain) return "";
  const lower = plain.toLowerCase();
  const hit = terms
    .map((term) => lower.indexOf(term.toLowerCase()))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];

  if (hit === undefined) {
    return truncate(plain, 180);
  }

  const start = Math.max(0, hit - 48);
  const end = Math.min(plain.length, hit + 132);
  const snippet = plain.slice(start, end).trim();
  return `${start > 0 ? "…" : ""}${truncate(snippet, 180)}${end < plain.length ? "…" : ""}`;
}

function rankDocument(title: string, content: string, terms: string[]) {
  const lowerTitle = title.toLowerCase();
  const lowerContent = content.toLowerCase();

  return terms.reduce((score, term) => {
    const lowerTerm = term.toLowerCase();
    let next = score;
    if (lowerTitle.includes(lowerTerm)) next += 5;
    if (lowerContent.includes(lowerTerm)) next += 2;
    if (lowerTitle.startsWith(lowerTerm)) next += 2;
    return next;
  }, 0);
}

function hasDirectQueryMatch(title: string, content: string, query: string) {
  const lowerQuery = query.toLowerCase();
  return title.toLowerCase().includes(lowerQuery) || content.toLowerCase().includes(lowerQuery);
}

function buildMetadataWithEmbeddingHash(record: SearchableRecord, embeddingHash: string) {
  return {
    ...(record.metadata ?? {}),
    embeddingHash,
  } satisfies SearchDocumentMetadata;
}

function hasReusableEmbedding(
  metadata: SearchDocumentMetadata,
  embeddingHash: string,
  hasEmbedding: boolean,
) {
  return hasEmbedding && metadata.embeddingHash === embeddingHash;
}

function vectorToSqlLiteral(vector: number[]) {
  return `[${vector.join(",")}]`;
}

async function updateSearchDocumentEmbedding(id: string, vector: number[]) {
  const literal = vectorToSqlLiteral(vector);
  await prisma.$executeRaw`
    UPDATE pm."SearchDocument"
    SET embedding = ${literal}::public.vector
    WHERE id = ${id}
  `;
}

async function getSearchDocumentEmbeddingState(id: string) {
  const rows = await prisma.$queryRaw<SearchDocumentEmbeddingStateRow[]>(Prisma.sql`
    SELECT
      d."id",
      d."title",
      d."content",
      d."metadata",
      (d."embedding" IS NOT NULL) AS "hasEmbedding"
    FROM pm."SearchDocument" d
    WHERE d."id" = ${id}
    LIMIT 1
  `);

  return rows[0] ?? null;
}

const EMBEDDING_TEXT_MAX_CHARS = 8000;

async function ensureSearchDocumentEmbedding(document: SearchDocumentEmbeddingStateRow) {
  const truncatedContent =
    document.content.length > EMBEDDING_TEXT_MAX_CHARS
      ? `${document.content.slice(0, EMBEDDING_TEXT_MAX_CHARS)}…`
      : document.content;
  const embeddingInput = buildEmbeddingInput(document.title, truncatedContent);
  const embeddingHash = buildEmbeddingHash(embeddingInput);
  const metadata = coerceMetadata(document.metadata);

  if (hasReusableEmbedding(metadata, embeddingHash, document.hasEmbedding)) {
    return { reused: true, embeddingHash };
  }

  const vector = await fetchEmbedding(embeddingInput);
  await updateSearchDocumentEmbedding(document.id, vector);
  return { reused: false, embeddingHash };
}

export function buildSearchableTicketDocument(ticket: SearchDocumentTicketRecord): SearchableRecord {
  const assigneeNames = ticket.assignees.map((item) => item.user.name || item.user.email).join("、");
  const title = `#${ticket.ticketNo} ${ticket.title}`;
  const content = [
    `单子编号 #${ticket.ticketNo}`,
    `标题 ${ticket.title}`,
    ticket.description ? `描述 ${ticket.description}` : null,
    `项目 ${ticket.project.name}`,
    `模块 ${ticket.module.name}`,
    `职能 ${ticket.module.responsibility.kind}`,
    assigneeNames ? `指派 ${assigneeNames}` : null,
    `创建者 ${ticket.creator.name || ticket.creator.email}`,
    `状态 ${ticket.status}`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    sourceType: SEARCH_DOCUMENT_SOURCE_TYPES.TICKET,
    sourceId: ticket.id,
    projectId: ticket.projectId,
    title,
    content,
    url: `/tickets/${ticket.id}`,
    metadata: {
      ticketNo: ticket.ticketNo,
      projectId: ticket.project.id,
      projectName: ticket.project.name,
      moduleName: ticket.module.name,
    },
  };
}

export function buildSearchableCommitDocument(commit: SearchDocumentCommitRecord): SearchableRecord {
  const shortSha = commit.commitSha.slice(0, 7);
  const title = `#${commit.ticketNo} ${commit.subject}`;
  const content = [
    `提交 ${shortSha}`,
    `主题 ${commit.subject}`,
    `作者 ${commit.author}`,
    `项目 ${commit.ticket.project.name}`,
    `模块 ${commit.ticket.module.name}`,
    commit.body ? `内容 ${commit.body}` : null,
    commit.branches.length > 0 ? `分支 ${commit.branches.join("、")}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    sourceType: SEARCH_DOCUMENT_SOURCE_TYPES.COMMIT,
    sourceId: commit.id,
    projectId: commit.ticket.project.id,
    title,
    content,
    url: `/tickets/${commit.ticket.id}`,
    metadata: {
      ticketNo: commit.ticketNo,
      projectId: commit.ticket.project.id,
      projectName: commit.ticket.project.name,
      moduleName: commit.ticket.module.name,
      commitSha: commit.commitSha,
      author: commit.author,
      committedAt: commit.committedAt.toISOString(),
      branches: commit.branches,
    },
  };
}

export async function buildSearchablePkmNoteDocument(
  note: SearchDocumentPkmNoteRecord,
  attachmentTexts: Map<string, string> = new Map(),
): Promise<SearchableRecord> {
  const authorName = note.user.name || note.user.email;
  const title = note.title.trim();
  const attachments = normalizePkmAttachments(note.attachments);
  const cleanedContent = cleanMarkdownForEmbedding(note.content);
  const attachmentSections = attachments
    .map((attachment) => {
      const text = attachmentTexts.get(attachment.name);
      if (!text) return null;
      const cleaned = cleanExtractedTextForEmbedding(text);
      if (!cleaned) return null;
      return `[附件 ${attachment.name} 提取]\n${cleaned}`;
    })
    .filter((section): section is string => Boolean(section));
  const content = [
    `标题 ${title}`,
    `作者 ${authorName}`,
    note.project ? `项目 ${note.project.name}` : null,
    note.tags.length > 0 ? `标签 ${note.tags.join("、")}` : null,
    attachments.length > 0 ? `附件 ${attachments.map(formatAttachmentLabel).join("、")}` : null,
    cleanedContent ? `正文 ${cleanedContent}` : null,
    attachmentSections.length > 0 ? attachmentSections.join("\n\n") : null,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    sourceType: SEARCH_DOCUMENT_SOURCE_TYPES.PKM_NOTE,
    sourceId: note.id,
    projectId: note.projectId,
    title,
    content,
    url: `/pkm/notes/${note.id}`,
    metadata: {
      projectId: note.project?.id,
      projectName: note.project?.name,
      noteUserId: note.userId,
      noteUserName: authorName,
      noteTags: note.tags,
      noteIsPublic: note.isPublic,
      author: authorName,
    },
  };
}

function buildSearchDocumentSourceType(sourceType: SearchableRecord["sourceType"]): PrismaSearchDocumentSourceType {
  return sourceType as PrismaSearchDocumentSourceType;
}

export type AttachmentExtraction = {
  name: string;
  text: string;
  source: string;
};

export async function extractAttachmentText(
  attachment: PkmAttachment,
): Promise<AttachmentExtraction> {
  if (attachment.size > PKM_ATTACHMENT_MAX_SIZE) {
    return { name: attachment.name, text: "", source: "skipped_too_large" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXTRACT_TEXT_TIMEOUT_MS);

  try {
    const base = getEmbeddingApiUrl();
    const response = await fetch(`${base}/extract-text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: attachment.url,
        mimeType: attachment.mimeType,
        name: attachment.name,
        size: attachment.size,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { name: attachment.name, text: "", source: `http_${response.status}` };
    }

    const payload = (await response.json()) as {
      text?: unknown;
      source?: unknown;
      name?: unknown;
    };
    const rawText = typeof payload.text === "string" ? payload.text : "";
    const text = rawText.length > MAX_EXTRACTED_CHARS
      ? `${rawText.slice(0, MAX_EXTRACTED_CHARS).trimEnd()}…`
      : rawText;
    return {
      name: attachment.name,
      text,
      source: typeof payload.source === "string" ? payload.source : "unknown",
    };
  } catch (error) {
    const source = error instanceof Error && error.name === "AbortError"
      ? "timeout"
      : "error";
    return { name: attachment.name, text: "", source };
  } finally {
    clearTimeout(timeout);
  }
}

export async function extractAttachmentTexts(
  attachments: PkmAttachment[],
): Promise<Map<string, string>> {
  if (attachments.length === 0) return new Map();

  const results = await Promise.all(
    attachments.map((attachment) =>
      extractAttachmentText(attachment).catch((error) => {
        console.error(
          `[search:extract] failed for ${attachment.name}:`,
          error instanceof Error ? error.message : String(error),
        );
        return { name: attachment.name, text: "", source: "error" } satisfies AttachmentExtraction;
      }),
    ),
  );

  const map = new Map<string, string>();
  for (const result of results) {
    if (result.text.length > 0) {
      map.set(result.name, result.text);
    }
  }
  return map;
}

export async function upsertSearchDocument(record: SearchableRecord) {
  const embeddingInput = buildEmbeddingInput(record.title, record.content);
  const embeddingHash = buildEmbeddingHash(embeddingInput);
  const metadata = buildMetadataWithEmbeddingHash(record, embeddingHash);
  const sourceType = buildSearchDocumentSourceType(record.sourceType);

  const document = await prisma.searchDocument.upsert({
    where: {
      sourceType_sourceId: {
        sourceType,
        sourceId: record.sourceId,
      },
    },
    update: {
      projectId: record.projectId ?? null,
      title: record.title,
      content: record.content,
      url: record.url,
      metadata: metadata as Prisma.InputJsonValue,
    },
    create: {
      sourceType,
      sourceId: record.sourceId,
      projectId: record.projectId ?? null,
      title: record.title,
      content: record.content,
      url: record.url,
      metadata: metadata as Prisma.InputJsonValue,
    },
    select: {
      id: true,
      title: true,
      content: true,
      metadata: true,
    },
  });

  try {
    const state = await getSearchDocumentEmbeddingState(document.id);
    if (state) {
      await ensureSearchDocumentEmbedding(state);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[search:upsert] embedding failed for ${document.id} (${document.title}): ${msg}`);
    throw error;
  }

  return document;
}

export async function syncTicketSearchDocument(ticketId: string) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: {
      project: { select: { id: true, name: true } },
      module: { include: { responsibility: { select: { kind: true } } } },
      assignees: {
        include: { user: { select: { id: true, name: true, email: true } } },
      },
      creator: { select: { name: true, email: true } },
    },
  });

  if (!ticket) {
    await prisma.searchDocument.deleteMany({
      where: {
        sourceType: buildSearchDocumentSourceType(SEARCH_DOCUMENT_SOURCE_TYPES.TICKET),
        sourceId: ticketId,
      },
    });
    return null;
  }

  const record = buildSearchableTicketDocument(ticket);
  try {
    return await upsertSearchDocument(record);
  } catch (error) {
    console.error(`[search:syncTicket] embedding failed for ticket ${ticketId}:`, error instanceof Error ? error.message : String(error));
    return null;
  }
}

export async function syncCommitSearchDocument(commitId: string) {
  const commit = await prisma.ticketCommit.findUnique({
    where: { id: commitId },
    include: {
      ticket: {
        select: {
          id: true,
          project: { select: { id: true, name: true } },
          module: { select: { name: true } },
        },
      },
    },
  });

  if (!commit) {
    await prisma.searchDocument.deleteMany({
      where: {
        sourceType: buildSearchDocumentSourceType(SEARCH_DOCUMENT_SOURCE_TYPES.COMMIT),
        sourceId: commitId,
      },
    });
    return null;
  }

  const record = buildSearchableCommitDocument(commit);
  try {
    return await upsertSearchDocument(record);
  } catch (error) {
    console.error(`[search:syncCommit] embedding failed for commit ${commitId}:`, error instanceof Error ? error.message : String(error));
    return null;
  }
}

export async function syncPkmNoteSearchDocument(noteId: string) {
  const note = await prisma.pkmNote.findUnique({
    where: { id: noteId },
    include: {
      user: { select: { id: true, name: true, email: true } },
      project: { select: { id: true, name: true } },
    },
  });

  if (!note) {
    await prisma.searchDocument.deleteMany({
      where: {
        sourceType: buildSearchDocumentSourceType(SEARCH_DOCUMENT_SOURCE_TYPES.PKM_NOTE),
        sourceId: noteId,
      },
    });
    return null;
  }

  const attachments = normalizePkmAttachments(note.attachments);
  const attachmentTexts = await extractAttachmentTexts(attachments);

  const record = await buildSearchablePkmNoteDocument({ ...note, attachments }, attachmentTexts);
  try {
    return await upsertSearchDocument(record);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[search:syncNote] embedding failed for note ${noteId} (${note.title}): ${msg}`);
    // content 已写入 DB，embedding 失败时降级：只靠 keyword 搜索，vector 部分为空
    // 重新查一次返回已保存的 document
    const saved = await prisma.searchDocument.findFirst({
      where: {
        sourceType: buildSearchDocumentSourceType(SEARCH_DOCUMENT_SOURCE_TYPES.PKM_NOTE),
        sourceId: noteId,
      },
    });
    return saved;
  }
}

export async function backfillSearchDocuments() {
  const tickets = await prisma.ticket.findMany({
    include: {
      project: { select: { id: true, name: true } },
      module: { include: { responsibility: { select: { kind: true } } } },
      assignees: {
        include: { user: { select: { id: true, name: true, email: true } } },
      },
      creator: { select: { name: true, email: true } },
    },
  });

  const commits = await prisma.ticketCommit.findMany({
    include: {
      ticket: {
        select: {
          id: true,
          project: { select: { id: true, name: true } },
          module: { select: { name: true } },
        },
      },
    },
  });

  const notes = await prisma.pkmNote.findMany({
    include: {
      user: { select: { id: true, name: true, email: true } },
      project: { select: { id: true, name: true } },
    },
  });

  const ticketResults = await Promise.allSettled(
    tickets.map((ticket) => upsertSearchDocument(buildSearchableTicketDocument(ticket))),
  );
  const commitResults = await Promise.allSettled(
    commits.map((commit) => upsertSearchDocument(buildSearchableCommitDocument(commit))),
  );
  const noteResults = await Promise.allSettled(
    notes.map(async (note) => {
      const attachments = normalizePkmAttachments(note.attachments);
      const attachmentTexts = await extractAttachmentTexts(attachments);
      return upsertSearchDocument(
        await buildSearchablePkmNoteDocument({ ...note, attachments }, attachmentTexts),
      );
    }),
  );

  const errors = [
    ...ticketResults.filter((r): r is PromiseRejectedResult => r.status === "rejected"),
    ...commitResults.filter((r): r is PromiseRejectedResult => r.status === "rejected"),
    ...noteResults.filter((r): r is PromiseRejectedResult => r.status === "rejected"),
  ];
  if (errors.length > 0) {
    console.warn(`[search:backfill] ${errors.length} items failed embedding, content saved without vector`);
  }

  return {
    tickets: ticketResults.length,
    commits: commitResults.length,
    notes: noteResults.length,
    errors: errors.length,
  };
}

async function searchKeywordCandidates(options: {
  query: string;
  projectId?: string | null;
  limit: number;
}) {
  const documents = await prisma.searchDocument.findMany({
    where: {
      projectId: options.projectId ?? undefined,
      OR: [
        { title: { contains: options.query, mode: "insensitive" } },
        { content: { contains: options.query, mode: "insensitive" } },
      ],
    },
    include: {
      project: { select: { id: true, name: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: options.limit,
  });

  return documents as SearchDocumentRow[];
}

async function searchVectorCandidates(options: {
  query: string;
  projectId?: string | null;
  limit: number;
}) {
  const vector = await fetchEmbedding(options.query);
  const literal = vectorToSqlLiteral(vector);
  const rows = await prisma.$queryRaw<VectorSearchRow[]>(Prisma.sql`
    SELECT
      d."id",
      d."sourceType",
      d."sourceId",
      d."projectId",
      d."title",
      d."content",
      d."url",
      d."metadata",
      d."updatedAt",
      p."name" AS "projectName",
      (d."embedding" <=> ${literal}::public.vector) AS distance
    FROM pm."SearchDocument" d
    LEFT JOIN pm."Project" p ON p."id" = d."projectId"
    WHERE d."embedding" IS NOT NULL
      AND (${options.projectId ?? null}::text IS NULL OR d."projectId" = ${options.projectId ?? null})
    ORDER BY d."embedding" <=> ${literal}::public.vector ASC, d."updatedAt" DESC
    LIMIT ${options.limit}
  `);

  return rows;
}

function normalizeSemanticScore(distance: number) {
  return Math.max(0, Math.min(1, 1 - distance));
}

function toRankedCandidate(args: {
  document: Pick<SearchDocumentRow, "id" | "sourceType" | "title" | "content" | "url" | "metadata" | "updatedAt" | "project">;
  query: string;
  terms: string[];
  keywordScore?: number;
  semanticScore?: number;
}) {
  const type = toResultType(args.document.sourceType);
  if (!type) return null;

  const metadata = coerceMetadata(args.document.metadata);
  const keywordScore = args.keywordScore ?? 0;
  const semanticScore = args.semanticScore ?? 0;
  const directMatchBoost = hasDirectQueryMatch(args.document.title, args.document.content, args.query) ? 2 : 0;
  const score = keywordScore + semanticScore * 10 + directMatchBoost;

  return {
    id: args.document.id,
    type,
    title: args.document.title,
    snippet: buildSnippet(args.document.content, args.terms),
    project: args.document.project,
    url: args.document.url,
    score,
    metadata,
    keywordScore,
    semanticScore,
    updatedAt: args.document.updatedAt.getTime(),
  } satisfies RankedCandidate;
}

function canAccessSearchResult(item: SearchResultItem, viewerUserId?: string | null) {
  if (item.type !== "note") return true;
  if (item.metadata.noteUserId && viewerUserId && item.metadata.noteUserId === viewerUserId) return true;
  return item.metadata.noteIsPublic === true;
}

function mergeCandidates(options: {
  query: string;
  terms: string[];
  keywordDocuments: SearchDocumentRow[];
  vectorDocuments: VectorSearchRow[];
  viewerUserId?: string | null;
}) {
  const merged = new Map<string, RankedCandidate>();

  for (const document of options.keywordDocuments) {
    const keywordScore = rankDocument(document.title, document.content, options.terms);
    if (keywordScore <= 0 && !hasDirectQueryMatch(document.title, document.content, options.query)) {
      continue;
    }

    const candidate = toRankedCandidate({
      document,
      query: options.query,
      terms: options.terms,
      keywordScore,
    });

    if (!candidate) continue;
    if (!canAccessSearchResult(candidate, options.viewerUserId)) continue;
    merged.set(candidate.id, candidate);
  }

  for (const document of options.vectorDocuments) {
    const semanticScore = normalizeSemanticScore(document.distance);
    if (!merged.has(document.id)) {
      const keywordScore = rankDocument(document.title, document.content, options.terms);
      const candidate = toRankedCandidate({
        document: {
          id: document.id,
          sourceType: document.sourceType,
          title: document.title,
          content: document.content,
          url: document.url,
          metadata: document.metadata,
          updatedAt: document.updatedAt,
          project: document.projectId && document.projectName
            ? { id: document.projectId, name: document.projectName }
            : null,
        },
        query: options.query,
        terms: options.terms,
        keywordScore,
        semanticScore,
      });

      if (!candidate) continue;
      if (!canAccessSearchResult(candidate, options.viewerUserId)) continue;
      merged.set(candidate.id, candidate);
    } else {
      const existing = merged.get(document.id)!;
      const directMatchBoost = hasDirectQueryMatch(document.title, document.content, options.query) ? 2 : 0;
      const boostedScore = existing.keywordScore + semanticScore * 10 + directMatchBoost;
      if (boostedScore > existing.score) {
        merged.set(document.id, {
          ...existing,
          semanticScore,
          score: boostedScore,
        });
      }
    }
  }

  return Array.from(merged.values()).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.updatedAt - a.updatedAt;
  });
}

export async function searchDocuments(options: {
  query: string;
  projectId?: string | null;
  limit?: number;
  mode?: SearchResponseMode;
  viewerUserId?: string | null;
}): Promise<SearchResponse> {
  const startedAt = Date.now();
  const query = normalizeQuery(options.query);
  const mode = options.mode ?? "search";
  const limit = Math.min(Math.max(options.limit ?? SEARCH_LIMIT_DEFAULT, 1), SEARCH_LIMIT_MAX);
  const terms = splitTerms(query);

  if (!query) {
    return {
      mode,
      query,
      tookMs: 0,
      total: 0,
      results: [],
      grouped: { ticket: [], commit: [], note: [] },
    };
  }

  const keywordLimit = Math.min(SEARCH_LIMIT_MAX * KEYWORD_CANDIDATE_MULTIPLIER, limit * KEYWORD_CANDIDATE_MULTIPLIER);
  const vectorLimit = Math.min(SEARCH_LIMIT_MAX * VECTOR_CANDIDATE_MULTIPLIER, limit * VECTOR_CANDIDATE_MULTIPLIER);

  const [keywordDocuments, vectorDocuments] = await Promise.all([
    searchKeywordCandidates({ query, projectId: options.projectId, limit: keywordLimit }),
    searchVectorCandidates({ query, projectId: options.projectId, limit: vectorLimit }).catch(() => []),
  ]);

  const ranked = mergeCandidates({
    query,
    terms,
    keywordDocuments,
    vectorDocuments,
    viewerUserId: options.viewerUserId,
  }).slice(0, limit);

  const grouped: Record<SearchResultType, SearchResultItem[]> = {
    ticket: [],
    commit: [],
    note: [],
  };

  for (const item of ranked) {
    grouped[item.type].push(item);
  }

  return {
    mode,
    query,
    tookMs: Date.now() - startedAt,
    total: ranked.length,
    results: ranked,
    grouped,
  };
}

export async function refreshSearchDocumentEmbeddings(limit = 100) {
  const documents = await prisma.$queryRaw<SearchDocumentEmbeddingStateRow[]>(Prisma.sql`
    SELECT
      d."id",
      d."title",
      d."content",
      d."metadata",
      (d."embedding" IS NOT NULL) AS "hasEmbedding"
    FROM pm."SearchDocument" d
    WHERE d."embedding" IS NULL
    ORDER BY LENGTH(d."content") ASC, d."updatedAt" DESC
    LIMIT ${limit}
  `);

  const results = [] as Array<{ id: string; reused: boolean; embeddingHash: string; error?: string }>;
  for (const document of documents) {
    try {
      const result = await ensureSearchDocumentEmbedding(document);
      results.push({ id: document.id, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[search:embed] failed for ${document.id}: ${message}`);
      results.push({ id: document.id, reused: false, embeddingHash: "", error: message });
    }
  }
  return results;
}

export const backfillMissingSearchEmbeddings = refreshSearchDocumentEmbeddings;
