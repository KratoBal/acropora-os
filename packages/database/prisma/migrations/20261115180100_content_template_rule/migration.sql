-- T5.5 S4: the dependency template as data, seeded with the spec's six rows (spec 2., the days of spec 7.).

-- CreateEnum
CREATE TYPE "ContentTemplateEventKind" AS ENUM ('LIVESTOCK_ARRIVAL', 'PURCHASE_ARRIVAL', 'SALE', 'SHOP_EVENT', 'HOLIDAY');

-- CreateEnum
CREATE TYPE "ContentTemplateAnchor" AS ENUM ('START', 'END');

-- CreateTable
CREATE TABLE "ContentTemplateRule" (
    "id" TEXT NOT NULL,
    "eventKind" "ContentTemplateEventKind" NOT NULL,
    "label" TEXT NOT NULL,
    "channel" "ContentChannel" NOT NULL,
    "anchor" "ContentTemplateAnchor" NOT NULL,
    "offsetDays" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentTemplateRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentTemplateRule_eventKind_active_idx" ON "ContentTemplateRule"("eventKind", "active");

-- The spec's six rows. The purchase arrival has none on purpose: a plain reorder is not a posting event (plan,
-- acrobot 53086); a row can be added on the page.
INSERT INTO "ContentTemplateRule" ("id", "eventKind", "label", "channel", "anchor", "offsetDays", "sortOrder", "updatedAt") VALUES
  ('t55-livestock-preorder', 'LIVESTOCK_ARRIVAL', 'Előjegyzés-felhívás', 'FACEBOOK_POST', 'START', -7, 1, CURRENT_TIMESTAMP),
  ('t55-livestock-arrived', 'LIVESTOCK_ARRIVAL', 'Mi érkezett', 'FACEBOOK_POST', 'START', 0, 2, CURRENT_TIMESTAMP),
  ('t55-livestock-care', 'LIVESTOCK_ARRIVAL', 'Akklimatizáció és tartás', 'FACEBOOK_POST', 'START', 1, 3, CURRENT_TIMESTAMP),
  ('t55-sale-announce', 'SALE', 'Bejelentés', 'FACEBOOK_POST', 'START', -3, 1, CURRENT_TIMESTAMP),
  ('t55-sale-last-day', 'SALE', 'Emlékeztető az utolsó napon', 'FACEBOOK_POST', 'END', 0, 2, CURRENT_TIMESTAMP),
  ('t55-sale-newsletter', 'SALE', 'Hírlevél', 'NEWSLETTER', 'START', 0, 3, CURRENT_TIMESTAMP);
