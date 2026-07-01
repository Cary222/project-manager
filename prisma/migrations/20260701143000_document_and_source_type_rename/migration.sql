-- Feature 2: Document model + SearchDocument.documentId + sourceType rename
-- Prerequisite: F1 (FileAsset rename) and F3 (IndexJob targetType) migrations must have run

-- Step 1: Create DocumentStatus enum
CREATE TYPE pm."DocumentStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');

-- Step 2: Create Document table
CREATE TABLE pm."Document" (
  "id" TEXT NOT NULL,
  "fileAssetId" TEXT NOT NULL,
  "status" pm."DocumentStatus" NOT NULL DEFAULT 'PENDING',
  "version" INTEGER NOT NULL DEFAULT 1,
  "extractedText" TEXT,
  "pageCount" INTEGER,
  "metadata" JSONB,
  "error" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- Step 3: Add unique constraint on fileAssetId
CREATE UNIQUE INDEX "Document_fileAssetId_key" ON pm."Document"("fileAssetId");

-- Step 4: Add indexes
CREATE INDEX "Document_status_updatedAt_idx" ON pm."Document"("status", "updatedAt" DESC);
CREATE INDEX "Document_fileAssetId_idx" ON pm."Document"("fileAssetId");

-- Step 5: Add foreign key from Document → FileAsset (UploadedFile)
-- Note: @@map on FileAsset keeps the physical table as "UploadedFile"
ALTER TABLE pm."Document" ADD CONSTRAINT "Document_fileAssetId_fkey"
  FOREIGN KEY ("fileAssetId") REFERENCES pm."UploadedFile"("id") ON DELETE CASCADE;

-- Step 6: Add foreign key from FileAsset → Document (1:1 via fileAssetId)
-- This is done via the Document.fileAssetId FK above; no separate FK needed on FileAsset side.

-- Step 7: SearchDocument - add documentId column
ALTER TABLE pm."SearchDocument" ADD COLUMN "documentId" TEXT;
CREATE UNIQUE INDEX "SearchDocument_documentId_key" ON pm."SearchDocument"("documentId")
  WHERE "documentId" IS NOT NULL;
CREATE INDEX "SearchDocument_documentId_idx" ON pm."SearchDocument"("documentId");

-- Step 8: Add foreign key from SearchDocument → Document
ALTER TABLE pm."SearchDocument" ADD CONSTRAINT "SearchDocument_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES pm."Document"("id") ON DELETE SET NULL;

-- Step 9: Rename KNOWLEDGE_DOC → DOCUMENT in SearchDocumentSourceType enum
-- PostgreSQL 10+ syntax for renaming enum values
-- First check if there are existing KNOWLEDGE_DOC rows that need migration
-- If no KNOWLEDGE_DOC data exists, we can safely rename. Otherwise, we need to UPDATE first.
-- For PR10, we assume no existing KNOWLEDGE_DOC production data, or it's cleaned up separately.
ALTER TYPE pm."SearchDocumentSourceType" RENAME VALUE 'KNOWLEDGE_DOC' TO 'DOCUMENT';
