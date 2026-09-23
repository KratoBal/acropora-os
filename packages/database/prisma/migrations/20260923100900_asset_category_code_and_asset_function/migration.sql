-- Eszköz-kategória kód mezője, és egy új törzsadat: Eszköz-funkciók.
--
-- Balázs kérése, 2026-09-22 10:01 (Partner eszköz XLS szál), két külön dolog:
--   1. az AssetCategory kapjon egy rövid, nagybetűs KÓD mezőt (a flotta
--      jelmagyarázatából, pl. AIP, CAR, COM, VAL_SUR, VAL_BOT -- tehát NEM
--      kötött 3 karakterhez, és tartalmazhat aláhúzást);
--   2. egy ÚJ, az AssetCategory-val szerkezetileg azonos, de TŐLE FÜGGETLEN
--      törzsadat: AssetFunction ("mire való", szemben a kategóriával, ami azt
--      mondja meg, "mi az eszköz"). A kettő között SZÁNDÉKOSAN nincs kapcsolat.
--
-- === EZ A MIGRÁCIÓ MEGLÉVŐ SORT NEM ÍR ÉS NEM MOZGAT ===
--
-- Kizárólag HOZZÁAD: egy nullázható oszlopot az AssetCategory-n, egy új
-- táblát a két indexével, egy nullázható oszlopot az Asset-en, és az ehhez
-- tartozó idegen kulcsot. A kód-mezők feltöltése és az élő eszköz-kategória
-- migrálása (145 hozzárendelés exportja, a 6 régi kategória cseréje 31 új,
-- kódolt kategóriára) Balázs saját, ezen a migráción KÍVÜLI lépése -- lásd a
-- kanban kártyát (68add892).
--
-- === MIÉRT NULLÁZHATÓ A `code` ===
--
-- A meglévő hat kategórián ma nincs kód, és ennek a migrációnak nem dolga
-- értéket adni nekik (lásd fent). Egy NOT NULL oszlop itt vagy alkalmazhatatlan
-- lenne meglévő soron, vagy kitalált placeholder kellene bele -- egyik sem jó.
--
-- === ELLENŐRZÉS, AMIT EBBEN A KÖRNYEZETBEN NEM LEHETETT ELVÉGEZNI ===
--
-- A `verify-a-migration-without-the-shared-db` recept szerinti szemét-adatbázis
-- lépés (createdb + migrate deploy + kézi megkötés-falszifikálás) itt nem volt
-- elvégezhető: sem a `psql`, sem a `createdb`/`dropdb` parancs nincs telepítve,
-- és a nyers TCP kapcsolat is `ECONNREFUSED`-del utasítja el a 127.0.0.1:5432
-- portot -- nincs elérhető Postgres-példány ebben a fejlesztői környezetben.
-- Ez MÉRT hiány, nem jogosultsági korlát. A migráció DB nélkül,
-- `prisma migrate diff --from-schema-datamodel ... --script` paranccsal lett
-- előállítva a séma két állapota közötti különbségből.
ALTER TABLE "AssetCategory" ADD COLUMN "code" TEXT;
CREATE UNIQUE INDEX "AssetCategory_code_key" ON "AssetCategory"("code");

CREATE TABLE "AssetFunction" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetFunction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AssetFunction_name_key" ON "AssetFunction"("name");
CREATE INDEX "AssetFunction_isActive_sortOrder_idx" ON "AssetFunction"("isActive", "sortOrder");

ALTER TABLE "Asset" ADD COLUMN "functionId" TEXT;
CREATE INDEX "Asset_functionId_idx" ON "Asset"("functionId");

-- `Restrict`, ugyanúgy, mint a kategóriánál: egy funkció, amire eszköz mutat,
-- nem törölhető ki alóla. A kivezetés `isActive`-kal megy.
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_functionId_fkey"
  FOREIGN KEY ("functionId") REFERENCES "AssetFunction"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
