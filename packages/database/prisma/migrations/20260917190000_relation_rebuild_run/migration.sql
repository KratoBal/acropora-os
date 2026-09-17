-- A kapcsolat-ujraepites futasainak naploja.
--
-- MIERT SAJAT TABLA: a szam, ami csak a kimeneten all, egy ujratelepites utan
-- sehol nincs meg -- ezt ugyanebben a temaban mar megmertuk (#796). Egy napi
-- futasnal az egyetlen kerdes, amit fel fognak tenni, az az, hogy mi tortent a
-- kapcsolatokkal az elmult ket hetben; erre csak egy lekerdezheto sor tud
-- valaszolni.
--
-- A SOR AKKOR IS LETREJON, HA A FUTAS MEGALLT a nagy valtozas hataran: az a
-- legerdekesebb futas, amit rogziteni lehet.
CREATE TABLE "UnasRelationRebuildRun" (
  "id" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "applied" BOOLEAN NOT NULL DEFAULT false,
  "stopped" BOOLEAN NOT NULL DEFAULT false,
  "rowsBefore" INTEGER NOT NULL DEFAULT 0,
  "rowsPlanned" INTEGER NOT NULL DEFAULT 0,
  "similarProductsWithReferences" INTEGER NOT NULL DEFAULT 0,
  "similarRelationsPlanned" INTEGER NOT NULL DEFAULT 0,
  "similarRelationsWritten" INTEGER NOT NULL DEFAULT 0,
  "similarRelationsRemoved" INTEGER NOT NULL DEFAULT 0,
  "similarReferencesUnresolved" INTEGER NOT NULL DEFAULT 0,
  "accessoryProductsWithReferences" INTEGER NOT NULL DEFAULT 0,
  "accessoryRelationsPlanned" INTEGER NOT NULL DEFAULT 0,
  "accessoryRelationsWritten" INTEGER NOT NULL DEFAULT 0,
  "accessoryRelationsRemoved" INTEGER NOT NULL DEFAULT 0,
  "accessoryReferencesUnresolved" INTEGER NOT NULL DEFAULT 0,
  "unreadableSnapshots" INTEGER NOT NULL DEFAULT 0,
  "withoutExternalId" INTEGER NOT NULL DEFAULT 0,
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UnasRelationRebuildRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UnasRelationRebuildRun_startedAt_idx" ON "UnasRelationRebuildRun"("startedAt");
