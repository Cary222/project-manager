---
name: 四层文件架构 PR10 终版
overview: 在已有 SearchDocument/IndexJob/Worker 体系上演进为业务/文件/文档/向量四层架构。FileReference 关系表为唯一权威来源；服务端必须重算 hash；Document 加 version 字段；SearchDocument 加 documentId 字段（Indexed）；迁移脚本支持 --dry-run + --resume。
todos:
  - id: stage0
    content: "Stage0: 任务拆分、依赖图、边界互斥"
    status: pending
  - id: f1-fileasset
    content: "Feature 1: FileAsset rename + hash(服务端重算) + shared/lib/hash.ts"
    status: pending
  - id: f9-chunk
    content: "Feature 9: shared/lib/chunk.ts 抽取公共分块工具"
    status: pending
  - id: f3-indexjob
    content: "Feature 3: IndexJob 扩展 targetType (PKM_NOTE|FILE_ASSET|TICKET)"
    status: pending
  - id: f2-document
    content: "Feature 2: Document model + Worker processFileAsset + sourceType重命名 + documentId字段"
    status: pending
  - id: f4-pkm-migrate
    content: "Feature 4: PKM附件迁移 base64→fileId + FileReference hook(双写)"
    status: pending
  - id: f5-comment-attachment
    content: "Feature 5: Ticket评论附件（启用上传文件按钮）"
    status: pending
  - id: f6-ticket-attachment
    content: "Feature 6: 单子详情附件栏"
    status: pending
  - id: f7-docs-source
    content: "Feature 7: DocsTab来源标注（统一读FileReference）"
    status: pending
  - id: f8-backfill-script
    content: "Feature 8: 历史base64迁移脚本（--dry-run + --resume）"
    status: pending
  - id: stage3
    content: "Stage3: Merge + Smoke Review"
    status: pending
  - id: stage4
    content: "Stage4: Document（dev-to-doc-recap 8段式）"
    status: pending
  - id: stage5
    content: "Stage5: User Decide → Commit"
    status: pending
isProject: false
---

# PR10 — 四层文件架构迁移（mentor 第三轮反馈采纳后终版）

## 任务背景

实现业务 / 文件 / 文档处理 / 向量检索四层架构。在现有体系上演进：
- [`SearchDocument`](prisma/schema.prisma:126)（pgvector + chunkIndex）
- [`IndexJob`](prisma/schema.prisma:147) + [`worker/index.ts`](worker/index.ts)
- `embedding/`（Python FastAPI：BGE-M3 向量化）

**同步实现**：TicketCommentsPanel 启用文件上传、单子详情附件栏、DocsTab 来源标注。

---

## mentor 三轮反馈采纳情况（最终决策）

| # | 反馈 | 决策 | 落地决策 |
|---|------|------|---------|
| ① | FileReference 唯一权威，分阶段走 | 分阶段 | PR10 建表 + 双写；所有新的业务查询（DocsTab 来源反查、引用统计、删除影响面等）从 PR10 起统一只读 FileReference；PR11 再移除 attachments Json |
| ② | 服务端必须重算 hash | 必须改 | 客户端 hash 仅作快速命中优化（Hint）；服务端永远重新计算 sha256，以服务端结果作为唯一可信值 |
| ③ | FileReference.deletedAt | Schema 先预留 | `deletedAt DateTime?` 字段先加；软删除 hook 放 PR11 后续实现 |
| ④ | Document.version | 分开做 | PR10 只加 `version Int @default(1)` 字段；PR11 实现重处理 + 版本递增 + 旧向量清理 |
| ⑤ | SearchDocument.documentId 不重复写 metadata | 微调采纳 | Schema 加 `documentId String? @unique`（Indexed）；Worker 写 SearchDocument 时填 documentId；历史数据回填；metadata.fileAssetId 保留一个版本（PR11 清理），不写两份 |
| ⑥ | --resume | 必须加 | 脚本读 `scripts/.migrate-pkm-base64-attachments.state.json` 记录断点；如 state 文件不存在自动退化为全量迁移 |

---

## 最终架构

