-- A Számlázz.hu-ból kapott kimenő számla rendelésszáma (`alap.rendelesszam`) és
-- egységesített fizetési módja (`alap.fizmodunified`; acrobot 25964). Csak új,
-- NULL-ozható oszlopok; a meglévő sorokat az újravetítés tölti ki.
-- AlterTable
ALTER TABLE "ExternalBillingDocument" ADD COLUMN     "orderNumber" TEXT,
ADD COLUMN     "paymentMethodUnified" TEXT;
