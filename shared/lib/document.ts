/**
 * Document 处理层工具。
 * 提供：
 *   - extractDocumentText(): 从 FileAsset bytes 提取文本（图片 OCR / PDF / plain text）
 *   - processFileAssetJob(): Worker 完整处理流程
 *
 * PR10 Feature 2 范围：Document upsert → 文本提取 → chunk → embedding → SearchDocument
 * PR11 范围：重处理逻辑、version++、旧向量清理
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/shared/db/client";
import { splitIntoChunks } from "@/shared/lib/chunk";
import { fetchEmbeddingsBatch } from "@/shared/lib/embedding";
import type { FileReferenceSourceType } from "@/shared/lib/file-reference";

/**
 * 将 number[] 向量转换为 PostgreSQL vector 字面量。
 * 与 shared/lib/search.ts 保持一致。
 */
function vectorToSqlLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

/**
 * 通过 FileReference 链反查 projectId。
 *
 * 查询路径（按 sourceType）：
 * - PKM_NOTE       → PkmNote.projectId
 * - TICKET        → Ticket.projectId
 * - TICKET_COMMENT → TicketComment.ticket → Ticket.projectId
 * - PROJECT       → sourceId 本身就是 projectId（目前无上传入口使用）
 *
 * @requires 新增 sourceType 时同步更新此 switch，否则默认返回 null
 * @requires 取第一条引用（当前业务场景下文件通常只被一个上下文引用）
 *          如未来需要支持多引用，此处逻辑需改为取首个非 null projectId 或报错
 *
 * 异常安全：查不到时返回 null，不阻塞处理。
 */
async function resolveProjectIdFromFileAsset(
  fileAssetId: string,
): Promise<string | null> {
  const ref = await prisma.fileReference.findFirst({
    where: { fileAssetId, deletedAt: null },
    select: { sourceType: true, sourceId: true },
    orderBy: { createdAt: "asc" },
  });
  if (!ref) return null;

  switch (ref.sourceType as FileReferenceSourceType) {
    case "PKM_NOTE": {
      const note = await prisma.pkmNote.findUnique({
        where: { id: ref.sourceId },
        select: { projectId: true },
      });
      return note?.projectId ?? null;
    }
    case "TICKET": {
      const ticket = await prisma.ticket.findUnique({
        where: { id: ref.sourceId },
        select: { projectId: true },
      });
      return ticket?.projectId ?? null;
    }
    case "TICKET_COMMENT": {
      const comment = await prisma.ticketComment.findUnique({
        where: { id: ref.sourceId },
        select: { ticket: { select: { projectId: true } } },
      });
      return comment?.ticket.projectId ?? null;
    }
    case "PROJECT":
      return ref.sourceId;
    default:
      return null;
  }
}

/**
 * 用 $executeRaw 写 embedding（绕过 Prisma Unsupported 字段限制）。
 * 与 syncPkmNoteSearchDocumentFull 中的 updateSearchDocumentEmbedding 逻辑一致。
 */
async function upsertSearchDocumentEmbedding(
  tx: Prisma.TransactionClient,
  searchDocId: string,
  vector: number[],
): Promise<void> {
  const literal = vectorToSqlLiteral(vector);
  await tx.$executeRaw`
    UPDATE pm."SearchDocument"
    SET embedding = ${literal}::public.vector
    WHERE id = ${searchDocId}
  `;
}

/**
 * 从 FileAsset 提取文本。
 * 支持 MIME 类型：PDF、图片(OCR)、Office文档(DOCX/PPTX/XLSX)、纯文本
 * 调用 embedding 服务的 /extract-text 端点（JSON body，含 data URL）
 */
export function decodeTextBytes(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("utf-8");
}

export async function extractDocumentText(
  fileAsset: { id: string; mimeType: string; bytes: Buffer },
): Promise<{
  text: string;
  pageCount?: number;
  metadata?: Record<string, unknown>;
}> {
  // Prisma Bytes 静态类型是 Uint8Array；显式转 Buffer 后再按 UTF-8 解码。
  if (
    fileAsset.mimeType === "text/markdown" ||
    fileAsset.mimeType === "text/plain"
  ) {
    return { text: decodeTextBytes(fileAsset.bytes) };
  }

  // 其余类型走 embedding 服务的 /extract-text（JSON body + data URL）
  return extractTextViaService(fileAsset);
}

const SUPPORTED_MIME_TYPES = new Set([
  // Office 文档
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  // 图片（OCR）
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/tiff",
  // WPS Office（兼容性处理，映射到标准 MIME）
  "application/wpsoffice",
  "application/wps-office.docx",
  "application/wps-office.pptx",
  "application/wps-office.xlsx",
]);

/**
 * 调用 embedding 服务的 /extract-text 端点提取文本。
 * 将文件 bytes 转为 data URL，通过 JSON body 发送给服务。
 */
