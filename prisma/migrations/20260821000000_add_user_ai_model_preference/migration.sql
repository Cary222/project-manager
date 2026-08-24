-- Manual migration: add_user_ai_model_preference
-- Stage 6 Settings Schema Phase: User Scope AI 模型偏好持久化
-- Run with: npx prisma db execute --file prisma/migrations/20260821000000_add_user_ai_model_preference/migration.sql --schema prisma/schema.prisma
-- Prerequisites: schema "pm" exists.
-- enabled 语义：无行 = 默认启用；仅当显式禁用/收藏/覆盖参数时建行

BEGIN;

CREATE TABLE IF NOT EXISTS pm."UserAiModelPreference" (
    id            TEXT    NOT NULL,
    "userId"      TEXT    NOT NULL,
    provider      TEXT    NOT NULL,
    "modelId"     TEXT    NOT NULL,
    enabled       BOOLEAN NOT NULL DEFAULT true,
    favorite      BOOLEAN NOT NULL DEFAULT false,
    "thinkingLevel" TEXT,
    temperature   DOUBLE PRECISION,
    "maxTokens"   INTEGER,
    "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt"   TIMESTAMPTZ NOT NULL,
    CONSTRAINT "UserAiModelPreference_pkey" PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserAiModelPreference_userId_provider_modelId_key"
    ON pm."UserAiModelPreference"("userId", provider, "modelId");

CREATE INDEX IF NOT EXISTS "UserAiModelPreference_userId_idx"
    ON pm."UserAiModelPreference"("userId");

ALTER TABLE pm."UserAiModelPreference"
    ADD CONSTRAINT "UserAiModelPreference_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES pm."User"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