```
业务层（只引用 fileId；权威引用关系在 FileReference）
─────────────────────────────────────────────────────────
PkmNote.attachments[]        → FileAttachment { fileId }  (Json, 向前兼容)
Ticket.attachments[]         → FileAttachment { fileId }  (Json)
TicketComment.attachments[]  → FileAttachment { fileId }  (Json)
  → 所有新查询（DocsTab、来源反查、引用统计）统一只读 FileReference

FileReference (新增关系表，权威来源)
─────────────────────────────────────────────────────────
FileReference
├── id
├── fileAssetId → FileAsset
├── sourceType  PKM_NOTE | TICKET | TICKET_COMMENT | PROJECT
├── sourceId    String
├── deletedAt   DateTime?   ← 软删除（hook 放 PR11）
├── createdAt   DateTime @default(now())
└── @@unique([fileAssetId, sourceType, sourceId])
    @@index([sourceType, sourceId])   ← 来源反查秒级
    @@index([fileAssetId])
    @@index([fileAssetId, deletedAt]) ← 有效引用计数

文件层
─────────────────────────────────────────────────────────
FileAsset (重命名 UploadedFile, @@map 保留表名)
├── id, originalName, mimeType, size, bytes
├── hash String?   (sha256, 服务端权威计算)
├── status ACTIVE | DELETED
├── uploadedById
├── @@unique([hash, size])   ← 复合唯一
└── @@index([status, createdAt(sort: Desc)])

文档处理层（Document 是 FileAsset 的派生，1:1）
─────────────────────────────────────────────────────────
Document
├── id, fileAssetId @unique
├── status PENDING | PROCESSING | READY | FAILED
├── version Int @default(1)   ← 版本演进（PR11 实现重处理）
├── extractedText String?     ← chunk 缓存（量小保留，PR11 可剥）
├── pageCount Int?
├── metadata Json?
├── error Json?
└── @@index([status, updatedAt(sort: Desc)])

向量层（复用 SearchDocument，sourceType 重命名）
─────────────────────────────────────────────────────────
SearchDocument
├── sourceType: TICKET | COMMIT | DOCUMENT   ← KNOWLEDGE_DOC → DOCUMENT
├── sourceId   ← 对应 Document.id（不是 FileAsset.id）
├── documentId String? @unique  ← Indexed，新增结构化字段
├── embedding Unsupported("vector")?   ← chunk + vector 合一
├── chunkIndex Int
├── metadata   ← 不再写 documentId/fileAssetId（PR11 清理旧 metadata）
└── @@unique([sourceType, sourceId, chunkIndex])

Worker（扩展现有 IndexJob targetType）
─────────────────────────────────────────────────────────
IndexJob
├── targetType: PKM_NOTE | FILE_ASSET | TICKET
├── targetId String  (通用字段，PKM_NOTE 时 = noteId)
├── status / attempt / errorSources / backoff (不变)

共享工具（Feature 9）
─────────────────────────────────────────────────────────
shared/lib/hash.ts
  - sha256Hex(buffer: ArrayBuffer | Buffer | Uint8Array): string
  - hashFile(file: File): Promise<string>
  - 服务端上传 / Worker / 迁移脚本共用

shared/lib/chunk.ts
  - splitIntoChunks(text, maxChars, overlap): string[]
  - 从 shared/lib/search.ts 抽出；PKM 同步路径 / Worker / 迁移脚本共用
```

---

## Stage0 — 任务拆分（按依赖顺序）

### Feature 1：FileAsset 重命名 + hash 字段 + 共享 hash 工具

