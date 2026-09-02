-- GENERALASI TETELEK A MATRICAKODOKHOZ.
--
-- Amit egy gombnyomas eloallitott, az egy TETEL: mikor keszult es hany kod.
-- A szabad darabszamot NEM taroljuk -- azt a matricak allapotabol szamoljuk
-- (`assetId IS NULL`). A reszletes indoklas a semaban all, a modell folott.

-- AlterTable
ALTER TABLE "AssetLabel" ADD COLUMN     "batchId" TEXT;

-- CreateTable
CREATE TABLE "AssetLabelBatch" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestedCount" INTEGER NOT NULL,

    CONSTRAINT "AssetLabelBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
--
-- A LISTA IDOREND SZERINT KERDEZ, es a legfrissebb elol. Enelkul a tabla
-- teljes bejarasa adna a valaszt, ami ma harom soron olcso, egy ev mulva nem.
CREATE INDEX "AssetLabelBatch_createdAt_idx" ON "AssetLabelBatch"("createdAt");

-- AddForeignKey
--
-- SET NULL, nem CASCADE: egy tetel torlese NEM semmisitheti meg a matricakat.
-- Azok fizikailag ki vannak nyomtatva, es lehet, hogy mar eszkozon allnak. A
-- kapcsolat elveszik, a kod megmarad.
ALTER TABLE "AssetLabel" ADD CONSTRAINT "AssetLabel_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "AssetLabelBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
