-- A munkalap legutolsó verziója nézetként (a9db2779; barracuda a #2711-en): a karbantartási lista kész-szűrője és számlálója
-- EXISTS / NOT EXISTS részlekérdezéssel olvassa, azonosító-lista nélkül. Egy munkalaphoz egy sor, a legnagyobb `version` számú.
-- Adatot nem ír és nem mozdít; a ("worksheetId", "version") egyedi index szolgálja ki a rendezést.
CREATE VIEW "WorksheetLatestVersion" AS
SELECT DISTINCT ON ("worksheetId") "worksheetId", "version", "status"
FROM "WorksheetVersion"
ORDER BY "worksheetId", "version" DESC;
