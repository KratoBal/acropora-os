-- A Számlázz.hu ugyanarról a számláról több változatot is küld (fizetési
-- állapot, módosított mező), ugyanazzal az azonosítóval (acrobot 25781). Az új
-- tartalom új sor, a régi megmarad; azonos tartalom továbbra is egyszer.
DROP INDEX "SzamlazzFeedMessage_kind_externalId_key";

CREATE UNIQUE INDEX "SzamlazzFeedMessage_kind_externalId_sha256_key" ON "SzamlazzFeedMessage"("kind", "externalId", "sha256");

CREATE INDEX "SzamlazzFeedMessage_kind_externalId_idx" ON "SzamlazzFeedMessage"("kind", "externalId");
