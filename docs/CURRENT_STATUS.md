# Acropora OS – Current Status

Utolsó ellenőrzés: 2026-07-20

## Repository

https://github.com/KratoBal/acropora-os

## Current milestone

M1 – First Production Import és stabilization: elkészült. M2.1 – UNAS Product
Synchronization: elkészült és mainbe merge-elve. M2.2 – UNAS Connection
Settings (backend és admin webes UI): elkészült és mainbe merge-elve.

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

M2.1 UNAS Product Synchronization (elkészült):

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
mentődnek. A PostgreSQL sync lifecycle integrációs teszt lefutott, izolált
PostgreSQL adatbázison; a migration/recovery runbook elkészült. Nyitott maradt
az éles probe eredményének teljes körű kiértékelése, az alapár pénznemének
feloldása, a nem dokumentált kezdeti mennyiség és a törölt kategóriák retention
policy-ja.

M2.2 UNAS Connection Settings (elkészült, backend és admin webes UI):

- additív `UnasConnectionSetting` Prisma modell és migráció, singleton és
  envelope/error-code DB CHECK constraint-ekkel;
- AES-256-GCM titkosítás, verziózott env-alapú master key;
- fail-closed credential provider (`DATABASE` / `ENV_FALLBACK` / `DISABLED`);
- revision-alapú UNAS token cache;
- admin connection API (`GET/PUT/POST test/DELETE /integrations/unas/connection`),
  mentés előtti read-only validációval, stored credential teszttel, DB-idő
  alapú cooldownnal és stale-test védelemmel;
- production startup validation;
- admin webes UI a `/admin/integrations/unas/connection` oldalon
  (settings.manage jogosultsághoz kötve): állapot, ellenőrzés, új kulcs
  mentése, teszt, letiltás.

Egy független read-only kódreview megerősítette, hogy a fejlesztés közben
talált 6 hiba mindegyike javítva van a kódban, és a dokumentált biztonsági
döntések (fix maszk, titokmentes audit, credential mode sosem publikus API-n)
a kódban is érvényesülnek. KMS/HSM integráció és a mentés előtti validáció és
DB-commit közötti dokumentált TOCTOU rés zárása későbbi hardening feladat
marad (lásd [ADR-014](../adr/0014-unas-connection-settings.md) és
[M2.2 spec](./M2.2-UNAS-CONNECTION-SETTINGS.md)).

## Next steps

Nincs kijelölve következő munkacsomag – M2.1 és M2.2 lezárva, PR #4 és #5
mainbe merge-elve.

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
pnpm --filter @acropora/api test:unas:connection
pnpm --filter @acropora/web test
pnpm build
```

## Local URLs

- Web: http://localhost:3000
- Login: http://localhost:3000/login
- Brand Import Assistant: http://localhost:3000/admin/brands/import-assistant
- UNAS Product Sync: http://localhost:3000/admin/integrations/unas
- UNAS Connection Settings: http://localhost:3000/admin/integrations/unas/connection
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
