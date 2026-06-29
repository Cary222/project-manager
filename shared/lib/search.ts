import { Prisma } from "@prisma/client";
import type { SearchDocumentSourceType as PrismaSearchDocumentSourceType } from "@prisma/client";
import { prisma } from "@/shared/db/client";
import {
  buildEmbeddingHash,
  buildEmbeddingInput,
  fetchEmbedding,
  fetchEmbeddingsBatch,
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
const VECTOR_CANDIDATE_MULTIPLIER = 10;
const KEYWORD_CANDIDATE_MULTIPLIER = 3;
const EXTRACT_TEXT_TIMEOUT_MS = 60_000;
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

// Snippet size for SearchDocument results shown to the LLM. Bumped from
// 180 to 800 so the LLM can see the answer when it sits in the middle of
// a long chunk (e.g. a 1500-char spec chunk where the user-asked value
// appears around char 1000). 800 still fits comfortably in the prompt
// budget while making RAG useful for question-answering over long docs.
const SNIPPET_MAX_CHARS = 800;

function splitTerms(query: string): string[] {
  const normalized = normalizeQuery(query);
  const tokens = normalized.split(" ").map((t) => t.trim()).filter(Boolean);

  // For a single Chinese token, use 2-gram so "光污染设计的需求里视场角" becomes
  // ["光污染", "污染", "设计", "需求", "视场角", ...] — each keyword hit gives +2
  // keyword score, so the chunk containing "光污染" + "设计" + "视场角" ranks highest.
  if (tokens.length === 1 && /[\u4e00-\u9fff]/.test(tokens[0])) {
    const word = tokens[0];
    const terms: string[] = [];
    // Walk through the string in 2-char steps, filtering out pure ASCII.
    for (let i = 0; i < word.length - 1; i++) {
      const term = word.slice(i, i + 2);
      if (/[\u4e00-\u9fff]{2}/.test(term)) terms.push(term);
    }
    return terms.slice(0, 6);
  }

  return tokens.slice(0, 6);
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
    noteAttachmentCount: typeof data.noteAttachmentCount === "number" ? data.noteAttachmentCount : undefined,
    noteIndexedAttachmentCount: typeof data.noteIndexedAttachmentCount === "number" ? data.noteIndexedAttachmentCount : undefined,
  };
}

function buildSnippet(content: string, terms: string[]) {
  const plain = content.replace(/\s+/g, " ").trim();
  if (!plain) return "";

  // When the chunk is short enough, return it whole — no truncation. This
  // is important for chunk-level RAG: a 1500-char chunk often *is* the
  // answer and shouldn't be cropped to 180 chars from the top.
  if (plain.length <= SNIPPET_MAX_CHARS) return plain;

  const lower = plain.toLowerCase();
  const hits = terms
    .map((term) => lower.indexOf(term.toLowerCase()))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b);

  if (hits.length === 0) {
    return truncate(plain, SNIPPET_MAX_CHARS);
  }

  // Use the *last* hit as the anchor. With queries like "光污染 视场角",
  // "光污染" matches near the top of the chunk but "视场角" matches in
  // the middle — and the middle one is where the user's answer lives.
  // Picking the last hit keeps both terms inside the snippet window.
  const hit = hits[hits.length - 1];
  const radius = Math.floor((SNIPPET_MAX_CHARS - 1) / 2);
  const start = Math.max(0, hit - radius);
  const end = Math.min(plain.length, start + SNIPPET_MAX_CHARS - 1);
  const snippet = plain.slice(start, end).trim();
  return `${start > 0 ? "…" : ""}${snippet}${end < plain.length ? "…" : ""}`;
}

