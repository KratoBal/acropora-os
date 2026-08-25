-- A Medusa admin kulcs HELYE. Ugyanaz a szerkezet, amit az UNAS, a NAV es a
-- Szamlazz.hu kapcsolata mar hasznal: verziozott AES-GCM boritek, a kulcs maga
-- soha nem all itt nyersen, es a felulet fele sem olvashato vissza.
--
-- Miert MASOLAT es nem kozos szerkezet: a kiemeles ket, elesben futo integraciot
-- irna at, es ennek a kornek nem ez a tetje. A sema szintjen ez mar a negyedik
-- ilyen tabla, tehat a kiemeles kerdese kulon kort erdemel.
--
-- Ket dolog, ami MERT teny a Medusa 2.19.0 oldalan, es amiert ez a tabla
-- ovatosabb kezelest kivan, mint amilyennek latszik:
--   1. a titkos admin kulcs ott TELJES JOGU (jogkor-valasztas nincs), tehat ami
--      itt all, az a kereskedelmi rendszer teljes admin feluletet nyitja;
--   2. lejarat mint mezo nincs, csak kesleltetett visszavonas, tehat a kulcs
--      magatol soha nem evul el. A csere szandekos muvelet, es a
--      credentialRevision az, ami a csereket megkulonbozteti egymastol.

-- CreateEnum
CREATE TYPE "MedusaCredentialMode" AS ENUM ('ENV_FALLBACK', 'DATABASE', 'DISABLED');

-- CreateEnum
CREATE TYPE "MedusaVerificationStatus" AS ENUM ('NEVER', 'SUCCESS', 'FAILED', 'INDETERMINATE');

-- CreateTable
CREATE TABLE "MedusaConnectionSetting" (
    "id" TEXT NOT NULL,
    "credentialMode" "MedusaCredentialMode" NOT NULL DEFAULT 'ENV_FALLBACK',
    "encryptedApiKey" BYTEA,
    "encryptionIv" BYTEA,
    "authenticationTag" BYTEA,
    "keyVersion" TEXT,
    "credentialRevision" INTEGER NOT NULL DEFAULT 0,
    "credentialUpdatedAt" TIMESTAMP(3),
    "credentialUpdatedByUserId" TEXT,
    "verificationStatus" "MedusaVerificationStatus" NOT NULL DEFAULT 'NEVER',
    "lastVerifiedAt" TIMESTAMP(3),
    "lastVerificationCode" TEXT,
    "credentialAttemptedAt" TIMESTAMP(3),
    "testAttemptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedusaConnectionSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MedusaConnectionSetting_credentialUpdatedByUserId_idx" ON "MedusaConnectionSetting"("credentialUpdatedByUserId");

-- AddForeignKey
ALTER TABLE "MedusaConnectionSetting" ADD CONSTRAINT "MedusaConnectionSetting_credentialUpdatedByUserId_fkey" FOREIGN KEY ("credentialUpdatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Az INDULO SOR. Ugyanaz a minta, mint az UNAS kapcsolatanal: egyetlen,
-- fix azonositoju sor all a tablaban, es a kod ennek a letezesere epul.
-- ENV_FALLBACK modban indul, mert a vetites ma a folyamat kornyezetebol
-- kapja a kulcsot. A tartalek NEM nema: a hivo oldalnak ki kell mondania,
-- ha ezen az uton megy, kulonben egy atmenetbol eszrevetlenul allapot lesz.
INSERT INTO "MedusaConnectionSetting" (
  "id",
  "credentialMode",
  "updatedAt"
) VALUES (
  'medusa',
  'ENV_FALLBACK',
  CURRENT_TIMESTAMP
) ON CONFLICT ("id") DO NOTHING;
