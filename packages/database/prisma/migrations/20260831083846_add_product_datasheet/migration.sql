-- CreateEnum
CREATE TYPE "MeretKategoria" AS ENUM ('NANO', 'NORMAL');

-- CreateEnum
CREATE TYPE "MeretDimenzio" AS ENUM ('TESTHOSSZ', 'KARFESZTAVOLSAG', 'HEJMERET', 'TELJES_KITERJEDES');

-- CreateEnum
CREATE TYPE "CareDifficulty" AS ENUM ('KONNYU', 'KOZEPES', 'HALADO');

-- CreateEnum
CREATE TYPE "ReefSafe" AS ENUM ('IGEN', 'NEM', 'FELTETELES', 'ALLITAS_NELKULI', 'NEM_FAJ_SZINTU');

-- CreateEnum
CREATE TYPE "SocialKeeping" AS ENUM ('EGYEDUL', 'PARBAN', 'CSOPORTBAN', 'TOBB_PELDANY_TARTHATO');

-- CreateEnum
CREATE TYPE "OriginScope" AS ENUM ('FAJ', 'GENUS', 'CSALAD');

-- CreateEnum
CREATE TYPE "FeedingType" AS ENUM ('SZURO_PLANKTON', 'ALGAEVO', 'HUSEVO', 'MINDENEVO', 'TORMELEKEVO', 'FOTOSZINTETIZALO', 'TISZTOGATO');

-- CreateEnum
CREATE TYPE "Aggression" AS ENUM ('BEKES', 'TERULETVEDO', 'RAGADOZO', 'CSALANOZ', 'FAJTARSSAL_AGRESSZIV', 'FELTETELES');

-- CreateEnum
CREATE TYPE "RefusalReason" AS ENUM ('NINCS_FORRAS', 'DONTESRE_VAR');

-- CreateEnum
CREATE TYPE "DatasheetField" AS ENUM ('MAGYAR_NEV', 'ANGOL_NEV', 'CSALAD_TAXON', 'ELOHELY', 'AKVARIUM_MERET', 'MAX_MERET', 'KULLEME', 'TARTASA', 'VISELKEDESE', 'AJANLOTT_ELESEG', 'ERZEKENYSEG', 'TARSITHATOSAG', 'ERDEKESSEG', 'SCIENTIFIC_NAME', 'CARE_DIFFICULTY', 'REEF_SAFE', 'FEEDING_TYPE', 'ORIGIN', 'AGGRESSION', 'SOCIAL_KEEPING', 'AMIT_O_VESZELYEZTET', 'AMI_OT_VESZELYEZTETI');

-- CreateTable
CREATE TABLE "ProductDatasheet" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "magyarNev" TEXT,
    "angolNev" TEXT,
    "csaladTaxon" TEXT,
    "elohelySzoveg" TEXT,
    "akvariumMeretSzoveg" TEXT,
    "maxMeretSzoveg" TEXT,
    "kulleme" TEXT,
    "tartasa" TEXT,
    "viselkedese" TEXT,
    "ajanlottEleseg" TEXT,
    "erzekenyseg" TEXT,
    "tarsithatosag" TEXT,
    "erdekesseg" TEXT,
    "minLiter" DECIMAL(10,2),
    "literPerEgyed" DECIMAL(10,2),
    "meretKategoria" "MeretKategoria",
    "meretMin" DECIMAL(10,2),
    "meretMax" DECIMAL(10,2),
    "meretDimenzio" "MeretDimenzio",
    "genus" TEXT,
    "species" TEXT,
    "kereskedelmiNev" TEXT,
    "careDifficulty" "CareDifficulty",
    "reefSafe" "ReefSafe",
    "socialKeeping" "SocialKeeping",
    "originScope" "OriginScope",
    "feedingType" "FeedingType"[],
    "aggression" "Aggression"[],
    "origin" TEXT[],
    "amitOVeszelyeztet" TEXT,
    "amiOtVeszelyezteti" TEXT,

    CONSTRAINT "ProductDatasheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductDatasheetFieldRefusal" (
    "id" TEXT NOT NULL,
    "datasheetId" TEXT NOT NULL,
    "mezo" "DatasheetField" NOT NULL,
    "indok" TEXT NOT NULL,
    "oka" "RefusalReason" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductDatasheetFieldRefusal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductDatasheet_productId_key" ON "ProductDatasheet"("productId");

-- CreateIndex
CREATE INDEX "ProductDatasheetFieldRefusal_oka_idx" ON "ProductDatasheetFieldRefusal"("oka");

-- CreateIndex
CREATE UNIQUE INDEX "ProductDatasheetFieldRefusal_datasheetId_mezo_key" ON "ProductDatasheetFieldRefusal"("datasheetId", "mezo");

-- AddForeignKey
ALTER TABLE "ProductDatasheet" ADD CONSTRAINT "ProductDatasheet_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductDatasheetFieldRefusal" ADD CONSTRAINT "ProductDatasheetFieldRefusal_datasheetId_fkey" FOREIGN KEY ("datasheetId") REFERENCES "ProductDatasheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AZ URES INDOK UGYANOLYAN ROSSZ, MINT A HIANYZO -- CSAK MAGABIZTOSABBAN NEZ KI.
--
-- A `indok TEXT NOT NULL` az URES STRINGET ATENGEDNE, es akkor visszakapnank
-- pontosan azt, amit a dontes megszuntet: egy "megtagadva" jelolot indoklas
-- nelkul. A NOT NULL tehat NEM eleg, kell melle egy CHECK.
--
-- Azert adatbazis szinten, es nem a kodban: az adat tobb uton keletkezik
-- (migracio, import, javito szkript, kezi javitas), es egy alkalmazas-oldali
-- ellenorzes csak a sajat utjat orzi. A LEGELSO toltes eppen a migracion at jon,
-- vagyis azon a csatornan, amit egy iras-oldali orzo nem lat.
--
-- Prisma-sema nem tud CHECK feltetelt kifejezni, ezert all itt nyers SQL
-- alakban, UGYANABBAN a migracioban, mint az oszlop.
ALTER TABLE "ProductDatasheetFieldRefusal"
  ADD CONSTRAINT "ProductDatasheetFieldRefusal_indok_not_blank"
  CHECK (length(btrim("indok")) > 0);
