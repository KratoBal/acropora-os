-- Research & Knowledge Engine S5 (stage pilot, Balazs 2026-10-23 11:51 UTC): own
-- conclusions on VERIFIED claims, and an article's sentences cited to a claim, a
-- conclusion, or marked as not technical. Additive only: new types and tables.

-- CreateEnum
CREATE TYPE "KnowledgeConclusionStatus" AS ENUM ('DRAFT', 'APPROVED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ArticleCitationKind" AS ENUM ('CLAIM', 'CONCLUSION', 'NOT_TECHNICAL');

-- CreateTable
CREATE TABLE "KnowledgeConclusion" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "reasoning" TEXT NOT NULL,
    "status" "KnowledgeConclusionStatus" NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "withdrawnReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeConclusion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeConclusionClaim" (
    "conclusionId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,

    CONSTRAINT "KnowledgeConclusionClaim_pkey" PRIMARY KEY ("conclusionId","claimId")
);

-- CreateTable
CREATE TABLE "ArticleCitation" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "sentence" TEXT NOT NULL,
    "sentenceHash" VARCHAR(64) NOT NULL,
    "kind" "ArticleCitationKind" NOT NULL,
    "claimId" TEXT,
    "conclusionId" TEXT,
    "targetKey" TEXT NOT NULL,
    "reason" TEXT,
    "answeredCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "answerReason" TEXT,
    "answeredById" TEXT,
    "answeredAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArticleCitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeConclusion_status_idx" ON "KnowledgeConclusion"("status");

-- CreateIndex
CREATE INDEX "KnowledgeConclusionClaim_claimId_idx" ON "KnowledgeConclusionClaim"("claimId");

-- CreateIndex
CREATE INDEX "ArticleCitation_claimId_idx" ON "ArticleCitation"("claimId");

-- CreateIndex
CREATE INDEX "ArticleCitation_conclusionId_idx" ON "ArticleCitation"("conclusionId");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleCitation_contentId_sentenceHash_targetKey_key" ON "ArticleCitation"("contentId", "sentenceHash", "targetKey");

-- AddForeignKey
ALTER TABLE "KnowledgeConclusion" ADD CONSTRAINT "KnowledgeConclusion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeConclusion" ADD CONSTRAINT "KnowledgeConclusion_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeConclusionClaim" ADD CONSTRAINT "KnowledgeConclusionClaim_conclusionId_fkey" FOREIGN KEY ("conclusionId") REFERENCES "KnowledgeConclusion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeConclusionClaim" ADD CONSTRAINT "KnowledgeConclusionClaim_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "KnowledgeClaim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleCitation" ADD CONSTRAINT "ArticleCitation_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ArticleBody"("contentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleCitation" ADD CONSTRAINT "ArticleCitation_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "KnowledgeClaim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleCitation" ADD CONSTRAINT "ArticleCitation_conclusionId_fkey" FOREIGN KEY ("conclusionId") REFERENCES "KnowledgeConclusion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleCitation" ADD CONSTRAINT "ArticleCitation_answeredById_fkey" FOREIGN KEY ("answeredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleCitation" ADD CONSTRAINT "ArticleCitation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A citation has exactly the target its kind names, a NOT_TECHNICAL mark
-- carries its reason, and the unique key follows the target: a row that names
-- two targets, or none, cannot exist.
ALTER TABLE "ArticleCitation" ADD CONSTRAINT "ArticleCitation_target_by_kind"
  CHECK (
    ("kind" = 'CLAIM' AND "claimId" IS NOT NULL AND "conclusionId" IS NULL
        AND "reason" IS NULL AND "targetKey" = "claimId")
    OR ("kind" = 'CONCLUSION' AND "conclusionId" IS NOT NULL AND "claimId" IS NULL
        AND "reason" IS NULL AND "targetKey" = "conclusionId")
    OR ("kind" = 'NOT_TECHNICAL' AND "claimId" IS NULL AND "conclusionId" IS NULL
        AND "reason" IS NOT NULL AND btrim("reason") <> '' AND "targetKey" = 'NOT_TECHNICAL')
  );

-- An approved conclusion names who approved it and when; a draft has neither.
-- A withdrawn one keeps them when it had been approved.
ALTER TABLE "KnowledgeConclusion" ADD CONSTRAINT "KnowledgeConclusion_approval_recorded"
  CHECK (
    ("status" = 'DRAFT' AND "approvedById" IS NULL AND "approvedAt" IS NULL)
    OR ("status" = 'APPROVED' AND "approvedById" IS NOT NULL AND "approvedAt" IS NOT NULL)
    OR "status" = 'WITHDRAWN'
  );
