-- Manual migration: add_weekly_reports_and_user_bio
-- Run with: psql "$DATABASE_URL" -f prisma/migrations/manual_add_weekly_reports/migration.sql
-- Prerequisites: Ensure connected to the database and schema "pm" exists.

BEGIN;

-- 1. Add bio to User
ALTER TABLE pm."User" ADD COLUMN IF NOT EXISTS "bio" TEXT;

-- 2. Create WeeklyReport table
CREATE TABLE IF NOT EXISTS pm."WeeklyReport" (
    id               TEXT        NOT NULL DEFAULT cuid(),
    "userId"         TEXT        NOT NULL,
    weekStart        TIMESTAMPTZ NOT NULL,
    weekEnd          TIMESTAMPTZ NOT NULL,
    title            TEXT        NOT NULL,
    content          TEXT        NOT NULL,
    attachments      JSONB,
    aiSummary        TEXT,
    aiSummaryAt      TIMESTAMPTZ,
    aiSummaryPartial BOOLEAN     NOT NULL DEFAULT false,
    createdAt        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updatedAt        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "WeeklyReport_pkey" PRIMARY KEY (id)
);

-- 3. Create WeeklyReportProject join table
CREATE TABLE IF NOT EXISTS pm."WeeklyReportProject" (
    id         TEXT NOT NULL DEFAULT cuid(),
    reportId   TEXT NOT NULL,
    projectId  TEXT NOT NULL,
    CONSTRAINT "WeeklyReportProject_pkey" PRIMARY KEY (id)
);

-- 4. Add constraints & indexes
ALTER TABLE pm."WeeklyReport"
    ADD CONSTRAINT "WeeklyReport_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES pm."User"(id) ON DELETE CASCADE,
    ADD CONSTRAINT "WeeklyReport_userId_weekStart_key"
        UNIQUE ("userId", weekStart);

CREATE INDEX IF NOT EXISTS "WeeklyReport_userId_weekStart_idx"
    ON pm."WeeklyReport" ("userId", weekStart DESC);

ALTER TABLE pm."WeeklyReportProject"
    ADD CONSTRAINT "WeeklyReportProject_reportId_fkey"
        FOREIGN KEY (reportId) REFERENCES pm."WeeklyReport"(id) ON DELETE CASCADE,
    ADD CONSTRAINT "WeeklyReportProject_projectId_fkey"
        FOREIGN KEY (projectId) REFERENCES pm."Project"(id) ON DELETE CASCADE,
    ADD CONSTRAINT "WeeklyReportProject_reportId_projectId_key"
        UNIQUE (reportId, projectId);

CREATE INDEX IF NOT EXISTS "WeeklyReportProject_projectId_idx"
    ON pm."WeeklyReportProject" (projectId);

COMMIT;
