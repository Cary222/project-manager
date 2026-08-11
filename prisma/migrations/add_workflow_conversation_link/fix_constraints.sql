-- Add index and foreign key for conversationId (column already exists)

-- Create index for conversationId
CREATE INDEX IF NOT EXISTS "WorkflowRun_conversationId_idx" ON "pm"."WorkflowRun"("conversationId");

-- Add foreign key constraint with SET NULL on delete
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'WorkflowRun_conversationId_fkey'
    ) THEN
        ALTER TABLE "pm"."WorkflowRun" 
        ADD CONSTRAINT "WorkflowRun_conversationId_fkey" 
        FOREIGN KEY ("conversationId") 
        REFERENCES "pm"."AiConversation"("id") 
        ON DELETE SET NULL 
        ON UPDATE CASCADE;
    END IF;
END $$;
