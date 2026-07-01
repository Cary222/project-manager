-- IndexJob targetType 扩展
-- 支持 PKM_NOTE | FILE_ASSET | TICKET 三种 targetType

CREATE TYPE pm."IndexJobTargetType" AS ENUM ('PKM_NOTE', 'FILE_ASSET', 'TICKET');

ALTER TABLE "IndexJob" ADD COLUMN "targetType" pm."IndexJobTargetType";
ALTER TABLE "IndexJob" ADD COLUMN "targetId" TEXT;

-- Backfill: 现有 IndexJob 默认是 PKM_NOTE，targetId = noteId
UPDATE "IndexJob" SET "targetType" = 'PKM_NOTE', "targetId" = "noteId" WHERE "noteId" IS NOT NULL;

-- 加 NOT NULL 约束
ALTER TABLE "IndexJob" ALTER COLUMN "targetType" SET NOT NULL;
ALTER TABLE "IndexJob" ALTER COLUMN "targetId" SET NOT NULL;

-- 删掉旧的 noteId NOT NULL 约束（现在是可空字段，保留作向后兼容）
ALTER TABLE "IndexJob" ALTER COLUMN "noteId" DROP NOT NULL;

-- 加复合索引
CREATE INDEX "IndexJob_targetType_targetId_idx" ON "IndexJob"("targetType", "targetId");
