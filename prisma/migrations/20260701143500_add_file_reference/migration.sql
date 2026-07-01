-- ============================================================
-- PR10 Feature 4: FileReference table
-- ============================================================

-- Step 1: 新增 enum
CREATE TYPE pm."FileReferenceSourceType" AS ENUM ('PKM_NOTE', 'TICKET', 'TICKET_COMMENT', 'PROJECT');

-- Step 2: 新增 FileReference table
CREATE TABLE pm."FileReference" (
  "id" TEXT NOT NULL,
  "fileAssetId" TEXT NOT NULL,
  "sourceType" pm."FileReferenceSourceType" NOT NULL,
  "sourceId" TEXT NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FileReference_pkey" PRIMARY KEY ("id")
);

-- Step 3: 索引
CREATE UNIQUE INDEX "FileReference_fileAssetId_sourceType_sourceId_key"
  ON pm."FileReference"("fileAssetId", "sourceType", "sourceId");
CREATE INDEX "FileReference_sourceType_sourceId_idx"
  ON pm."FileReference"("sourceType", "sourceId");
CREATE INDEX "FileReference_fileAssetId_idx"
  ON pm."FileReference"("fileAssetId");
CREATE INDEX "FileReference_fileAssetId_deletedAt_idx"
  ON pm."FileReference"("fileAssetId", "deletedAt");

-- Step 4: 外键（级联删除：FileAsset 删时同步删引用记录）
ALTER TABLE pm."FileReference" ADD CONSTRAINT "FileReference_fileAssetId_fkey"
  FOREIGN KEY ("fileAssetId") REFERENCES pm."UploadedFile"("id") ON DELETE CASCADE;
