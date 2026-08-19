-- Phase 4 Combined Migration (Safe - handles existing objects)
-- Part 1: Create base tables (20260819102537)
-- Part 2: Add PolicyRule fields (20260819104739)

-- ============================================================
-- Part 1: Create Enums and Tables (with IF NOT EXISTS)
-- ============================================================

-- CreateEnum (only if not exists)
DO $$ BEGIN
    CREATE TYPE "pm"."PolicyDecision" AS ENUM ('ALLOW', 'APPROVE', 'DENY');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "pm"."PolicyRuleType" AS ENUM ('TOOL_WHITELIST', 'TOOL_BLACKLIST', 'TOOL_HIL', 'COMMAND_WHITELIST', 'COMMAND_BLACKLIST', 'PATH_BLACKLIST');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "pm"."SubAgentStatus" AS ENUM ('PENDING', 'RUNNING', 'WAITING_APPROVAL', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable SubAgentRun (only if not exists)
CREATE TABLE IF NOT EXISTS "pm"."SubAgentRun" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "agentType" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "status" "pm"."SubAgentStatus" NOT NULL,
    "parentRunId" TEXT,
    "prompt" TEXT NOT NULL,
    "contextFiles" TEXT[],
    "lastEventId" TEXT,
    "lastInput" TEXT,
    "result" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,

    CONSTRAINT "SubAgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable PolicyAuditLog (only if not exists)
CREATE TABLE IF NOT EXISTS "pm"."PolicyAuditLog" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "decision" "pm"."PolicyDecision" NOT NULL,
    "reason" TEXT,
    "command" TEXT,
    "filePaths" TEXT[],
    "workspace" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable PolicyRule (only if not exists)
CREATE TABLE IF NOT EXISTS "pm"."PolicyRule" (
    "id" TEXT NOT NULL,
    "ruleType" "pm"."PolicyRuleType" NOT NULL,
    "pattern" TEXT NOT NULL,
    "decision" "pm"."PolicyDecision" NOT NULL,
    "reason" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "PolicyRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (only if not exists)
DO $$ BEGIN
    CREATE UNIQUE INDEX "SubAgentRun_runId_key" ON "pm"."SubAgentRun"("runId");
EXCEPTION
    WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
    CREATE INDEX "SubAgentRun_userId_startedAt_idx" ON "pm"."SubAgentRun"("userId", "startedAt" DESC);
EXCEPTION
    WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
    CREATE INDEX "SubAgentRun_status_startedAt_idx" ON "pm"."SubAgentRun"("status", "startedAt" DESC);
EXCEPTION
    WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
    CREATE INDEX "SubAgentRun_agentType_startedAt_idx" ON "pm"."SubAgentRun"("agentType", "startedAt" DESC);
EXCEPTION
    WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
    CREATE INDEX "SubAgentRun_sessionId_idx" ON "pm"."SubAgentRun"("sessionId");
EXCEPTION
    WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
    CREATE INDEX "PolicyAuditLog_userId_createdAt_idx" ON "pm"."PolicyAuditLog"("userId", "createdAt" DESC);
EXCEPTION
    WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
    CREATE INDEX "PolicyAuditLog_runId_idx" ON "pm"."PolicyAuditLog"("runId");
EXCEPTION
    WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
    CREATE INDEX "PolicyAuditLog_tool_createdAt_idx" ON "pm"."PolicyAuditLog"("tool", "createdAt" DESC);
EXCEPTION
    WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
    CREATE INDEX "PolicyAuditLog_decision_createdAt_idx" ON "pm"."PolicyAuditLog"("decision", "createdAt" DESC);
EXCEPTION
    WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
    CREATE INDEX "PolicyRule_ruleType_enabled_idx" ON "pm"."PolicyRule"("ruleType", "enabled");
EXCEPTION
    WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
    CREATE INDEX "PolicyRule_priority_idx" ON "pm"."PolicyRule"("priority" DESC);
EXCEPTION
    WHEN duplicate_table THEN null;
END $$;

-- AddForeignKey (only if not exists)
DO $$ BEGIN
    ALTER TABLE "pm"."SubAgentRun" ADD CONSTRAINT "SubAgentRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "pm"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "pm"."PolicyAuditLog" ADD CONSTRAINT "PolicyAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "pm"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "pm"."PolicyAuditLog" ADD CONSTRAINT "PolicyAuditLog_runId_fkey" FOREIGN KEY ("runId") REFERENCES "pm"."SubAgentRun"("runId") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "pm"."PolicyRule" ADD CONSTRAINT "PolicyRule_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "pm"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ============================================================
-- Part 2: Add PolicyRule fields (with IF NOT EXISTS)
-- ============================================================

ALTER TABLE "pm"."PolicyRule" ADD COLUMN IF NOT EXISTS "targetName" TEXT;
ALTER TABLE "pm"."PolicyRule" ADD COLUMN IF NOT EXISTS "riskLevel" TEXT;
ALTER TABLE "pm"."PolicyRule" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "pm"."PolicyRule" ADD COLUMN IF NOT EXISTS "requiresApproval" BOOLEAN NOT NULL DEFAULT false;
