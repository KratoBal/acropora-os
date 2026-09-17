-- A CSATOLMANY FELIRATA: MIT LATUNK A KEPEN.
--
-- Balazs kerese (2026-09-17): a feltoltott fenykepekhez lehessen megjegyzest
-- irni, akar mar a feltoltesnel is.
--
-- MIND A HAROM DOKUMENTUM-TABLARA, EGYSZERRE. A harom alak SZANDEKOSAN azonos
-- (lasd a sema fejleceit), es a feltoltes szabalyai kozos modulban allnak. Ha a
-- mezo csak az egyikre kerulne fel, minden kesobbi valtozast haromszor kellene
-- megcsinalni, es a harmadik mindig lemaradna.
--
-- NULLAZHATO, ES EZ NEM KENYELEM. A tablakban MAR ALLNAK sorok: egy kotelezo
-- oszlop vagy elhasalna rajtuk, vagy egy kitalalt szoveget irna rajuk, ami azt
-- allitana, hogy valaki leirta. A hiany itt ERVENYES allapot -- egy kep
-- magaert is beszelhet.
--
-- NINCS ALAPERTELMEZES, ugyanezert: egy ures string ("") KITOLTOTT mezonek
-- latszana, es akkor a "nincs felirat" es a "szandekosan ures felirat" ket
-- allapota egyformanak tunne.
ALTER TABLE "AssetDocument" ADD COLUMN "caption" VARCHAR(500);
ALTER TABLE "WorksheetDocument" ADD COLUMN "caption" VARCHAR(500);
ALTER TABLE "ServiceJobDocument" ADD COLUMN "caption" VARCHAR(500);
