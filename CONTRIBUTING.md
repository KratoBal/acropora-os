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
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Adatbázist érintő API-változásnál külön futtasd az érintett opt-in integrációs tesztet. A teljes Nest dependency graph ellenőrzése: `pnpm --filter @acropora/api test:bootstrap`. Élő PostgreSQL és Redis mellett a health smoke: `pnpm --filter @acropora/api test:smoke`.

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
