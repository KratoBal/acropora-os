-- Elhullási napló, 2026-10-07 (Balázs): az élőlény és a beszállító szabad
-- szöveggel is megadható, és a rendszerbeli élőlény levonódik a készletből.
-- Csak hozzáad és lazít: meglévő sor nem sérül (mind a régi szabálynak felel meg).

-- A készletmozgás UNAS-kimenetének forrása.
ALTER TYPE "UnasStockSyncSourceProcess" ADD VALUE 'MORTALITY';

-- Az élőlény: rendszerbeli termék VAGY szabad szöveg, pontosan az egyik.
ALTER TABLE "MortalityRecord" ALTER COLUMN "productId" DROP NOT NULL;
ALTER TABLE "MortalityRecord" ADD COLUMN "productName" VARCHAR(200);
ALTER TABLE "MortalityRecord" ADD CONSTRAINT "MortalityRecord_product_check" CHECK (
  ("productId" IS NOT NULL AND "productName" IS NULL)
  OR ("productId" IS NULL AND length(btrim(coalesce("productName", ''))) > 0)
);

-- A beszállító: beszállítói forrásnál a rendszerbeli beszállító VAGY a
-- megnevezés szabad szövege, pontosan az egyik; más forrásnál nincs beszállító.
ALTER TABLE "MortalityRecord" DROP CONSTRAINT "MortalityRecord_supplier_check";
ALTER TABLE "MortalityRecord" ADD CONSTRAINT "MortalityRecord_supplier_check" CHECK (
  ("sourceType" = 'SUPPLIER' AND (
    ("supplierId" IS NOT NULL AND "sourceNote" IS NULL)
    OR ("supplierId" IS NULL AND length(btrim(coalesce("sourceNote", ''))) > 0)
  ))
  OR ("sourceType" <> 'SUPPLIER' AND "supplierId" IS NULL)
);