async function extractTextViaService(
  fileAsset: { id: string; mimeType: string; bytes: Buffer },
): Promise<{ text: string; pageCount?: number; metadata?: Record<string, unknown> }> {
  const baseUrl = (process.env.EMBEDDING_API_URL ?? "http://localhost:5000").trim();
  const mimeType = normalizeMimeType(fileAsset.mimeType);
  const name = `file.${getExtension(mimeType)}`;

  if (!SUPPORTED_MIME_TYPES.has(mimeType) && !mimeType.startsWith("image/")) {
    throw new Error(`UNSUPPORTED_MIME: ${fileAsset.mimeType}`);
  }

  // 将 bytes 转为 base64 data URL（Buffer.from 确保 Node.js Buffer，toString("base64") 正确编码）
  const base64 = Buffer.from(fileAsset.bytes).toString("base64");
  const dataUrl = `data:${mimeType};base64,${base64}`;

  const response = await fetch(`${baseUrl}/extract-text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: dataUrl,
      mimeType,
      name,
      size: fileAsset.bytes.length,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`EXTRACT_TEXT_FAILED: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as {
    text?: string;
    source?: string;
    name?: string;
  };

  // source 为非 ok 表示提取失败
  if (data.source && data.source !== "ok") {
    throw new Error(`EXTRACT_${data.source.toUpperCase()}: ${data.name ?? fileAsset.mimeType}`);
  }

  return {
    text: data.text ?? "",
    metadata: { source: data.source },
  };
}

/**
 * 标准化 MIME 类型（WPS Office → 标准 Office MIME）
 */
function normalizeMimeType(mimeType: string): string {
  const wpsMap: Record<string, string> = {
    "application/wpsoffice": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/wps-office.docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/wps-office.pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/wps-office.xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
  return wpsMap[mimeType] ?? mimeType;
}

/**
 * 根据 MIME 类型获取文件扩展名
 */
function getExtension(mimeType: string): string {
  const extMap: Record<string, string> = {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/bmp": "bmp",
    "image/tiff": "tiff",
  };
  return extMap[mimeType] ?? "bin";
}

/**
 * Worker 处理 FileAsset 向量化。
 *
 * 完整流程：
 * 1. 读取 FileAsset（检查存在且未 DELETED）
 * 2. Upsert Document (status: PROCESSING)
 * 3. extractDocumentText() — 调用 Python OCR / PDF 解析服务
 * 4. splitIntoChunks() — 用 shared/lib/chunk.ts 工具
 * 5. fetchEmbeddingsBatch() — 批量向量化
 * 6. 事务内：清旧 SearchDocument chunks → 写新 chunks → 用 $executeRaw 写 embedding → Document → READY
 * 7. 失败 → Document → FAILED + error (Json)
 *
 * PR10 范围外：重处理 / version++ / 旧向量清理（→ PR11）
 */
export async function processFileAssetJob(fileAssetId: string): Promise<void> {
  const fileAsset = await prisma.fileAsset.findUnique({
    where: { id: fileAssetId },
    select: { id: true, mimeType: true, bytes: true, status: true, originalName: true },
  });

  if (!fileAsset) throw new Error(`FILE_NOT_FOUND: ${fileAssetId}`);
  if (fileAsset.status === "DELETED") throw new Error(`FILE_DELETED: ${fileAssetId}`);

  // Step 1: Upsert Document (status: PROCESSING)
  const document = await prisma.document.upsert({
    where: { fileAssetId },
    create: {
      fileAssetId,
      status: "PROCESSING",
      version: 1,
    },
    update: {
      status: "PROCESSING",
      updatedAt: new Date(),
    },
  });

  // 查 projectId（事务外只读查询，查不到则 null，不阻塞处理）
  const projectId = await resolveProjectIdFromFileAsset(fileAssetId);

  try {
    // Step 2: 提取文本
    const { text, pageCount, metadata: extractedMetadata } = await extractDocumentText({
      id: fileAsset.id,
      mimeType: fileAsset.mimeType,
      // Prisma Bytes is typed as Uint8Array; runtime is Buffer subclass
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      bytes: fileAsset.bytes as any,
    });

    if (!text.trim()) {
      throw new Error("EXTRACTION_EMPTY: no text extracted from file");
    }

    // Step 3: 切块
    const chunks = splitIntoChunks(text);

    if (chunks.length === 0) {
      throw new Error("CHUNK_EMPTY: splitIntoChunks returned empty array");
    }

    // Step 4: 批量向量化
    const embeddings = await fetchEmbeddingsBatch(chunks);

    // Step 5: 事务内写 SearchDocument + Document READY
    await prisma.$transaction(async (tx) => {
      // 清旧 chunks（同一 documentId 的）
      await tx.searchDocument.deleteMany({ where: { documentId: document.id } });

      // 写新 chunks（embedding 先跳过，用 $executeRaw 后续更新）
      const savedChunks = [];
      const chunkUrl = projectId
        ? `/projects/${projectId}/documents/${fileAsset.id}`
        : `/api/upload/${fileAsset.id}`;
      for (let i = 0; i < chunks.length; i++) {
        const saved = await tx.searchDocument.create({
          data: {
            sourceType: "DOCUMENT",
            sourceId: document.id,
            documentId: document.id,
            projectId,
            chunkIndex: i,
            title: fileAsset.originalName,
            content: chunks[i],
            url: chunkUrl,
            // metadata 暂保留 fileAssetId 一个版本（PR11 清理）
            metadata: { fileAssetId, hash: null } as Prisma.InputJsonValue,
          },
        });
        savedChunks.push(saved);
      }

      // 用 $executeRaw 批量写 embedding（绕过 Prisma Unsupported 限制）
      for (let i = 0; i < savedChunks.length; i++) {
        await upsertSearchDocumentEmbedding(tx, savedChunks[i].id, embeddings[i]);
      }

      // Document → READY
      await tx.document.update({
        where: { id: document.id },
        data: {
          status: "READY",
          extractedText: text,
          pageCount: pageCount ?? null,
          metadata: (extractedMetadata ?? null) as Prisma.InputJsonValue,
          // 用 Prisma.DbNull 清除 error 字段
          error: Prisma.DbNull,
          updatedAt: new Date(),
        },
      });
    });
  } catch (error) {
    // 失败 → Document → FAILED
    const errorMessage = error instanceof Error ? error.message : "unknown";
    await prisma.document.update({
      where: { id: document.id },
      data: {
        status: "FAILED",
        error: { message: errorMessage } as Prisma.InputJsonValue,
        updatedAt: new Date(),
      },
    });
    throw error;
  }
}
