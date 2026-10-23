-- Kutatasi tudastar, S1 szelet (Research & Knowledge Engine, terv v4 6. es 7a. pont;
-- Balazs jovahagyasa 2026-10-23 11:51 UTC, Discord 1563157803726798859, csak stage).
--
-- Csak UJ enumok es UJ tablak, ures tablakkal: meglevo tablahoz nem nyul, adatmozgas
-- es backfill nincs, tehat visszafele kompatibilis. Az egyetlen erintett meglevo modell
-- a User, de az csak Prisma-oldali visszahivatkozas, oszlopa nem valtozik.
--
-- Visszaallitas: a kilenc tabla es a tizenhat enum eldobasa (DROP TABLE ... ; DROP TYPE
-- ...), mert semmi mas nem hivatkozik rajuk.

-- CreateEnum
CREATE TYPE "KnowledgeSourceKind" AS ENUM ('PEER_REVIEWED', 'PREPRINT', 'REVIEW', 'BOOK', 'MANUFACTURER', 'HOBBY_ARTICLE', 'FORUM', 'OWN_DATA');

-- CreateEnum
CREATE TYPE "KnowledgeStudyType" AS ENUM ('CONTROLLED_LAB', 'MESOCOSM', 'FIELD_EXPERIMENT', 'FIELD_OBSERVATIONAL', 'AQUARIUM_CASE', 'AQUARIUM_SURVEY', 'REVIEW', 'META_ANALYSIS', 'MANUFACTURER', 'OWN_MEASUREMENT');

-- CreateEnum
CREATE TYPE "KnowledgeMeasurementMethod" AS ENUM ('COLORIMETRIC_KIT', 'PHOTOMETER', 'LAB_SPECTROPHOTOMETRY', 'AUTOANALYZER', 'ICP_OES', 'ICP_MS', 'ION_CHROMATOGRAPHY', 'OTHER', 'NOT_REPORTED');

-- CreateEnum
CREATE TYPE "KnowledgeSourceVersionKind" AS ENUM ('ORIGINAL', 'CORRECTION', 'ERRATUM', 'RETRACTION', 'EXPRESSION_OF_CONCERN', 'UPDATE');

-- CreateEnum
CREATE TYPE "KnowledgeClaimLayer" AS ENUM ('SCIENTIFIC', 'HOBBY_EXPERIENCE', 'MANUFACTURER', 'OWN_CONCLUSION');