**涉及文件**：
- `prisma/schema.prisma` — `model UploadedFile` → `model FileAsset`（`@@map("UploadedFile")`），新增 `hash String?` 字段、新增 `status FileAssetStatus` 枚举（ACTIVE/DELETED）、`@@unique([hash, size])`、`@@index([status, createdAt(sort: Desc)])`
- `prisma/migrations/<ts>_file_asset_rename/migration.sql` — `ALTER TABLE "UploadedFile" ADD COLUMN hash VARCHAR(64)`；先不加唯一约束（待 hash 字段迁移后再加）；表名不变
- `shared/lib/hash.ts` — **新增**，`sha256Hex(buffer)` + `hashFile(file)`（Web API `crypto.subtle.digest`）；服务端上传 / Worker / 迁移脚本共用
- `shared/lib/upload.ts` — `uploadImage()` → `uploadFile()`：客户端调 `hashFile(file)` 获得 hash 并携带；服务端收到 bytes 后**重新计算 sha256**（`crypto.createHash("sha256").update(bytes).digest("hex")`），以服务端结果为准，返回 `{ fileId, url, name, mimeType, size, hash }`
- `app/api/upload/route.ts` — 接收 `{ hash?, ... }`；服务端重算 hash 后查询 `FileAsset.findUnique({ where: { hash_size: { hash: computed, size } } })`；命中则返回 existing fileId；未命中则创建

**文件边界**：独占上述 5 文件

---

### Feature 9：共享工具（hash + chunk 抽取）

**涉及文件**：
- `shared/lib/hash.ts` — 已在 Feature 1 建
- `shared/lib/chunk.ts` — **新增**，把 `splitIntoChunks` 从 `shared/lib/search.ts` 抽出
- `shared/lib/search.ts` — 改为 `export { splitIntoChunks } from "./chunk"`（移除重复定义）

**文件边界**：独占上述 2 文件（可与 Feature 1 并行）

---

### Feature 3：IndexJob 扩展 targetType

**涉及文件**：
- `prisma/schema.prisma` — `IndexJob` 新增 `targetType IndexJobTargetType` 枚举（PKM_NOTE | FILE_ASSET | TICKET），新增 `targetId String`；保留 `noteId` 字段作向后兼容
- `prisma/migrations/<ts>_index_job_target_type/migration.sql` — `ADD COLUMN targetType` + `ADD COLUMN targetId` + backfill
- `shared/lib/jobs.ts` — `enqueueIndexJob(payload: { targetType, targetId })`；旧 `enqueueIndexJob(noteId)` 保留为 deprecated wrapper
- `worker/index.ts` — `processNextJob()` 加 `job.targetType` 分支
- `shared/lib/search.ts` — `enqueueIndexJob(noteId)` → `enqueueIndexJob({ targetType: "PKM_NOTE", targetId: noteId })`

**文件边界**：独占上述 5 文件

---

### Feature 2：Document model + Worker processFileAsset

**涉及文件**：
- `prisma/schema.prisma` — 新增 `model Document`（含 `fileAssetId @unique`、`status: DocumentStatus`、`version @default(1)`、`extractedText`、`error`）；`SearchDocument` 新增 `documentId String? @unique`（Indexed）；enum `SearchDocumentSourceType` 重命名 `KNOWLEDGE_DOC → DOCUMENT`
- `prisma/migrations/<ts>_add_document_and_rename_source_type/migration.sql` — CREATE TABLE Document + ADD COLUMN documentId + `ALTER TYPE ... RENAME VALUE`（KNOWLEDGE_DOC → DOCUMENT）
- `shared/lib/document.ts` — 新增 `extractDocumentText(fileAsset, bytes)`，分支 PDF/DOCX/图片，调用 Python `/extract-text`
- `worker/document-processor.ts` — **新增**，导出 `processFileAssetJob(fileAssetId)`：
  1. 读 FileAsset bytes
  2. Document upsert (status: PROCESSING, version: current)
  3. `extractDocumentText()`
  4. splitIntoChunks (1500 + 200 overlap, from `shared/lib/chunk.ts`)
  5. fetchEmbeddingsBatch → 写 SearchDocument (sourceType: DOCUMENT, sourceId: document.id, **documentId: document.id**, metadata 保留旧 fileAssetId 兼容一个版本)
  6. Document → READY
  7. 失败 → Document → FAILED + error (Json)
- `shared/lib/search.ts` — 增加 helper：`upsertDocumentChunks(document, chunks, embeddings)` 复用现有 `upsertSearchDocument`
- `worker/index.ts` — processNextJob 加 `targetType === "FILE_ASSET"` 分支调 `processFileAssetJob`

**文件边界**：独占上述 6 文件

---

### Feature 4：PKM 附件迁移（base64 → fileId）+ FileReference hook

