-- A Számlázz.hu számla- és nyugta-továbbítás nyers üzenetei (acrobot 25686).
CREATE TABLE "SzamlazzFeedMessage" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SzamlazzFeedMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SzamlazzFeedMessage_kind_externalId_key" ON "SzamlazzFeedMessage"("kind", "externalId");
