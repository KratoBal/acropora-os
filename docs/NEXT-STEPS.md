# Következő lépések

## Első technikai mérföldkő

1. Monorepo inicializálása pnpm workspace-szel.
2. NestJS API és worker létrehozása.
3. Prisma migráció futtatása.
4. Admin felhasználó seedelése.
5. UNAS kliens elkészítése:
   - token/login kezelés;
   - terméklekérés;
   - készletlekérés;
   - készletmódosítás.
6. Integrációs teszt egy kijelölt termékkel.

## A tényleges bekötéshez szükséges adatok

- UNAS API-kulcs és engedélyezett végpontok.
- Az elsődleges UNAS raktár azonosítója, ha több raktár van.
- Egy teszttermék SKU-ja.
- Számlázz.hu Agent kulcs.
- Használt számlatömb előtagja.
- UNAS fizetési és szállítási módok mintája.
- Egy anonimizált tesztrendelés XML/JSON exportja.
