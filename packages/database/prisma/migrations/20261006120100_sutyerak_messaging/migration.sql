-- Sutyerák az Üzenetekben (4. pont B, Balázs döntése 2026-10-06 08:06 UTC).

-- Sutyerák üzenete: honnan jött a válasz (az átjáró, vagy acrobot visszaírása).
ALTER TABLE "Message" ADD COLUMN "assistantSource" TEXT;
ALTER TABLE "Message" ADD CONSTRAINT "Message_assistantSource_check"
  CHECK ("assistantSource" IS NULL OR "assistantSource" IN ('GATEWAY', 'ACROBOT'));

-- Az átjáró szála beszélgetésenként és kérdezőnként.
CREATE TABLE "AssistantConversationThread" (
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssistantConversationThread_pkey" PRIMARY KEY ("conversationId","userId")
);
ALTER TABLE "AssistantConversationThread" ADD CONSTRAINT "AssistantConversationThread_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssistantConversationThread" ADD CONSTRAINT "AssistantConversationThread_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A rendszer-felhasználó: jelszó nélkül (a jelszavas belépés jelszó-hash nélkül
-- mindig elutasít), nem létező tartományú címmel, csak az Üzenetek jogával.
INSERT INTO "User" ("id", "email", "displayName", "firstName", "lastName", "role", "isActive", "createdAt", "updatedAt")
VALUES ('system-sutyerak', 'sutyerak@system.acropora.invalid', 'Sutyerák', 'Sutyerák', '', 'ASSISTANT', true, NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;
