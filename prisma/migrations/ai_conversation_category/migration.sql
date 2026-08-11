-- Add category column to ai_conversation table for chat/work classification
ALTER TABLE pm.ai_conversation
ADD COLUMN IF NOT EXISTS category VARCHAR(20) NOT NULL DEFAULT 'CHAT';

-- Create index for category filtering
CREATE INDEX IF NOT EXISTS idx_ai_conversation_user_category_last_message
ON pm.ai_conversation (user_id, category, last_message_at DESC);

-- Backfill existing conversations as CHAT
UPDATE pm.ai_conversation
SET category = 'CHAT'
WHERE category IS NULL OR category = '';
