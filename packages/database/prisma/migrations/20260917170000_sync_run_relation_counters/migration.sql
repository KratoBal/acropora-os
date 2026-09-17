-- A kapcsolat-szamlalok a FUTAS SORABA kerulnek, hogy tulelejek a naplot.
--
-- A naplo a kontener indulasakor kezdodik (merve 2026-09-15), tehat egy
-- ujratelepites utan a tegnapi futas vesztesege mar sehol nincs meg -- es pont
-- az a kerdes, ami masnap merul fel.
--
-- MIND A NEGY OSZLOP NOT NULL, DEFAULT 0: a mar meglevo sorok igy nem kapnak
-- NULL erteket, amit egy osszegzes csendben kihagyna. A nulla itt IGAZ is: a
-- regi futasokrol nem tudjuk, mennyit irtak, es a nulla azt mondja, hogy nem
-- tudunk rola szamot -- nem azt, hogy volt es elveszett.
ALTER TABLE "UnasProductSyncRun"
  ADD COLUMN "similarRelationsWritten" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "similarReferencesUnresolved" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "accessoryRelationsWritten" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "accessoryReferencesUnresolved" INTEGER NOT NULL DEFAULT 0;
