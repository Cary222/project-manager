-- Migration: add_ticket_comment_attachments
-- PR10 Feature 5: Ticket 评论附件
-- Add attachments JSON field to TicketComment

BEGIN;

ALTER TABLE "pm"."TicketComment"
ADD COLUMN IF NOT EXISTS "attachments" JSONB NOT NULL DEFAULT '[]';

COMMENT ON COLUMN "pm"."TicketComment"."attachments" IS '评论附件（PR10 FileAttachment 格式）';

COMMIT;
