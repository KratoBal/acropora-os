# ADR-012 – Evidence-alapú determinisztikus brandfeloldás

## Állapot

Elfogadva – 2026-07-19

## Kontextus

Az UNAS exportban sok termék explicit brand nélkül érkezik. A név-, kategória- és cikkszám-alapú következtetések lehetnek egymásnak ellentmondók; egy csendes vagy fuzzy választás hibás törzsadatot hozna létre.

## Döntés

Verziózott szótárra és bővíthető resolver-stratégiákra épülő, 0–100 pontos, determinisztikus motort használunk. Minden pont auditálható evidence-ből származik. A küszöb alatti, szoros, ismeretlen vagy konfliktusos eredmény review queue-ba kerül. Azonos fájlhash és config verzió idempotens; config-váltás új audit batch-et hoz létre. A dry run nem ír domain táblába.

## Következmények

- Az automatikus döntések reprodukálhatók és magyarázhatók.
- A bizonytalanság látható marad, nem válik önkényes branddé.
- A szótár/súly változtatása verzióemelést és regressziós tesztet igényel.
- Review UI, accept/reject workflow és Brand Management külön fejlesztés.
