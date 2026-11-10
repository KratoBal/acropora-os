-- CreateEnum
CREATE TYPE "HusbandryZone" AS ENUM ('ALSO', 'KOZEPSO', 'FELSO');

-- CreateEnum
CREATE TYPE "AnimalSourcing" AS ENUM ('TENYESZTETT', 'VADFOGAS');

-- AlterEnum
ALTER TYPE "CareDifficulty" ADD VALUE 'SZAKERTO';

-- AlterTable
ALTER TABLE "ProductDatasheet" ADD COLUMN     "elhelyezesZona" "HusbandryZone",
ADD COLUMN     "ellenorizteUserId" TEXT,
ADD COLUMN     "ellenorizveAt" TIMESTAMP(3),
ADD COLUMN     "eloEleseg" BOOLEAN,
ADD COLUMN     "etetesGyakorisag" TEXT,
ADD COLUMN     "forrasHivatkozas" TEXT,
ADD COLUMN     "forrasTipus" TEXT,
ADD COLUMN     "gerinctelenevo" BOOLEAN,
ADD COLUMN     "kinekNem" TEXT,
ADD COLUMN     "korallevo" BOOLEAN,
ADD COLUMN     "medenceErettsegHonap" INTEGER,
ADD COLUMN     "reefSafeIndok" TEXT,
ADD COLUMN     "szarmazas" "AnimalSourcing";

