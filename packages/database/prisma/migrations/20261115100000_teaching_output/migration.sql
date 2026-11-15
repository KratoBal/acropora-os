-- T5.2 slice 2b: a generated output of a teaching source, from one approved
-- source version, with where and when it went out.

-- CreateEnum
CREATE TYPE "TeachingOutputKind" AS ENUM ('PRINTABLE', 'SLIDES', 'NARRATION');

-- CreateTable
CREATE TABLE "TeachingOutput" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "kind" "TeachingOutputKind" NOT NULL,
    "sourceVersion" INTEGER NOT NULL,
    "body" JSONB NOT NULL,
    "generatedById" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentTo" TEXT,
    "sentPublic" BOOLEAN,
    "sentById" TEXT,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "TeachingOutput_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeachingOutput_contentId_kind_generatedAt_idx" ON "TeachingOutput"("contentId", "kind", "generatedAt");

-- AddForeignKey
ALTER TABLE "TeachingOutput" ADD CONSTRAINT "TeachingOutput_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "TeachingSource"("contentId") ON DELETE CASCADE ON UPDATE CASCADE;

