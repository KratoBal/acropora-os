# Acropora OS – Current Status

Utolsó ellenőrzés: 2026-07-19

## Repository

https://github.com/KratoBal/acropora-os

## Current milestone

M1 – First Production Import

## Completed

- Prisma `DATABASE_URL` root `.env` betöltés javítása
- Brand Management
- Brand Import Assistant
- stabil forrásmárka-azonosítók
- `MISSING_BRAND` besorolás
- egyedi Brand létrehozás
- alias mapping
- biztonságos bulk Brand létrehozás
- idempotencia
- soronkénti eredmény
- audit és DomainEvent
- max. 200 soros limit
- UI kijelölés és megerősítés
- API, Web, Types és integrációs tesztek
- auth identity feloldása létező belső `User.id` értékre

## Current blocker

A `DomainEvent_actorUserId_fkey` kódoldali javítása elkészült: a development identity e-mail alapján determinisztikusan létrejön vagy feloldódik, és a service réteg valódi belső `User.id` értéket kap. A blocker lezárásához még szükséges a lent leírt kézi ellenőrzés az aktuális batchen.

## Current batch

Batch ID: `cmrrx41c2000079wo92lr9clz`

Input: `catalog.xlsx`

Known brand state before final manual verification:

- 48 source brands
- 2 exact matches
- 46 missing brands

## Next steps

1. 3–5 márkás kézi próba
2. Idempotencia kézi ellenőrzése
3. Maradék hiányzó márkák létrehozása
4. M1 lezárása
5. M2 Product Import előkészítése

## Relevant commands

```bash
docker compose up -d
pnpm prisma:seed
pnpm dev
pnpm lint
pnpm typecheck
pnpm --filter @acropora/api test
pnpm --filter @acropora/api test:brands:integration
pnpm build
git diff --check
git status --short
```

Az adatbázis-integrációs teszteket elkülönített tesztadatbázissal és a repositoryban dokumentált opt-in környezeti változókkal kell futtatni.

## Manual test

- Login: http://localhost:3000/login
- Brand Import Assistant: http://localhost:3000/admin/brands/import-assistant
- API health: http://localhost:3001/health
- Aktuális batch: `cmrrx41c2000079wo92lr9clz`

A fejlesztői bejelentkezés után a `GET /auth/me` által visszaadott `user.id` adatbázisbeli CUID legyen, ne `dev-owner`, `dev-admin`, `dev-warehouse` vagy `dev-service`. Először 3–5 `MISSING_BRAND` sort hozz létre, majd ugyanazokra ismételd meg a műveletet és ellenőrizd az idempotens eredményt, valamint a `DomainEvent.actorUserId` és `AuditLog.userId` kapcsolódását a `User` táblához.

## Known limitations

- A development auth jelszó nélküli, memóriában tárolt sessiont használ; productionben tiltott.
- Az API újraindítása érvényteleníti a development sessionöket, ezért újra be kell jelentkezni.
- A Brand Review kézi workflow marad.
- Product és `StockMovement` rekordok nem importálhatók automatikusan ebben a mérföldkőben.
- `ExternalReference` csak stabil, igazolt külső azonosítóból készülhet; display névből nem.
- Az aktuális production import batch tartalmát a kézi M1 lezárás előtt újra ellenőrizni kell.

## Important constraints

- Az `acropora-pre-m1.sql` fájlt nem szabad módosítani.
- Product vagy `StockMovement` rekordot nem szabad automatikusan importálni.
- A Brand Review külön kézi workflow.
- `ExternalReference` csak stabil, igazolt külső azonosítóból készülhet.
- Display névből nem készülhet `ExternalReference`.
- Commit és push csak külön jóváhagyással történhet.
