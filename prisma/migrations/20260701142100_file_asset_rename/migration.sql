-- Migration: FileAsset rename + hash + status
-- Adds hash and status columns to UploadedFile table, creates FileAssetStatus enum
-- Table name remains "UploadedFile" via @@map, so this migration only adds columns

-- Step 1: Add hash column (nullable for backward compatibility with existing data)
ALTER TABLE "UploadedFile" ADD COLUMN "hash" VARCHAR(64);

-- Step 2: Create enum type
CREATE TYPE pm."FileAssetStatus" AS ENUM ('ACTIVE', 'DELETED');

-- Step 3: Add status column with default
ALTER TABLE "UploadedFile" ADD COLUMN "status" pm."FileAssetStatus" NOT NULL DEFAULT 'ACTIVE';

-- Step 4: Add composite unique constraint on hash + size
-- Note: Existing NULL hash values will be treated as distinct, so this is safe
CREATE UNIQUE INDEX "UploadedFile_hash_size_key" ON "UploadedFile"("hash", "size")
  WHERE "hash" IS NOT NULL;

-- Step 5: Add index for status + createdAt queries
CREATE INDEX "UploadedFile_status_createdAt_idx" ON "UploadedFile"("status", "createdAt" DESC);
