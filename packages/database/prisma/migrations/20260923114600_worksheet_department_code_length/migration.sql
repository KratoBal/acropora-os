-- A helyszín kódja mostantól öt karakter lehet, három helyett.
--
-- Balázs döntése, 2026-09-23 11:39 (szó szerint: "b") -- a FANK Biodóm
-- importja ötkarakteres rendszer-kódokat hoz (LSS01 és társai, lásd
-- exchange/FANK-Biodom-eszkozlista-2026-09-23.xlsx), és a kérés az volt, hogy
-- ezek SAJÁT ALAKJUKBAN maradjanak -- nem rövidítjük őket a mai keretbe.
--
-- A szabály HÁROM helyen állt eddig egyszerre, mind hárommal kell tágulnia,
-- különben az egyik csendben elutasít ott, ahol a másik kettő már enged:
--   packages/types/src/worksheet-management.ts  WORKSHEET_DEPARTMENT_CODE_PATTERN
--   apps/api/src/worksheets/dto/worksheet.dto.ts  CreateWorksheetDepartmentDto.code
--   itt, a CHECK megkötés és az oszlop szélessége
--
-- A `WorksheetNumberSequence.departmentCode` (VarChar(3)) SZÁNDÉKOSAN
-- VÁLTOZATLAN marad: az a régi, PARTNERCODE-DEPARTMENTCODE-ÉV alakú
-- munkalapszámok lezárt kurzorait őrzi, és 2026-08-27 óta (a számláló
-- WorksheetYearSequence-re állt át) SEMMI nem ír bele új sort -- mérve:
-- apps/api/src/suppliers/partner-code-numbers.ts a tábla EGYETLEN élő
-- hívója, és mindkét függvénye `findFirst`, sosem `create`/`upsert`.
--
-- EZ TÁGÍTÁS, NEM SZŰKÍTÉS: a mai megkötést kielégítő minden érték
-- ('^[A-Z0-9]{1,3}$') kielégíti az újat is, mert az új halmaz a régit
-- tartalmazza. Éles méréssel is igazolva (2026-09-23): a 88 mai helyszín-kód
-- közül háromnál hosszabb NULLA darab volt, tehát egyetlen sor sem válik
-- érvénytelenné, és a migráció nem igényel adat-átalakítást.
--
-- A KÓD MA SEM EGYEDI, ÉS EZ SZÁNDÉKOSAN MARAD ÍGY: az éles adatban öt kód
-- (MED, AKV, TEK, NMD, FOK) kétszer szerepel, mert az egyediség a
-- (customerId, parentId, code) hármason áll, nem a kódon önmagában -- ezt a
-- migráció nem érinti.
ALTER TABLE "WorksheetDepartment"
  ALTER COLUMN "code" TYPE VARCHAR(5);

ALTER TABLE "WorksheetDepartment"
  DROP CONSTRAINT "WorksheetDepartment_code_check";

ALTER TABLE "WorksheetDepartment"
  ADD CONSTRAINT "WorksheetDepartment_code_check" CHECK ("code" ~ '^[A-Z0-9]{1,5}$');
