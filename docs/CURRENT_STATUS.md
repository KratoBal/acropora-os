# Acropora OS – Current Status

Utolsó ellenőrzés: 2026-07-20

## Repository

https://github.com/KratoBal/acropora-os

## Current milestone

M1 – First Production Import és stabilization: elkészült. M2.1 – UNAS Product
Synchronization specifikáció és implementáció-előkészítés folyamatban.

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

M2.1 UNAS Product Synchronization:

- UNAS Product Master és Acropora read-only mirror határ;
- a 38 mezős XLSX contract és az UNAS API discovery;
- Product Extension, reported stock és sync lifecycle adatmodell;
- ownership-aware diff, idempotens apply és read-only Product API.

Az API adapter, canonical hash, identity-aware diff, perzisztens sync run/cursor,
tranzakciós mirror apply, a dokumentált product mezők API mappingje, a
full-snapshot missing/restore, a
`State=deleted` terméklekérés, a Category parent-fa reconciliation, valamint az
UNAS-forrású ProductCategory és ProductImage normalizált apply, a szerveroldali
token-cache, az adatbázis-szintű single-run kizárás, valamint a kézi admin sync és
run-status API, továbbá a korlátozott retry/Retry-After policy és a beragadt
futásokat felszabadító heartbeat, valamint az opt-in időzített háttérfuttatás
és az operátori sync run-history/kézi indítás webfelülete elkészült. Az új
Product Detail projection külön read-only UNAS mirror és Acropora Product
Extension blokkokat jelenít meg, a generikus Product írás pedig blokkolt az
UNAS-managed rekordokon. A Product Extension saját készlet- és beszerzési
beállításai a termékrészleten jogosultsággal szerkeszthetők; a tényleges
változások actorhoz kötött AuditLog és domain event rekorddal, egy tranzakcióban
mentődnek. A PostgreSQL sync lifecycle integrációs teszt és a migration/recovery
runbook elkészült, de ebben a környezetben PostgreSQL hiányában a teszt még nem
futott le. Nyitott maradt az éles probe, az alapár pénznemének feloldása, a nem
dokumentált kezdeti mennyiség és a törölt kategóriák retention policy-ja.

## Next steps

1. Az elkészült M2.1 integrációs teszt futtatása izolált PostgreSQL adatbázison
2. Éles, read-only UNAS probe a nyitott contract kérdések igazolására
3. Riasztási/monitoring integráció kialakítása

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
- UNAS Product Sync: http://localhost:3000/admin/integrations/unas
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
