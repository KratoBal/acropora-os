-- Kutatasi tudastar, S4 Kiolvasas ellenorzese: a szerkeszto mezonkenti dontese a horgonyon
-- (terv v4, 7a. 1.; a szerkesztoi felulet leirasa, 3. kepernyo; Balazs jovahagyasa a stage
-- pilotra 2026-10-23, Discord 1563157803726798859; a feluletet 15:56 UTC-kor kerte, acrobot 35682).
--
-- Egy UJ, nullazhato oszlop a KnowledgeFieldAnchor-on es harom CHECK. A meglevo sorok
-- PENDING dontesuek, javitott ertek nelkul: mindharom feltetelt teljesitik.
-- Visszafele kompatibilis.
--
-- Visszaallitas: a harom CHECK eldobasa, majd
-- ALTER TABLE "KnowledgeFieldAnchor" DROP COLUMN "correctedValue";

-- AlterTable
ALTER TABLE "KnowledgeFieldAnchor" ADD COLUMN     "correctedValue" VARCHAR(300);

-- Javitott ertek pontosan a javitas-dontessel all.
ALTER TABLE "KnowledgeFieldAnchor" ADD CONSTRAINT "KnowledgeFieldAnchor_corrected_value"
  CHECK (("decision" = 'CORRECTED') = ("correctedValue" IS NOT NULL));

-- Egy dontesnek van gazdaja es ideje; a dontesre varo horgonynak nincs.
ALTER TABLE "KnowledgeFieldAnchor" ADD CONSTRAINT "KnowledgeFieldAnchor_decided"
  CHECK (("decision" = 'PENDING') = ("decidedById" IS NULL AND "decidedAt" IS NULL));

-- Egy szerkesztoi kerdes (gepi ertek nelkul) nem fogadhato el valtozatlanul: vagy javitjak, vagy elvetik.
ALTER TABLE "KnowledgeFieldAnchor" ADD CONSTRAINT "KnowledgeFieldAnchor_question_not_accepted"
  CHECK ("decision" <> 'ACCEPTED' OR "normalizedValue" IS NOT NULL);
