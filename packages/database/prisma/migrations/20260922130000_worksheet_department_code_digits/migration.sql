-- A helyszín kódja számjegyet is tartalmazhat.
--
-- Balázs kérése, 2026-09-22: "csinald meg kerlek, hogy a partnernel a helyszin
-- kodjaba ne csak betut, hanem szamot es betut is lehessen irni".
--
-- A megkötés eddig '^[A-Z]{1,3}$' volt (a 20260817231500_add_worksheets
-- migrációban, a tábla létrehozásával egy sorban). A szabály KÉT helyen áll:
-- itt és a `WORKSHEET_DEPARTMENT_CODE_PATTERN` mintában. Ha csak az egyik
-- tágul, a másik csendben elutasít -- ezért megy a kettő egy PR-ben.
--
-- A HOSSZ NEM VÁLTOZIK: a `code` oszlop továbbra is VarChar(3). Balázs a
-- hosszt nem kérte, és a munkalapszám első tagja rövid marad.
--
-- A MEGLÉVŐ SOROKON NEM BUKHAT EL: a régi megkötést kielégítő minden érték
-- ('^[A-Z]{1,3}$') kielégíti az újat is, mert az új halmaz a régit tartalmazza.
-- Ez tágítás, nem csere: szűkítésnél itt előbb adatot kellene mérni.
ALTER TABLE "WorksheetDepartment"
  DROP CONSTRAINT "WorksheetDepartment_code_check";

ALTER TABLE "WorksheetDepartment"
  ADD CONSTRAINT "WorksheetDepartment_code_check" CHECK ("code" ~ '^[A-Z0-9]{1,3}$');
