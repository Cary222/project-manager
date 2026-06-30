-- Manual migration: add_ticket_deadline
-- Run with: psql "$DATABASE_URL" -f prisma/migrations/manual_add_ticket_deadline/migration.sql
-- Prerequisites: Ensure connected to the database and schema "pm" exists.

-- 1. Add deadline column
ALTER TABLE pm."Ticket" ADD COLUMN IF NOT EXISTS "deadline" TIMESTAMPTZ;

-- 2. Add index for status + deadline queries
CREATE INDEX IF NOT EXISTS "Ticket_status_deadline_idx" ON pm."Ticket" (status, deadline);

-- 3. Add OVERDUE and CLOSED to TicketStatus enum
-- PostgreSQL enum new values must be added in a transaction-outside block
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typnamespace = 'pm'::regnamespace
    AND t.typname = 'TicketStatus'
    AND e.enumlabel = 'OVERDUE'
  ) THEN
    ALTER TYPE pm."TicketStatus" ADD VALUE 'OVERDUE';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typnamespace = 'pm'::regnamespace
    AND t.typname = 'TicketStatus'
    AND e.enumlabel = 'CLOSED'
  ) THEN
    ALTER TYPE pm."TicketStatus" ADD VALUE 'CLOSED';
  END IF;
END
$$;