**涉及文件**：
- `prisma/schema.prisma` — 新增 `model FileReference`（含 `fileAssetId`、`sourceType`、`sourceId`、`deletedAt`、`createdAt` 及三个索引）；FileReference 成为唯一权威来源
- `prisma/migrations/<ts>_add_file_reference/migration.sql` — CREATE TABLE
- `shared/lib/file-reference.ts` — **新增**，导出 `recordFileReference(tx, { fileId, sourceType, sourceId })`（upsert，deletedAt = null）+ `removeFileReferences(tx, { sourceType, sourceId })`（软删除：设 deletedAt）+ `getFileReferences({ fileAssetId })`
- `shared/lib/pkm.ts` — 新增 `type FileAttachment = { fileId: string }`；新增 `extractFileAttachmentsFromLegacy(attachments: unknown): FileAttachment[]`（兼容旧 base64 url，自动走 `uploadFile()` 转 fileId）
- `app/api/pkm/notes/route.ts` — POST 接 `attachments: FileAttachment[]`；旧 base64 url 自动上传转 fileId；**事务内双写**：`PkmNote.attachments` 更新 + `FileReference.createMany()`
- `app/api/pkm/notes/[id]/route.ts` — PATCH 同上；删除时 `FileReference.updateMany({ where: { sourceType, sourceId }, data: { deletedAt: now() } })`
- `features/knowledge/pkm/PkmBoard.tsx` — `AttachmentEditor` 上传后存 `{ fileId }`，渲染时 JOIN FileAsset 拿 name/mimeType/size
- `shared/ui/AttachmentEditor.tsx` — 接收 `FileAttachment[]`，调 `uploadFile()`
- `shared/ui/AttachmentItem.tsx` — 下载/预览 URL `/api/upload/<fileId>`
- `shared/ui/NoteAttachments.tsx` — 适配新结构
- `app/pkm/notes/[id]/page.tsx` — 适配

**文件边界**：独占上述 10 文件

---

### Feature 5：Ticket 评论附件上传

**涉及文件**：
- `features/ticket/ui/ticket-detail/TicketCommentsPanel.tsx` — 启用"上传文件"按钮；文件走 `uploadFile()`；附件预览/下载
- `app/api/tickets/[id]/comments/route.ts` — POST body 新增 `attachments: FileAttachment[]`；旧 base64 url 自动转 fileId；事务内双写 `FileReference`
- `app/api/tickets/[id]/comments/[commentId]/route.ts` — GET 返回 `attachments: FileAttachment[]`；DELETE 时软删除 FileReference
- `entities/ticket/model/types.ts` — `CommentItem` 新增 `attachments?: FileAttachment[]`

**文件边界**：独占上述 4 文件

---

### Feature 6：单子详情附件栏

**涉及文件**：
- `features/ticket/ui/ticket-detail/TicketDetail.tsx` — 新增附件 section，聚合 ticket 自身 + 所有 comment attachments，按 fileId 去重，支持预览/下载
- `app/api/tickets/[id]/route.ts` — GET 增加 `comments.include({ attachments: true })`
- `entities/ticket/model/types.ts` — 如 Ticket 模型扩展 `attachments?: FileAttachment[]`

**文件边界**：独占上述 2-3 文件

---

### Feature 7：DocsTab 来源标注（FileReference 反查）

**涉及文件**：
- `features/project/ui/ProjectDetail.tsx` — `DocsTab` 新增"来源单子"（"来源笔记"旁）；数据统一从 FileReference 查
- `app/api/file-assets/[id]/references/route.ts` — **新增** GET handler：`FileReference.findMany({ where: { fileAssetId, deletedAt: null } })`，按 sourceType 分组返回

**文件边界**：独占上述 2 文件

---

### Feature 8：历史 PKM base64 迁移脚本（--dry-run + --resume）