function rankDocument(title: string, content: string, terms: string[], rawQuery?: string) {
  const lowerTitle = title.toLowerCase();
  const lowerContent = content.toLowerCase();

  let score = terms.reduce((s, term) => {
    const lowerTerm = term.toLowerCase();
    let next = s;
    if (lowerTitle.includes(lowerTerm)) next += 5;
    if (lowerContent.includes(lowerTerm)) next += 2;
    if (lowerTitle.startsWith(lowerTerm)) next += 2;
    return next;
  }, 0);

  // For Chinese queries with no spaces, extract significant sub-terms from the
  // raw query and boost chunks that contain them. Without this, a query like
  // "光污染设计的需求里视场角是多少" produces n-gram terms that don't match
  // the chunk's structured text ("光污染", "设计", "视场角" vs "光污染设计需求文档").
  // This extra boost rewards semantic co-occurrence even when exact keyword
  // matching fails.
  if (rawQuery && /[\u4e00-\u9fff]/.test(rawQuery) && score === 0) {
    const q = rawQuery.toLowerCase();
    const targetTerms = ["光污染", "设计", "需求", "视场角", "指标", "参数", "规格", "功能"];
    for (const t of targetTerms) {
      if (q.includes(t) && lowerContent.includes(t)) {
        score += 1;
      }
    }
  }

  return score;
}

function hasDirectQueryMatch(title: string, content: string, query: string) {
  const lowerQuery = query.toLowerCase();
  return title.toLowerCase().includes(lowerQuery) || content.toLowerCase().includes(lowerQuery);
}

const CHUNK_SIZE = 1500;
const CHUNK_OVERLAP = 200;

export function splitIntoChunks(
  text: string,
  maxChars = CHUNK_SIZE,
  overlapChars = CHUNK_OVERLAP,
): string[] {
  if (text.length <= maxChars) return [text];
  overlapChars = Math.min(overlapChars, maxChars - 1);

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + maxChars, text.length);
    chunks.push(text.slice(start, end));
    if (end === text.length) break;
    start = end - overlapChars;
  }

  return chunks;
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

function buildSearchablePkmNoteDocumentContent(
  note: SearchDocumentPkmNoteRecord,
  content: string,
  chunkIndex: number,
  totalChunks: number,
  attachmentIndexedCount: number,
): SearchableRecord {
  const authorName = note.user.name || note.user.email;

  const header = [
    `标题 ${note.title.trim()}`,
    `作者 ${authorName}`,
    note.project ? `项目 ${note.project.name}` : null,
    `[chunk ${chunkIndex + 1}/${totalChunks}]`,
  ].filter(Boolean).join("\n");

  const totalAttachmentCount = Array.isArray(note.attachments) ? note.attachments.length : 0;

  return {
    sourceType: SEARCH_DOCUMENT_SOURCE_TYPES.PKM_NOTE,
    sourceId: note.id,
    projectId: note.projectId,
    title: note.title.trim(),
    content: `${header}\n${content}`,
    url: `/pkm/notes/${note.id}`,
    metadata: {
      projectId: note.project?.id,
      projectName: note.project?.name,
      noteUserId: note.userId,
      noteUserName: authorName,
      noteTags: note.tags,
      noteIsPublic: note.isPublic,
      author: authorName,
      chunkIndex,
      totalChunks,
      noteAttachmentCount: totalAttachmentCount,
      noteIndexedAttachmentCount: attachmentIndexedCount,
    },
  };
}

export async function buildSearchablePkmNoteChunks(
  note: SearchDocumentPkmNoteRecord,
  attachmentTexts: Map<string, string> = new Map(),
): Promise<SearchableRecord[]> {
  const attachments = normalizePkmAttachments(note.attachments);

  const rawChunks: string[] = [];

  if (note.content) {
    const cleaned = cleanMarkdownForEmbedding(note.content);
    if (cleaned) rawChunks.push(...splitIntoChunks(cleaned));
  }

  for (const attachment of attachments) {
    const text = attachmentTexts.get(attachment.name);
    if (!text) continue;
    const cleaned = cleanExtractedTextForEmbedding(text);
    if (!cleaned) continue;
    rawChunks.push(...splitIntoChunks(cleaned));
  }

  const totalChunks = rawChunks.length;
  const attachmentIndexedCount = attachments.reduce(
    (count, att) => count + (attachmentTexts.get(att.name) ? 1 : 0),
    0,
  );
  return rawChunks.map((content, idx) =>
    buildSearchablePkmNoteDocumentContent(note, content, idx, totalChunks, attachmentIndexedCount),
  );
}