-- CreateEnum
CREATE TYPE "KnowledgeClaimStatus" AS ENUM ('CANDIDATE', 'VERIFIED', 'DISPUTED', 'WITHDRAWN', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "KnowledgeChemicalBasis" AS ENUM ('PO4', 'P');

-- CreateEnum
CREATE TYPE "KnowledgeEffectDirection" AS ENUM ('INCREASE', 'DECREASE', 'NONE');

-- CreateEnum
CREATE TYPE "KnowledgeEvidenceStance" AS ENUM ('SUPPORTS', 'CONTRADICTS', 'QUALIFIES');

-- CreateEnum
CREATE TYPE "KnowledgeClaimRelationKind" AS ENUM ('CONTRADICTS', 'REFINES', 'GENERALIZES', 'DEPENDS_ON');

-- CreateEnum
CREATE TYPE "KnowledgeEnvironment" AS ENUM ('FIELD', 'LAB', 'MESOCOSM', 'HOME_AQUARIUM', 'PUBLIC_AQUARIUM');

-- CreateEnum
CREATE TYPE "KnowledgeApplicability" AS ENUM ('DIRECT', 'ANALOGOUS', 'LIMITED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "KnowledgeAnchorDecision" AS ENUM ('PENDING', 'ACCEPTED', 'CORRECTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "KnowledgeVocabularyKind" AS ENUM ('TAXON', 'ENVIRONMENT', 'EFFECT', 'DIRECTION_VERB', 'NEGATION', 'CERTAINTY', 'SCOPE_PHRASE', 'UNSUPPORTED_CONSTRUCTION', 'UNIT');

-- CreateEnum
CREATE TYPE "KnowledgeVocabularyStatus" AS ENUM ('DRAFT', 'APPROVED', 'RETIRED');

-- CreateEnum
CREATE TYPE "KnowledgeResearchDraftStatus" AS ENUM ('DRAFT');

-- CreateTable
CREATE TABLE "KnowledgeSource" (
    "id" TEXT NOT NULL,
    "kind" "KnowledgeSourceKind" NOT NULL,
    "doi" VARCHAR(255),
    "openalexId" VARCHAR(64),
    "pmid" VARCHAR(32),
    "pmcid" VARCHAR(32),
    "s2Id" VARCHAR(64),
    "url" TEXT,
    "title" TEXT NOT NULL,
    "authors" JSONB NOT NULL DEFAULT '[]',
    "year" INTEGER,
    "venue" TEXT,
    "license" VARCHAR(32) NOT NULL DEFAULT 'UNKNOWN',
    "oaUrl" TEXT,
    "discoveredVia" VARCHAR(32) NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "studyType" "KnowledgeStudyType",
    "controlled" BOOLEAN,
    "controlDescription" TEXT,
    "measurementMethod" "KnowledgeMeasurementMethod",
    "measurementMethodDetail" TEXT,
    "limitations" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeSourceVersion" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "versionKind" "KnowledgeSourceVersionKind" NOT NULL,
    "relatedDoi" VARCHAR(255),
    "noticeDate" TIMESTAMP(3),
    "detectedVia" VARCHAR(32) NOT NULL,
    "contentHash" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeSourceVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgePassage" (
    "id" TEXT NOT NULL,
    "sourceVersionId" TEXT NOT NULL,
    "locator" VARCHAR(128) NOT NULL,
    "text" TEXT NOT NULL,
    "textHash" VARCHAR(64) NOT NULL,
    "verifiedVerbatimAt" TIMESTAMP(3),
    "extractedBy" VARCHAR(128),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgePassage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeClaim" (
    "id" TEXT NOT NULL,
    "layer" "KnowledgeClaimLayer" NOT NULL,
    "subject" VARCHAR(48) NOT NULL,
    "population" TEXT,
    "originalMin" DECIMAL(18,9),
    "originalMax" DECIMAL(18,9),
    "originalUnit" VARCHAR(16),
    "chemicalBasis" "KnowledgeChemicalBasis",
    "normalizedMinMgL" DECIMAL(18,9),
    "normalizedMaxMgL" DECIMAL(18,9),
    "conditions" JSONB NOT NULL DEFAULT '{}',
    "effect" VARCHAR(48),
    "direction" "KnowledgeEffectDirection",
    "status" "KnowledgeClaimStatus" NOT NULL DEFAULT 'CANDIDATE',
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeClaimEvidence" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "passageId" TEXT NOT NULL,
    "stance" "KnowledgeEvidenceStance" NOT NULL,
    "note" TEXT,
    "sampleSize" INTEGER,
    "sampleUnit" VARCHAR(32),
    "uncertainty" TEXT,
    "species" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "environment" "KnowledgeEnvironment",
    "conditions" JSONB NOT NULL DEFAULT '{}',
    "homeReefApplicability" "KnowledgeApplicability",
    "applicabilityReason" TEXT,
    "applicabilityDecidedById" TEXT,
    "applicabilityDecidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeClaimEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeClaimRelation" (
    "id" TEXT NOT NULL,
    "fromClaimId" TEXT NOT NULL,
    "toClaimId" TEXT NOT NULL,
    "kind" "KnowledgeClaimRelationKind" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeClaimRelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeFieldAnchor" (
    "id" TEXT NOT NULL,
    "claimEvidenceId" TEXT,
    "sourceId" TEXT,
    "field" VARCHAR(48) NOT NULL,
    "passageId" TEXT NOT NULL,
    "normalizedValue" TEXT,
    "decision" "KnowledgeAnchorDecision" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeFieldAnchor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeVocabularyEntry" (
    "id" TEXT NOT NULL,
    "kind" "KnowledgeVocabularyKind" NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "forms" TEXT[],
    "exactMatch" BOOLEAN NOT NULL DEFAULT false,
    "parentKey" VARCHAR(64),
    "rank" VARCHAR(32),
    "note" TEXT,
    "status" "KnowledgeVocabularyStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeVocabularyEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeResearchDraft" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "sources" JSONB NOT NULL DEFAULT '[]',
    "candidateClaims" JSONB NOT NULL DEFAULT '[]',
    "summary" TEXT NOT NULL,
    "summaryModel" VARCHAR(128) NOT NULL,
    "status" "KnowledgeResearchDraftStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeResearchDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeSource_doi_key" ON "KnowledgeSource"("doi");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeSource_openalexId_key" ON "KnowledgeSource"("openalexId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeSource_pmid_key" ON "KnowledgeSource"("pmid");

-- CreateIndex
CREATE INDEX "KnowledgeSource_kind_idx" ON "KnowledgeSource"("kind");

-- CreateIndex
CREATE INDEX "KnowledgeSourceVersion_sourceId_idx" ON "KnowledgeSourceVersion"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgePassage_sourceVersionId_locator_textHash_key" ON "KnowledgePassage"("sourceVersionId", "locator", "textHash");

-- CreateIndex
CREATE INDEX "KnowledgeClaim_subject_status_idx" ON "KnowledgeClaim"("subject", "status");

-- CreateIndex
CREATE INDEX "KnowledgeClaimEvidence_passageId_idx" ON "KnowledgeClaimEvidence"("passageId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeClaimEvidence_claimId_passageId_key" ON "KnowledgeClaimEvidence"("claimId", "passageId");

-- CreateIndex
CREATE INDEX "KnowledgeClaimRelation_toClaimId_idx" ON "KnowledgeClaimRelation"("toClaimId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeClaimRelation_fromClaimId_toClaimId_kind_key" ON "KnowledgeClaimRelation"("fromClaimId", "toClaimId", "kind");

-- CreateIndex
CREATE INDEX "KnowledgeFieldAnchor_claimEvidenceId_idx" ON "KnowledgeFieldAnchor"("claimEvidenceId");

-- CreateIndex
CREATE INDEX "KnowledgeFieldAnchor_sourceId_idx" ON "KnowledgeFieldAnchor"("sourceId");

-- CreateIndex
CREATE INDEX "KnowledgeFieldAnchor_passageId_idx" ON "KnowledgeFieldAnchor"("passageId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeVocabularyEntry_kind_key_version_key" ON "KnowledgeVocabularyEntry"("kind", "key", "version");

-- CreateIndex
CREATE INDEX "KnowledgeResearchDraft_createdById_idx" ON "KnowledgeResearchDraft"("createdById");

-- AddForeignKey
ALTER TABLE "KnowledgeSourceVersion" ADD CONSTRAINT "KnowledgeSourceVersion_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "KnowledgeSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgePassage" ADD CONSTRAINT "KnowledgePassage_sourceVersionId_fkey" FOREIGN KEY ("sourceVersionId") REFERENCES "KnowledgeSourceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeClaimEvidence" ADD CONSTRAINT "KnowledgeClaimEvidence_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "KnowledgeClaim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeClaimEvidence" ADD CONSTRAINT "KnowledgeClaimEvidence_passageId_fkey" FOREIGN KEY ("passageId") REFERENCES "KnowledgePassage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeClaimEvidence" ADD CONSTRAINT "KnowledgeClaimEvidence_applicabilityDecidedById_fkey" FOREIGN KEY ("applicabilityDecidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeClaimRelation" ADD CONSTRAINT "KnowledgeClaimRelation_fromClaimId_fkey" FOREIGN KEY ("fromClaimId") REFERENCES "KnowledgeClaim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeClaimRelation" ADD CONSTRAINT "KnowledgeClaimRelation_toClaimId_fkey" FOREIGN KEY ("toClaimId") REFERENCES "KnowledgeClaim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeFieldAnchor" ADD CONSTRAINT "KnowledgeFieldAnchor_claimEvidenceId_fkey" FOREIGN KEY ("claimEvidenceId") REFERENCES "KnowledgeClaimEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeFieldAnchor" ADD CONSTRAINT "KnowledgeFieldAnchor_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "KnowledgeSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeFieldAnchor" ADD CONSTRAINT "KnowledgeFieldAnchor_passageId_fkey" FOREIGN KEY ("passageId") REFERENCES "KnowledgePassage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeFieldAnchor" ADD CONSTRAINT "KnowledgeFieldAnchor_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeVocabularyEntry" ADD CONSTRAINT "KnowledgeVocabularyEntry_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeResearchDraft" ADD CONSTRAINT "KnowledgeResearchDraft_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A Prisma ezeket nem modellezi, ezert kezzel. A DOI kisbetus, hogy a duplikatum-szures
-- betuere menjen (a nagybetus DOI ugyanaz a mu).
ALTER TABLE "KnowledgeSource" ADD CONSTRAINT "KnowledgeSource_doi_lowercase"
  CHECK ("doi" IS NULL OR "doi" = lower("doi"));

-- Egy tartomany also hatara nem lehet a felso folott, es egy ertek egyseg nelkul nem ertek.
ALTER TABLE "KnowledgeClaim" ADD CONSTRAINT "KnowledgeClaim_original_range"
  CHECK ("originalMin" IS NULL OR "originalMax" IS NULL OR "originalMin" <= "originalMax");
ALTER TABLE "KnowledgeClaim" ADD CONSTRAINT "KnowledgeClaim_normalized_range"
  CHECK ("normalizedMinMgL" IS NULL OR "normalizedMaxMgL" IS NULL OR "normalizedMinMgL" <= "normalizedMaxMgL");
ALTER TABLE "KnowledgeClaim" ADD CONSTRAINT "KnowledgeClaim_value_has_unit"
  CHECK (("originalMin" IS NULL AND "originalMax" IS NULL) OR "originalUnit" IS NOT NULL);

-- Egy allitas nem allhat kapcsolatban sajat magaval.
ALTER TABLE "KnowledgeClaimRelation" ADD CONSTRAINT "KnowledgeClaimRelation_not_self"
  CHECK ("fromClaimId" <> "toClaimId");

-- A horgony pontosan egy helyre tartozik: egy bizonyitekhoz vagy egy forrashoz.
ALTER TABLE "KnowledgeFieldAnchor" ADD CONSTRAINT "KnowledgeFieldAnchor_one_owner"
  CHECK (num_nonnulls("claimEvidenceId", "sourceId") = 1);
