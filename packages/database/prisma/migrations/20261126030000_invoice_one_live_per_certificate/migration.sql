-- SZTORNÓ UTÁN ÚJ SZÁMLA UGYANARRA A TELJESÍTÉSI IGAZOLÁSRA (acrobot döntése,
-- 2026-11-26, 62227): a teljesítés nem változott, csak a számla volt hibás; új
-- igazolást aláíratni értelmetlen, a számviteli rend a sztornó + új számla.
--
-- Az igazolásonkénti egyediség ezért csak az ÉLŐ (fel nem váltott) számlára
-- áll. A felváltást az új piszkozat létrehozása írja (`supersededAt`), ugyanabban
-- a tranzakcióban, miután a szolgáltatás a sztornót látta (két jel: egy
-- kiállított STORNO sor, vagy a Számlázz.hu-oldali sztornózott iker; egyik sem
-- az eredeti számla során áll, ezért nem az index dönt a sztornóról, hanem a
-- szolgáltatás). Az index a versenyt fogja: két egyidejű kérésből egy élő számla
-- marad. Részleges index, ezért nem a sémában áll (a Prisma nem írja le); a
-- sémában az `Invoice.completionCertificateId` kommentje mutat ide.
--
-- A meglévő sorok: igazolásonként ma legfeljebb egy van (a régi teljes egyedi
-- kulcs tartotta), mind élő (`supersededAt` NULL), tehát az új index az összes
-- meglévő soron azonnal teljesül.

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "supersededAt" TIMESTAMP(3);

-- the live-invoice uniqueness first, then the old full one goes: no moment without a guard
CREATE UNIQUE INDEX "Invoice_one_live_invoice_per_certificate"
  ON "Invoice" ("completionCertificateId")
  WHERE "completionCertificateId" IS NOT NULL AND "supersededAt" IS NULL;

-- DropIndex
DROP INDEX "Invoice_completionCertificateId_key";

-- CreateIndex
CREATE INDEX "Invoice_completionCertificateId_idx" ON "Invoice"("completionCertificateId");