export function buildSearchDocumentSourceType(sourceType: SearchableRecord["sourceType"]): PrismaSearchDocumentSourceType {
  return sourceType as PrismaSearchDocumentSourceType;
}

export type AttachmentExtraction = {
  name: string;
  text: string;
  source: string;
};

const PAGE_BASED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);
const PAGE_CHUNK_SIZE = 8;
const PAGE_CHUNK_MAX_ROUNDS = 6;

function isPageBasedAttachment(attachment: PkmAttachment): boolean {
  return PAGE_BASED_MIME_TYPES.has(attachment.mimeType);
}

export async function extractAttachmentText(
  attachment: PkmAttachment,
): Promise<AttachmentExtraction> {
  if (attachment.size > PKM_ATTACHMENT_MAX_SIZE) {
    return { name: attachment.name, text: "", source: "skipped_too_large" };
  }

  if (!isPageBasedAttachment(attachment)) {
    return extractAttachmentTextSingle(attachment);
  }

  const collected: string[] = [];
  let pageFrom = 1;
  let totalRounds = 0;
  let lastSource = "unknown";

  while (totalRounds < PAGE_CHUNK_MAX_ROUNDS) {
    const pageTo = pageFrom + PAGE_CHUNK_SIZE - 1;
    const result = await extractAttachmentTextSingle(attachment, {
      pageFrom,
      pageTo,
    });
    lastSource = result.source;
    totalRounds += 1;

    if (result.source !== "ok") break;

    const chunk = result.text.trim();
    if (!chunk) break;

    collected.push(chunk);

    if (chunk.length < MAX_EXTRACTED_CHARS) break;
    if (chunk.includes("[truncated]")) break;

    pageFrom = pageTo + 1;
  }

  const joined = collected.join("\n\n");
  return {
    name: attachment.name,
    text: joined.length > MAX_EXTRACTED_CHARS * 4
      ? `${joined.slice(0, MAX_EXTRACTED_CHARS * 4).trimEnd()}…`
      : joined,
    source: collected.length > 0 ? "ok" : lastSource,
  };
}

