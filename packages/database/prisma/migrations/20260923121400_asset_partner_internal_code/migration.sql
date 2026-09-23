-- Az "inventoryNumber" mező mindig a partner saját kódját jelentette (lásd a
-- korábbi FIELD_LABELS bejegyzést, "partner azonosítója", és a munkalap-sor
-- jegyzetét, "AZ ÜGYFÉL SAJÁT ESZKÖZKÓDJA"), csak a felirata volt "Leltári
-- szám" -- Balázs szerint (2026-09-23 11:55) ez félrevezető.
--
-- ÁTNEVEZÉS, NEM CSERE: a RENAME COLUMN megőrzi a meglévő adatot. Mérve
-- (2026-09-23, éles adat): a 157 eszközből pontosan egynek van ma értéke
-- (RIV_PUM) -- ez a sor a rename után is a helyén marad, csak új néven.
ALTER TABLE "Asset" RENAME COLUMN "inventoryNumber" TO "partnerInternalCode";
ALTER INDEX "Asset_inventoryNumber_idx" RENAME TO "Asset_partnerInternalCode_idx";

-- ÚJ, ÜRES "inventoryNumber" MEZŐ -- az igazi leltári szám (Balázs kérése,
-- ugyanaz az üzenet). A kitöltés felülete később épül; ez a kör csak a helyét
-- készíti elő, ugyanolyan alakban, mint a mellette álló szöveges mezők.
ALTER TABLE "Asset" ADD COLUMN "inventoryNumber" TEXT;
CREATE INDEX "Asset_inventoryNumber_idx" ON "Asset"("inventoryNumber");
