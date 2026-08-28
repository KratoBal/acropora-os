# Közreműködés

## Fejlesztői folyamat

1. Hozz létre rövid életű feature branchet.
2. Másold le a helyi konfigurációt: `cp .env.example .env` (PowerShell: `Copy-Item .env.example .env`).
3. Telepítsd a függőségeket a gyökérből: `pnpm install --frozen-lockfile`.
4. Indítsd el a PostgreSQL és Redis szolgáltatásokat: `pnpm infra:up`.
5. Futtasd a `pnpm prisma:generate`, `pnpm prisma:migrate` és `pnpm prisma:seed` parancsokat.
6. A változtatásokat kis, önállóan ellenőrizhető egységekben készítsd.
7. Beküldés előtt futtasd:

```bash
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
```

A `pnpm install` beállítja a `core.hooksPath` értékét a repository `.githooks` mappájára, így egy pre-commit hook visszautasítja a formázatlan fájlokat tartalmazó commitot. Ez gyors helyi jelzés, nem maga a szabály: kihagyható (`git commit --no-verify`), és csak azon a gépen létezik, ahol lefutott a telepítés. A mérvadó ellenőrzés a `pnpm format:check`, és **ezt a CI is futtatja** (korábban nem futtatta senki).

**A `pnpm lint` megszűnt, és ezt érdemes tudni:** mind a hat munkaterület-csomagban a `lint` szkript `tsc --noEmit` volt, vagyis betű szerint ugyanaz, amit a `pnpm typecheck` futtat. Két név, egy ellenőrzés. A repository egyetlen valódi lintere a mobil alkalmazás ESLint-je, az viszont **nem is volt elérhető** ezen az úton: a `pnpm-workspace.yaml` kizárja az `apps/mobile` mappát a munkaterületből, tehát a `turbo run lint` sosem futtatta. **A típusellenőrzés a `pnpm typecheck`, a mobil linter a `pnpm mobile:lint`** - és mostantól nincs olyan parancs, ami mindkettőt ígéri és egyiket sem adja.

Adatbázist érintő API-változásnál külön futtasd az érintett opt-in integrációs tesztet. A teljes Nest dependency graph ellenőrzése: `pnpm --filter @acropora/api test:bootstrap`. Élő PostgreSQL és Redis mellett a health smoke: `pnpm --filter @acropora/api test:smoke`.

## Integrációs tesztek

Az integrációs tesztek sorokat hoznak létre és törölnek, ezért **saját, erre a célra létrehozott adatbázison futnak**, nem a fejlesztői adatbázison. A `RUN_DB_INTEGRATION=1` önmagában nem elég: a `DATABASE_URL`-nek `_test` vagy `_ci` végű adatbázisnévre kell mutatnia, különben a futás hangosan elszáll (`integrationDatabaseGate`, `apps/api/src/common/integration-database.ts`). A `_ci` a CI eldobható service konténerének neve (`acropora_ci`); ha ez a név valaha változik, a `TEST_DATABASE_SUFFIXES` listát vele együtt kell módosítani, és van rá teszt, ami erre figyelmeztet.

**A szabály MINDEN adatbázisos integrációs specre vonatkozik, és ezt teszt tartja be**, nem a jó szándék. Egy új `*.integration.spec.ts` fájlnak két dolgot kell tartalmaznia: meg kell hívnia a kaput (`const gate = integrationDatabaseGate(process.env);`), és a `before` hookjában el kell dobnia az elutasítást (`if (gate.mode === "refuse") throw new Error(gate.reason);`). A `describe` skip feltétele `gate.mode === "skip"` legyen. Ha valamelyik hiányzik, az `integration-gate-coverage.spec.ts` néven nevezi a fájlt, és a rendes `pnpm test` pirosra vált - adatbázis nélkül, a CI-ben is.

Ez a bekezdés korábban úgy hangzott, mintha a szabály mindenhol érvényes lenne. Nem volt az: tizenhárom spec fájlból három hívta a kaput, tíz nem, és a tíz között kilenc szűrés nélküli `deleteMany()` állt. Egy kapu, amit egy fájl nem hív meg, nem hibázik, csak csendben nem véd.

A `brands` suite saját kapcsolóval indul (`RUN_BRAND_INTEGRATION=1`, külön parancs), ezért nála a kapcsoló dönti el, hogy lefut-e, a kapu pedig azt, hogy HOL futhat le. A kettő külön kérdés.

Ez nem bizalmatlanság a teszttel szemben, hanem az egyszeri tévedés ára: egy elgépelt connection string egy sorokat törlő tesztben nem javítható vissza.

Az adatbázist **minden teljes futás előtt újra kell építeni**, mert néhány meglévő suite (jelenleg a `unas-product-sync.integration.spec.ts`) tiszta adatbázist feltételez, és a benne maradt sorokra ráasserteál. Egy dedikált teszt-adatbázisnál ez nem probléma, mert eldobható:

```bash
docker compose exec -T postgres psql -U acropora -d postgres -c 'DROP DATABASE IF EXISTS acropora_test;'
docker compose exec -T postgres psql -U acropora -d postgres -c 'CREATE DATABASE acropora_test;'
DATABASE_URL='postgresql://acropora:acropora@localhost:5432/acropora_test?schema=public' pnpm prisma:deploy
```

Futtatás:

```bash
DATABASE_URL='postgresql://acropora:acropora@localhost:5432/acropora_test?schema=public' \
  pnpm --filter @acropora/api test:integration
```

A tesztek a saját soraikat felismerhető jelölés alapján takarítják (dedikált e-mail domain, slug-előtag), és a takarítás a futás **elején is** lefut, hogy egy megszakadt futás ne hagyjon szemetet a következőnek. Egyetlen teszt sem törölhet olyan feltétellel, amely idegen sorokra is illeszkedhet: a `deleteMany({ where: { action: "..." } })` típusú, csak típusra szűrő törlés nem elfogadható.

## Irányelvek

- A felhasználói felület és az üzleti szövegek magyar nyelvűek.
- Titok és valós ügyféladat nem kerülhet a repositoryba.
- Valós CSV/XLS/XLSX export, SQL dump és generált import report nem commitolható. Tesztben kizárólag minimális szintetikus fixture használható.
- Megosztott üzleti típus a `packages/types`, újrafelhasználható komponens a `packages/ui` csomagba kerüljön.
- Adatmodell-változtatást migrációval és indoklással együtt kell beküldeni.
- Jelentős architekturális döntéshez új ADR szükséges.

## Adatbázis-változtatások

- Megosztott sémaváltozáshoz Prisma migráció szükséges; `db push` nem helyettesíti a migrációs történetet.
- A migrációt üres PostgreSQL adatbázison `pnpm prisma:deploy` paranccsal is ellenőrizni kell.
- A development seed legyen idempotens, és production környezetben ne fusson.
- Prisma-séma változtatás előtt olvasd el a [helyi fejlesztési útmutatót](docs/LOCAL-DEVELOPMENT.md).

## Biztonság

Sérülékenységet ne public issue-ban jelents; kövesd a [SECURITY.md](SECURITY.md) útmutatását.

## Commitok

Használj rövid, felszólító módú commitüzenetet. Egy commit egy logikai változtatást tartalmazzon; generált build outputot ne commitolj.
