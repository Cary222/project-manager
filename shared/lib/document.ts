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

/**
 * 将 number[] 向量转换为 PostgreSQL vector 字面量。
 * 与 shared/lib/search.ts 保持一致。
 */
function vectorToSqlLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
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
 * 分支：图片（OCR）/ PDF / plain text
 * 后续 PR 处理：DOCX, PPTX 等复杂格式
 */
export async function extractDocumentText(
  fileAsset: { id: string; mimeType: string; bytes: Buffer },
): Promise<{
  text: string;
  pageCount?: number;
  metadata?: Record<string, unknown>;
}> {
  if (fileAsset.mimeType.startsWith("image/")) {
    return extractImageText(fileAsset);
  }
  if (fileAsset.mimeType === "application/pdf") {
    return extractPdfText(fileAsset);
  }
  if (
    fileAsset.mimeType === "text/markdown" ||
    fileAsset.mimeType === "text/plain"
  ) {
    return { text: fileAsset.bytes.toString("utf-8") };
  }
  throw new Error(`UNSUPPORTED_MIME: ${fileAsset.mimeType}`);
}

async function extractImageText(
  fileAsset: { bytes: Buffer },
): Promise<{ text: string; metadata?: Record<string, unknown> }> {
  const baseUrl = process.env.EMBEDDING_SERVICE_URL?.trim() ?? "http://localhost:8001";
  const form = new FormData();
  // BlobPart = BufferSource | Blob | string. Buffer (runtime subclass of Uint8Array) is accepted.
  // Prisma Bytes is typed as Uint8Array; the runtime Buffer subclass satisfies BlobPart.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form.append("file", new Blob([fileAsset.bytes as any]), "image");

  const res = await fetch(`${baseUrl}/extract-text`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`IMAGE_EXTRACT_FAILED: ${res.status}`);
  const data = (await res.json()) as { text: string; metadata?: Record<string, unknown> };
  return { text: data.text, metadata: data.metadata };
}

async function extractPdfText(
  fileAsset: { bytes: Buffer },
): Promise<{ text: string; pageCount?: number }> {
  const baseUrl = process.env.EMBEDDING_SERVICE_URL?.trim() ?? "http://localhost:8001";
  const form = new FormData();
  // BlobPart = BufferSource | Blob | string. Buffer (runtime subclass of Uint8Array) is accepted.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form.append("file", new Blob([fileAsset.bytes as any]), "doc.pdf");

  const res = await fetch(`${baseUrl}/extract-pdf`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`PDF_EXTRACT_FAILED: ${res.status}`);
  const data = (await res.json()) as { text: string; pageCount?: number };
  return { text: data.text, pageCount: data.pageCount };
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
      for (let i = 0; i < chunks.length; i++) {
        const saved = await tx.searchDocument.create({
          data: {
            sourceType: "DOCUMENT",
            sourceId: document.id,
            documentId: document.id,
            chunkIndex: i,
            title: fileAsset.originalName,
            content: chunks[i],
            url: `/api/upload/${fileAsset.id}`,
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
