-- Az Akváriumok menü első köre. Balázs kérése, 2026-09-24 (Discord,
-- "Akváriumok menüpont" szál): akvárium/tó rögzítése méretekkel (a literes
-- térfogat a méretekből számolódik, de kézzel is felülírható), víztípus,
-- indítás dátuma, megjegyzés, és a felszerelt berendezések listája.
--
-- A migráció KIZÁRÓLAG HOZZÁAD: az élesben ma 0 soros Aquarium táblán öt
-- nullázható/alapértelmezett oszlop, plusz egy új, önálló tábla
-- (AquariumEquipment) a berendezéseknek -- meglévő sort egyik művelet sem
-- érint.
--
-- A berendezés SZÁNDÉKOSAN NEM az Asset táblába kerül: az Asset a
-- szervizelt eszközök nyilvántartása (partner belső kódja, QR-matrica,
-- kötelező helyszín), egy ügyfél otthoni akváriumának lámpája nem az, amíg
-- szervizbe nem kerül -- akkor a már meglévő Asset.aquariumId köti össze
-- őket.

-- CreateEnum
CREATE TYPE "WaterBodyType" AS ENUM ('AKVARIUM', 'TO');

-- CreateEnum
CREATE TYPE "WaterType" AS ENUM ('EDESVIZI', 'TENGERI');

-- CreateEnum
CREATE TYPE "AquariumEquipmentKind" AS ENUM ('VILAGITAS', 'ARAMOLTATAS', 'LEHABZO', 'FELNYOMO', 'BIO_SZURES', 'MEDIA_REAKTOR', 'NYOMELEM_ADAGOLO', 'FUTES', 'HUTES', 'EGYEB');

-- AlterTable
ALTER TABLE "Aquarium" ADD COLUMN     "notes" TEXT,
ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "systemVolumeIsManual" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "waterBodyType" "WaterBodyType" NOT NULL DEFAULT 'AKVARIUM',
ADD COLUMN     "waterType" "WaterType";

-- CreateTable
CREATE TABLE "AquariumEquipment" (
    "id" TEXT NOT NULL,
    "aquariumId" TEXT NOT NULL,
    "kind" "AquariumEquipmentKind" NOT NULL,
    "manufacturer" TEXT,
    "model" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "channelCount" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AquariumEquipment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AquariumEquipment_aquariumId_idx" ON "AquariumEquipment"("aquariumId");

-- AddForeignKey
ALTER TABLE "AquariumEquipment" ADD CONSTRAINT "AquariumEquipment_aquariumId_fkey" FOREIGN KEY ("aquariumId") REFERENCES "Aquarium"("id") ON DELETE CASCADE ON UPDATE CASCADE;
