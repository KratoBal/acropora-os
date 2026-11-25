-- A PARTNER LEGUTÓBBI LÁTOGATÁSA EGY LISTÁN (kártya 28f31715, PR 2)
CREATE TYPE "PartnerSeenArea" AS ENUM ('TICKETS', 'WORKSHEETS');

CREATE TABLE "PartnerSeen" (
    "userId" TEXT NOT NULL,
    "area" "PartnerSeenArea" NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerSeen_pkey" PRIMARY KEY ("userId","area")
);

ALTER TABLE "PartnerSeen" ADD CONSTRAINT "PartnerSeen_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
