-- A NYEREMÉNYJÁTÉK: a hét nyereménye és a beküldő neve (kártya 31445d0f; Balázs, 2026-11-06). Csak új, üres (NULL) oszlopok és
-- egy külső kulcs: meglévő sort nem érint, a régi kérdések és beküldések változatlanok.
-- ROLLBACK: ALTER TABLE "GameQuestion" DROP CONSTRAINT "GameQuestion_prizeImageId_fkey";
--   DROP INDEX "GameQuestion_prizeImageId_idx"; ALTER TABLE "GameQuestion" DROP COLUMN "prizeName", DROP COLUMN "prizeDescription",
--   DROP COLUMN "prizeImageId"; ALTER TABLE "GameEntry" DROP COLUMN "name";

-- AlterTable
ALTER TABLE "GameEntry" ADD COLUMN "name" TEXT;

-- AlterTable
ALTER TABLE "GameQuestion" ADD COLUMN "prizeName" TEXT,
ADD COLUMN "prizeDescription" TEXT,
ADD COLUMN "prizeImageId" TEXT;

-- CreateIndex
CREATE INDEX "GameQuestion_prizeImageId_idx" ON "GameQuestion"("prizeImageId");

-- AddForeignKey
ALTER TABLE "GameQuestion" ADD CONSTRAINT "GameQuestion_prizeImageId_fkey" FOREIGN KEY ("prizeImageId") REFERENCES "MailImage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
