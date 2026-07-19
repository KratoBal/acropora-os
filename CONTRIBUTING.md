# Közreműködés

## Fejlesztői folyamat

1. Hozz létre rövid életű feature branchet.
2. Telepítsd a függőségeket a gyökérből: `pnpm install`.
3. A változtatásokat kis, önállóan ellenőrizhető egységekben készítsd.
4. Beküldés előtt futtasd: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm build`.

## Irányelvek

- A felhasználói felület és az üzleti szövegek magyar nyelvűek.
- Titok és valós ügyféladat nem kerülhet a repositoryba.
- Megosztott üzleti típus a `packages/types`, újrafelhasználható komponens a `packages/ui` csomagba kerüljön.
- Adatmodell-változtatást migrációval és indoklással együtt kell beküldeni.
- Jelentős architekturális döntéshez új ADR szükséges.

## Commitok

Használj rövid, felszólító módú commitüzenetet. Egy commit egy logikai változtatást tartalmazzon; generált build outputot ne commitolj.
