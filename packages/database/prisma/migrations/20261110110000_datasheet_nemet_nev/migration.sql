-- A nemet nev az adatlapon (kartya 20b0dd47, Balazs 2026-08-31: a korall es gerinctelen adatlapon a tudomanyos nev a
-- termeknev, alatta keresheto mezokent magyar, angol, nemet nev; a nemet a kulfoldi nyitashoz). Csak az OS-ben.

-- AlterEnum
ALTER TYPE "DatasheetField" ADD VALUE 'NEMET_NEV';

-- AlterTable
ALTER TABLE "ProductDatasheet" ADD COLUMN "nemetNev" TEXT;
