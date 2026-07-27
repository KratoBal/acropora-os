-- Eredetileg "M8.2 kimenő automatikus számlázás" migráció volt (worker
-- állapotgép + lease + snapshot). 2026-07-27: az architektúra-döntés miatt
-- ez a teljes irány elvetésre került - az Acropora OS SOSEM hív
-- createInvoice-t és SOSEM ír vissza a UNAS-ba; a webshop kimenő
-- számlázását a UNAS beépített Számlázz.hu modulja végzi. Ez a fájl ennek
-- megfelelően, még alkalmazás előtt, teljesen átírásra került egy
-- read-only UNAS->Acropora OS számlatükörré - a mappanév (dátum+"m8_2")
-- csak történeti, a tényleges tartalom már nem az eredeti M8.2 munkát
-- tükrözi. Ez a migráció önmagában tartalmazza a korábbi, soha nem
-- alkalmazott 20260726090000/093000/094500/100000 migrációk teljes,
-- idekonszolidált tartalmát is (azok no-op-pá lettek téve, lásd ott a
-- magyarázatot).
--
-- FONTOS (deployment előtti blokkoló ellenőrzés): nincs bizonyíték arra,
-- hogy ez az öt migráció (20260726090000, 20260726093000, 20260726094500,
-- 20260726100000, ez a fájl) bármely környezetben lefutott volna - de ez
-- statikusan, migráció-futtatás nélkül nem igazolható innen. Éles/staging
-- adatbázison való `prisma migrate deploy` előtt kézzel ellenőrizendő a
-- _prisma_migrations tábla, hogy ezek közül egyik sem szerepel-e már ott
-- a korábbi (worker-állapotgépes) tartalommal - ha igen, ez a fájl NEM
-- alkalmazható változtatás nélkül arra a környezetre.

-- CreateEnum: a UNAS saját, dedikált Invoice.Status mezőjének read-only
-- tükrözése (lásd SalesOrder.unasInvoiceStatus doc-comment a schema.prisma-ban).
CREATE TYPE "UnasInvoiceStatus" AS ENUM ('NOT_BILLABLE', 'BILLABLE', 'BILLED');

-- AlterTable: a legacy, sosem használt "invoiceRequested" placeholder
-- (20260721140000_add_pos_sales, default false, alkalmazáskód sosem
-- olvasta/írta - grep-igazolt) végleges eldobása. Nincs mire
-- backfillelni: az új architektúrában nincs helyi "számlázás állapotgép"
-- SalesOrderön, csak a UNAS-oldali állapot read-only tükrözése
-- (unasInvoiceStatus), úgyhogy nincs célmező, ami az invoiceRequested
-- korábbi jelentését átvenné.
ALTER TABLE "SalesOrder"
    DROP COLUMN "invoiceRequested",
    ADD COLUMN "unasInvoiceStatus" "UnasInvoiceStatus",
    ADD COLUMN "buyerTaxNumber" TEXT,
    ADD COLUMN "buyerEuTaxNumber" TEXT,
    ADD COLUMN "buyerCustomerType" TEXT,
    ADD COLUMN "buyerCountryCode" TEXT,
    ADD COLUMN "buyerZip" TEXT,
    ADD COLUMN "buyerCity" TEXT,
    ADD COLUMN "buyerAddress" TEXT;

-- CreateIndex
CREATE INDEX "SalesOrder_unasInvoiceStatus_idx" ON "SalesOrder"("unasInvoiceStatus");

-- AlterTable: kapcsolat a webshop (UNAS) rendeléshez, ha a számla ahhoz
-- tartozik (source=UNAS read-only tükör, vagy egy jövőbeli, Acropora OS
-- által kezdeményezett nem-webshopos számla esetén is felhasználható).
ALTER TABLE "Invoice"
    ADD COLUMN "salesOrderId" TEXT,
    ADD COLUMN "externalUrl" TEXT;

-- AlterTable: a UNAS getOrder API az Order.Invoice alobjektumában csak
-- Status/StatusText/Number/Url mezőt ad (lásd
-- unas.hu/tudastar/api/megrendelesek-adatszerkezet) - sem dátumot, sem
-- összeget. A source=UNAS read-only tükörsorok ezért ezekkel a mezőkkel
-- null lesznek, NEM 0/kitalált dátum - ehhez a NOT NULL megkötést fel
-- kellett oldani. Más forrásoknál (SZAMLAZZ/NAV/MANUAL/IMPORT) ez nem
-- kötelező null-ra állítani, csak megengedetté vált.
ALTER TABLE "Invoice"
    ALTER COLUMN "issueDate" DROP NOT NULL,
    ALTER COLUMN "netAmount" DROP NOT NULL,
    ALTER COLUMN "vatAmount" DROP NOT NULL,
    ALTER COLUMN "grossAmount" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Invoice_salesOrderId_idx" ON "Invoice"("salesOrderId");

-- CreateIndex: idempotencia-kulcs a UNAS read-only számlatükör
-- upsertjéhez - egy adott forrás sosem adhatja ki kétszer ugyanazt a
-- számlaszámot (lásd unas-order-sync.repository.ts syncInvoiceMirror).
CREATE UNIQUE INDEX "Invoice_source_invoiceNumber_key" ON "Invoice"("source", "invoiceNumber");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterEnum: a webshop (UNAS) rendeléshez tartozó, UNAS getOrder API-ból
-- read-only tükrözött kimenő számla forrása - ezt ténylegesen a UNAS
-- beépített Számlázz.hu modulja állítja ki, NEM az Acropora OS. Az
-- ALTER TYPE ... ADD VALUE Postgres-ben csak akkor futtatható biztonságosan
-- ugyanabban a tranzakcióban, mint ami hozzáadja, ha az új értéket a
-- migráció nem használja fel DML-ben is - itt nem használja.
ALTER TYPE "InvoiceSource" ADD VALUE 'UNAS';
