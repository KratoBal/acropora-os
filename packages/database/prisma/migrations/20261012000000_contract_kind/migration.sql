-- A szerződés fajtája (hétfői lista M4): karbantartási vagy beszerzési.
-- A meglévő szerződések mind karbantartásiak (DEFAULT). A beszerzési tételnek
-- nincs alkalma, viszont mennyiségi egysége van; a kötelezőséget a szolgáltatás
-- ellenőrzi fajtánként, mert az adatbázis nem látja a szülő fajtáját.

-- CreateEnum
CREATE TYPE "ContractKind" AS ENUM ('MAINTENANCE', 'PURCHASE');

-- AlterTable
ALTER TABLE "Contract" ADD COLUMN     "kind" "ContractKind" NOT NULL DEFAULT 'MAINTENANCE';

-- AlterTable
ALTER TABLE "ContractItem" ADD COLUMN     "unitOfMeasureId" TEXT,
ALTER COLUMN "occasionsPerYear" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "ContractItem_unitOfMeasureId_idx" ON "ContractItem"("unitOfMeasureId");

-- AddForeignKey
ALTER TABLE "ContractItem" ADD CONSTRAINT "ContractItem_unitOfMeasureId_fkey" FOREIGN KEY ("unitOfMeasureId") REFERENCES "UnitOfMeasure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

