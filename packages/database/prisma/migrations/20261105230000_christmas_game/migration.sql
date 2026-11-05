-- A KARÁCSONYI NYEREMÉNYJÁTÉK (kártya 31445d0f; Balázs, 2026-11-05): heti kérdés, beküldés, sorsolás. Három új, üres
-- tábla, meglévő sort nem érint. ROLLBACK: DROP TABLE "GameDraw", "GameEntry", "GameQuestion";

-- CreateTable
CREATE TABLE "GameQuestion" (
    "id" TEXT NOT NULL,
    "week" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "options" JSONB NOT NULL DEFAULT '[]',
    "acceptedAnswers" JSONB NOT NULL DEFAULT '[]',
    "opensAt" TIMESTAMP(3) NOT NULL,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameEntry" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "autoCorrect" BOOLEAN NOT NULL,
    "manualCorrect" BOOLEAN,
    "manualById" TEXT,
    "manualAt" TIMESTAMP(3),
    "confirmTokenHash" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameDraw" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "questionId" TEXT,
    "seed" TEXT NOT NULL,
    "candidates" JSONB NOT NULL,
    "winnerEmail" TEXT,
    "ticket" INTEGER,
    "tickets" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameDraw_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GameQuestion_week_key" ON "GameQuestion"("week");

-- CreateIndex
CREATE INDEX "GameQuestion_opensAt_idx" ON "GameQuestion"("opensAt");

-- CreateIndex
CREATE UNIQUE INDEX "GameEntry_confirmTokenHash_key" ON "GameEntry"("confirmTokenHash");

-- CreateIndex
CREATE INDEX "GameEntry_questionId_confirmedAt_idx" ON "GameEntry"("questionId", "confirmedAt");

-- CreateIndex
CREATE UNIQUE INDEX "GameEntry_questionId_email_key" ON "GameEntry"("questionId", "email");

-- CreateIndex
CREATE INDEX "GameDraw_kind_createdAt_idx" ON "GameDraw"("kind", "createdAt");

-- AddForeignKey
ALTER TABLE "GameEntry" ADD CONSTRAINT "GameEntry_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "GameQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameDraw" ADD CONSTRAINT "GameDraw_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "GameQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

