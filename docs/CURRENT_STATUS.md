# Acropora OS – Current Status

Utolsó ellenőrzés: 2026-07-19

## Repository

https://github.com/KratoBal/acropora-os

## Current milestone

M1 – First Production Import: elkészült, stabilization folyamatban.

## Completed

- Prisma `DATABASE_URL` betöltése a gyökér `.env` fájlból development indításkor
- Brand Management és Brand Import Assistant
- stabil forrásmárka-azonosítók és `MISSING_BRAND` besorolás
- egyedi és legfeljebb 200 soros bulk Brand létrehozás
- alias mapping, soronkénti eredmény és idempotencia
- AuditLog és DomainEvent naplózás
- UI kijelölés és bulk megerősítés
- development auth identity feloldása létező belső `User.id` értékre
- Nest runtime dependency injection javítása az `AuthUserResolver` konkrét providerrel
- API, Web, Types és adatbázis tesztek

## Current focus

M1 stabilization:

- teljes Nest AppModule bootstrap ellenőrzése;
- HTTP health smoke PostgreSQL és Redis szolgáltatással;
- CI migráció-, seed-, integration- és build ellenőrzések;
- repository safety és publikus dokumentáció hardening.

## Next steps

1. Stabilization ellenőrzések zöldre futtatása és review
2. M1 változások jóváhagyott commitokra bontása
3. M2 Product Import előkészítése

## Relevant commands

```bash
pnpm install --frozen-lockfile
pnpm infra:up
pnpm prisma:generate
pnpm prisma:migrate
pnpm prisma:seed
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @acropora/api test:integration
pnpm --filter @acropora/api test:brands:integration
pnpm --filter @acropora/api test:bootstrap
pnpm --filter @acropora/api test:smoke
pnpm build
```

## Local URLs

- Web: http://localhost:3000
- Login: http://localhost:3000/login
- Brand Import Assistant: http://localhost:3000/admin/brands/import-assistant
- API health: http://localhost:3001/health

## Known limitations

- A development auth jelszó nélküli, memóriában tárolt sessiont használ; productionben tiltott.
- Az API újraindítása érvényteleníti a development sessionöket.
- A Brand Review kézi workflow.
- Product és `StockMovement` rekordok automatikus production importja nem része az M1 Brand Import lezárásának.
- `ExternalReference` csak stabil, igazolt külső azonosítóból készülhet; display névből nem.
- A repository nem tartalmaz LICENSE fájlt; licencet csak a tulajdonos döntése alapján szabad hozzáadni.

## Important constraints

- Az `acropora-pre-m1.sql` fájlt nem szabad módosítani vagy commitolni.
- Valós importexport, adatbázis-dump, secret vagy személyes adat nem kerülhet Gitbe.
- Commit és push csak külön jóváhagyással történhet.
