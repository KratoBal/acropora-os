-- A NYEREMÉNYJÁTÉK HOZZÁJÁRULÁSA (kártya 31445d0f; acrobot 44375, Balázs adatkezelési tájékoztatója): a játékszabályzat elfogadása és az
-- adatkezelési hozzájárulás két külön jelölőnégyzet, és a nevezés tárolja, mikor és a két szöveg melyik verziójára adták. Csak új,
-- üres (NULL) oszlopok: meglévő sort nem érint, a régi beküldések változatlanok.
-- ROLLBACK: ALTER TABLE "GameEntry" DROP COLUMN "rulesAcceptedAt", DROP COLUMN "consentAt", DROP COLUMN "rulesVersion", DROP COLUMN "privacyVersion";

-- AlterTable
ALTER TABLE "GameEntry" ADD COLUMN "rulesAcceptedAt" TIMESTAMP(3),
ADD COLUMN "consentAt" TIMESTAMP(3),
ADD COLUMN "rulesVersion" TEXT,
ADD COLUMN "privacyVersion" TEXT;
