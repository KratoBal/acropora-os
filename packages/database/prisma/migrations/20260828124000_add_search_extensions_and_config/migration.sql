-- A KERESES SZOTARA. Kulon migracio a tablatol, es ez nem tagolas:
-- a konfiguracio NEVE beleepul a generalt oszlop definiciojaba, tehat a
-- konfiguracionak leteznie kell, MIELOTT az oszlop letrejon, minden
-- kornyezetben. Egy fajlon belul ez az utasitas-sorrendre bizodna; ket
-- fajlban a migracios rendszer garantalja.

-- Merve 2026-08-28, valodi PostgreSQL 16.15-on, az alkalmazas sajat
-- szerepkorevel (nem superuser): mindketto telepitheto. A PostgreSQL 13 ota
-- ezek "trusted" kiterjesztesek, tehat az adatbazis tulajdonosa is felteheti.
-- HA EGY KORNYEZETBEN MEGIS JOGOSULTSAGI HIBAT AD, az nem a migracio hibaja,
-- es a tunete egyertelmu: "permission denied to create extension".
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- SAJAT KONFIGURACIO, ES NEM FUGGVENYHIVAS. Az unaccent fuggveny NEM
-- immutable -- merve ugyanezen a peldanyon: provolatile = 's' (stable). A
-- PostgreSQL pedig nem enged nem-immutable fuggvenyt generalt oszlopba, tehat
-- a to_tsvector('hungarian', unaccent(mezo)) alak visszautasitassal jarna.
-- A ketargumentumu to_tsvector('acropora_hu', mezo) viszont immutable, es ezt
-- nem felteteleztuk: egy eldobhato tablan kiprobaltuk, a generalt oszlop
-- letrejott.
--
-- A SZOTARSORREND A LENYEG: unaccent ELOBB, hungarian_stem utana. Forditva a
-- szotovezes ekezetes alakot kapna, es az ekezet nelkul beirt szo nem talalna.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'acropora_hu') THEN
    CREATE TEXT SEARCH CONFIGURATION acropora_hu ( COPY = hungarian );

    ALTER TEXT SEARCH CONFIGURATION acropora_hu
      ALTER MAPPING FOR hword, hword_part, word
      WITH unaccent, hungarian_stem;
  END IF;
END
$$;