**涉及文件**：
- `scripts/migrate-pkm-base64-attachments.ts` — Node.js 脚本，CLI argv 解析：
  - `--dry-run`：只统计，输出 JSON 报告（note 数、附件数、重复数、失败数）
  - `--batch-size=N`：分批（默认 50）
  - `--resume`：读 `scripts/.migrate-pkm-base64-attachments.state.json`（含 `lastProcessedNoteId` + `processedCount`）；如文件不存在，自动退化为全量迁移
  - 进度输出（每批 `✅ processedCount / total`）
  - 事务内每批写 `FileAsset`（去重）+ `PkmNote.attachments` 更新 + `FileReference` 双写
  - 写前提示 `pg_dump` 备份
- `package.json` — `"migrate:pkm-attachments": "tsx scripts/migrate-pkm-base64-attachments.ts"`
- `docs/migrations/PR10-pkm-base64-to-file-asset.md` — 执行步骤 + 回滚方案

**文件边界**：独占上述 3 文件

---

## 依赖图（严格顺序）

```
Feature 1: FileAsset rename + hash + shared/lib/hash.ts
    │
    ├──► Feature 9: shared/lib/chunk.ts  (可并行)
    │
    └──► Feature 3: IndexJob targetType
              │
              └──► Feature 2: Document + Worker processFileAsset
                        │
                        └──► Feature 4: PKM 附件迁移 + FileReference hook
                                  │
                                  ├──► Feature 5: Ticket 评论附件
                                  │         │
                                  │         └──► Feature 6: 单子详情附件栏
                                  │
                                  ├──► Feature 7: DocsTab 来源标注
                                  │
                                  └──► Feature 8: 历史 base64 迁移脚本
```

---

## PR 编号与分支

`PR10-file-asset-architecture`（基于 `main` 派生）

---

## 审查策略

| Feature | 类型 | 必须 Review? |
|---------|------|------------|
| 1 | Schema 重命名 + hash + Upload API 重算 hash | ✅ 是 |
| 9 | 公共工具函数抽取 | ❌ 否 |
| 3 | IndexJob 扩展 + 兼容 backfill | ✅ 是 |
| 2 | Document model + Worker + sourceType 重命名 + documentId | ✅ 是 |
| 4 | PKM 附件 + FileReference hook（双写） | ✅ 是 |
| 5 | 评论附件 UI + API | ✅ 是 |
| 6 | 单子附件 UI | ❌ 否 |
| 7 | FileReference 反查 API | ✅ 是 |
| 8 | 迁移脚本 --dry-run + --resume | ✅ 是 |

---

## 测试策略

每个 feature 完成后：
1. `npx prisma db push`（dev 环境）
2. `npx tsc --noEmit` 必须绿
3. 手动 E2E：上传文件 → Document status → SearchDocument chunk → 搜索召回
4. Worker 集成测试：`npm run test:async-index`
5. Feature 8：先 `--dry-run`，再 `--resume`（测试断点），再真实迁移

---

## Stage4 复现文档

`docs/reports/PR10-file-asset-architecture.md`（8 段式，按 `dev-to-doc-recap` skill）

---

## PR11 预告（不在 PR10 范围内）

1. **FileReference 接管读路径**：移除 attachments Json 作为查询来源，FileReference 成为唯一真相
2. **Document 重处理**：version++、旧向量清理、向量化重跑
3. **FileReference 软删除 hook**：`deletedAt` 的业务逻辑实现
4. **FileAsset → AssetVariant 演进**：原图/thumbnail/webp/preview/OCR Image 变体管理
5. **SearchDocument.metadata 清理**：移除旧 fileAssetId/fileAssetHash 兼容字段

---

## 风险与回滚

| 风险 | 缓解 |
|------|------|
| FileAsset 重命名破坏现有 upload 引用 | `@@map("UploadedFile")` 保留表名，代码层改名 |
| FileReference 双写不一致 | 同事务内 upsert；外层包 `prisma.$transaction` |
| 服务端 hash 重算失败 | upload API 返回 400 + client hash hint 用于 debug |
| base64 迁移误删数据 | dry-run 强制先跑；写前提示 pg_dump 备份 |
| Worker 扩展 targetType 兼容 | 保留 `noteId` 字段，从 `targetId` 同步 |
| SearchDocument.sourceType 重命名 | 先查库是否有 KNOWLEDGE_DOC 数据，有则先迁移再 rename |