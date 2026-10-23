-- Kutatasi tudastar, S4 Forrasszures: a szerkeszto szuresi dontese a forrason (terv v4,
-- 7. pont 3. lepes; a szerkesztoi felulet leirasa; Balazs jovahagyasa a stage pilotra
-- 2026-10-23, Discord 1563157803726798859; a feluletet 15:56 UTC-kor kerte, acrobot 35682).
--
-- Ket UJ enum, a KnowledgeSource ot UJ oszlopa (egy NOT NULL DEFAULT 'PENDING', a tobbi
-- nullazhato), index es idegen kulcs. A meglevo sorok PENDING-et kapnak: dontesre varnak.
-- Visszafele kompatibilis.
--
-- Visszaallitas: a harom CHECK, az index es az idegen kulcs eldobasa, majd
-- ALTER TABLE "KnowledgeSource" DROP COLUMN "screeningStatus", DROP COLUMN "exclusionReason",
-- DROP COLUMN "screeningNote", DROP COLUMN "screenedById", DROP COLUMN "screenedAt";
-- DROP TYPE "KnowledgeScreeningStatus"; DROP TYPE "KnowledgeExclusionReason";

-- CreateEnum
CREATE TYPE "KnowledgeScreeningStatus" AS ENUM ('PENDING', 'INCLUDED', 'EXCLUDED');

-- CreateEnum
CREATE TYPE "KnowledgeExclusionReason" AS ENUM ('NOT_MARINE', 'NOT_CORAL', 'NOT_RELEVANT', 'DUPLICATE', 'OTHER');

-- AlterTable
ALTER TABLE "KnowledgeSource" ADD COLUMN     "exclusionReason" "KnowledgeExclusionReason",
ADD COLUMN     "screenedAt" TIMESTAMP(3),
ADD COLUMN     "screenedById" TEXT,
ADD COLUMN     "screeningNote" VARCHAR(500),
ADD COLUMN     "screeningStatus" "KnowledgeScreeningStatus" NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "KnowledgeSource_screeningStatus_idx" ON "KnowledgeSource"("screeningStatus");

-- AddForeignKey
ALTER TABLE "KnowledgeSource" ADD CONSTRAINT "KnowledgeSource_screenedById_fkey" FOREIGN KEY ("screenedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Kizarashoz ok kell, mashoz ok nem allhat.
ALTER TABLE "KnowledgeSource" ADD CONSTRAINT "KnowledgeSource_exclusion_reason"
  CHECK (("screeningStatus" = 'EXCLUDED') = ("exclusionReason" IS NOT NULL));

-- Az "egyeb" ok csak megjegyzessel all.
ALTER TABLE "KnowledgeSource" ADD CONSTRAINT "KnowledgeSource_other_has_note"
  CHECK ("exclusionReason" IS DISTINCT FROM 'OTHER' OR length(trim(coalesce("screeningNote", ''))) > 0);

-- Egy dontesnek van gazdaja es ideje; a dontesre varo sornak nincs.
ALTER TABLE "KnowledgeSource" ADD CONSTRAINT "KnowledgeSource_screening_decided"
  CHECK (("screeningStatus" = 'PENDING') = ("screenedById" IS NULL AND "screenedAt" IS NULL));
