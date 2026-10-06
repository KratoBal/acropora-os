-- The widget conversation an acrobot answer belongs to (5830ee10).
ALTER TABLE "Message" ADD COLUMN "assistantThreadId" TEXT;

CREATE INDEX "Message_assistantThreadId_idx" ON "Message"("assistantThreadId");
