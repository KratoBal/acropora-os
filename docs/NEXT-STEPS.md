# Következő lépések

> Ez a dokumentum az első technikai mérföldkő (repo-alapítás, NestJS API,
> UNAS kliens) eredeti tervét rögzíti; ez a szakasz lezárult. Az aktuális
> állapotot és a valóban következő munkacsomagokat lásd:
> [CURRENT_STATUS.md – Next steps](./CURRENT_STATUS.md#next-steps).

## Első technikai mérföldkő (lezárva)

1. ~~Monorepo inicializálása pnpm workspace-szel.~~
2. ~~NestJS API és worker létrehozása.~~
3. ~~Prisma migráció futtatása.~~
4. ~~Admin felhasználó seedelése.~~
5. UNAS kliens elkészítése:
   - ~~token/login kezelés~~
   - ~~terméklekérés~~
   - készletlekérés
   - készletmódosítás
6. ~~Integrációs teszt egy kijelölt termékkel.~~

A terméklekérés, token/login és a szinkron nagy része az M2.1 UNAS Product
Synchronization munkacsomagban elkészült (lásd
[M2.1-UNAS-PRODUCT-SYNCHRONIZATION.md](./M2.1-UNAS-PRODUCT-SYNCHRONIZATION.md)).
A közvetlen UNAS készletmódosítás (stock push) egyelőre nyitott.

## A tényleges bekötéshez szükséges adatok

- UNAS API-kulcs és engedélyezett végpontok.
- Az elsődleges UNAS raktár azonosítója, ha több raktár van.
- Egy teszttermék SKU-ja.
- Számlázz.hu Agent kulcs.
- Használt számlatömb előtagja.
- UNAS fizetési és szállítási módok mintája.
- Egy anonimizált tesztrendelés XML/JSON exportja.

Ezek közül az UNAS API-kulcs és a connection-adatok kezelése az M2.2 UNAS
Connection Settings munkacsomagban elkészült. A Számlázz.hu-hoz kapcsolódó
adatok (Agent kulcs, számlatömb-előtag) egyelőre nem kerültek bekötésre; a
Számlázz.hu integráció még nem indult el.