async function extractAttachmentTextSingle(
  attachment: PkmAttachment,
  options: { pageFrom?: number; pageTo?: number } = {},
): Promise<AttachmentExtraction> {
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
        page_from: options.pageFrom,
        page_to: options.pageTo,
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

  const map = new Map<string, string>();

  for (const attachment of attachments) {
    try {
      const result = await extractAttachmentText(attachment);
      if (result.text.length > 0) {
        map.set(result.name, result.text);
      }
    } catch (error) {
      console.error(
        `[search:extract] failed for ${attachment.name}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return map;
}

export async function upsertSearchDocument(
  record: SearchableRecord,
  chunkIndex = 0,
  skipEmbedding = false,
) {
  const sourceType = buildSearchDocumentSourceType(record.sourceType);

  const embeddingInput = buildEmbeddingInput(record.title, record.content);
  const embeddingHash = buildEmbeddingHash(embeddingInput);
  const metadata = buildMetadataWithEmbeddingHash(record, embeddingHash);

  const document = await prisma.searchDocument.upsert({
    where: {
      sourceType_sourceId_chunkIndex: {
        sourceType,
        sourceId: record.sourceId,
        chunkIndex,
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
      chunkIndex,
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

  if (skipEmbedding) return document;

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

export async function syncPkmNoteSearchDocument(
  noteId: string,
  options: { async?: boolean } = { async: true },
) {
  const isAsync = options.async !== false;
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

  // 异步路径（默认，API 路由用）：跳过附件解析，只写 content 入库，入队 Worker 处理
  // 同步路径（CLI backfill/reindex/Worker 用）：解析附件 + 生成向量，完整索引
  const attachmentTexts: Map<string, string> = new Map();
  if (!isAsync) {
    const texts = await extractAttachmentTexts(attachments);
    for (const [k, v] of texts) attachmentTexts.set(k, v);
  }

  await prisma.searchDocument.deleteMany({
    where: {
      sourceType: buildSearchDocumentSourceType(SEARCH_DOCUMENT_SOURCE_TYPES.PKM_NOTE),
      sourceId: noteId,
    },
  });

  const chunks = await buildSearchablePkmNoteChunks({ ...note, attachments }, attachmentTexts);

  if (chunks.length === 0) {
    if (isAsync) await enqueueIndexJob(noteId);
    return [];
  }

  if (isAsync) {
    // 异步路径：只写 content，不生成向量，入队
    const savedChunks = await Promise.all(
      chunks.map((chunk, idx) => upsertSearchDocument(chunk, idx, true)),
    );
    await enqueueIndexJob(noteId);
    return savedChunks;
  }

  // 同步路径：完整写入 content + 生成向量
  const savedChunks = await Promise.all(
    chunks.map((chunk, idx) => upsertSearchDocument(chunk, idx, true)),
  );
  try {
    const embeddings = await fetchEmbeddingsBatch(savedChunks.map((c) => c.content));
    await Promise.all(
      savedChunks.map(async (c, i) => {
        await updateSearchDocumentEmbedding(c.id, embeddings[i]);
      }),
    );
  } catch (error) {
    console.error(
      `[search:syncNote] embedding failed for note ${noteId} (${note.title}): ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return savedChunks;
}

export async function syncPkmNoteSearchDocumentFull(noteId: string): ReturnType<typeof syncPkmNoteSearchDocument> {
  return syncPkmNoteSearchDocument(noteId, { async: false });
}

export async function enqueueIndexJob(noteId: string): Promise<void> {
  await prisma.indexJob.deleteMany({
    where: { noteId, status: "PENDING" },
  });
  await prisma.indexJob.create({
    data: { noteId, status: "PENDING", attempt: 0 },
  });
  console.log(`[search:job] enqueued index job for note ${noteId}`);
}

export async function extractAttachmentTextsWithSources(
  attachments: PkmAttachment[],
): Promise<{
  results: Record<string, AttachmentExtraction>;
  failedCount: number;
  timeoutCount: number;
}> {
  const results: Record<string, AttachmentExtraction> = {};
  let failedCount = 0;
  let timeoutCount = 0;
  for (const attachment of attachments) {
    const result = await extractAttachmentText(attachment);
    results[result.name] = result;
    if (result.source !== "ok") {
      failedCount += 1;
      if (result.source === "timeout") timeoutCount += 1;
    }
  }
  return { results, failedCount, timeoutCount };
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
    notes.map((note) => syncPkmNoteSearchDocument(note.id)),
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
    take: options.limit * 10,
  });

  // Each chunk is an independent retrieval candidate. Previously this code
  // grouped by `sourceId` and kept only the longest chunk per note — which
  // silently dropped the chunk that actually contained the user's answer.
  // Letting every chunk compete on its own score lets RAG return the right
  // slice of a long note/attachment.
  return (documents as SearchDocumentRow[]).slice(0, options.limit);
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

  // Each vector row is an independent candidate. The SQL LIMIT already
  // returns the closest chunks, so we don't need to collapse multiple
  // chunks of the same note into one — that would drop the chunk the
  // user is actually looking for.
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
  if (!item.metadata) return false;
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
  // Each chunk is an independent candidate. Previously we deduped by
  // `${sourceType}:${sourceId}`, which meant a note with three chunks
  // could only contribute ONE chunk to the final ranked list — and if
  // that "winning" chunk didn't contain the answer, the user got nothing.
  // Now multiple chunks from the same note can appear, ranked by score;
  // the LLM treats them as different sections of the same document.
  const candidates: RankedCandidate[] = [];

  for (const document of options.keywordDocuments) {
    const keywordScore = rankDocument(document.title, document.content, options.terms, options.query);
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
    candidates.push(candidate);
  }

  for (const document of options.vectorDocuments) {
    const semanticScore = normalizeSemanticScore(document.distance);
    const keywordScore = rankDocument(document.title, document.content, options.terms, options.query);

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
    candidates.push(candidate);
  }

  return candidates.sort((a, b) => {
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
