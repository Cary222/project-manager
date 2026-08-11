-- AddWorkflowConversationLink
-- Add conversationId field to WorkflowRun table to link workflows to conversations

-- Step 1: Add the conversationId column (nullable)
ALTER TABLE "pm"."WorkflowRun" ADD COLUMN "conversationId" TEXT;

-- Step 2: Create index for conversationId
CREATE INDEX "WorkflowRun_conversationId_idx" ON "pm"."WorkflowRun"("conversationId");

-- Step 3: Add foreign key constraint with SET NULL on delete
ALTER TABLE "pm"."WorkflowRun" 
ADD CONSTRAINT "WorkflowRun_conversationId_fkey" 
FOREIGN KEY ("conversationId") 
REFERENCES "pm"."AiConversation"("id") 
ON DELETE SET NULL 
ON UPDATE CASCADE;
