# ADR-0004 – UNAS connection settings és credential-kezelés

- Állapot: elfogadott
- Dátum: 2026-07-20
- Munkacsomag: M2.2 – UNAS Connection Settings

## Kontextus

Az M2.1 szerveroldali `UNAS_API_KEY` változót használ. Az M2.2 célja adminisztrátori
webes beállítás előkészítése úgy, hogy a titok ne legyen visszaolvasható API-n,
naplóban vagy audit payloadban, és az ütemezett, illetve manuális szinkron ugyanazt
a credential forrást használja. A read-only probe külön operátori eszköz, ezért
továbbra is kizárólag az `UNAS_API_KEY` környezeti változót olvassa.

## Döntés

- A connection API minden műveletéhez `settings.manage` kell; ezt `OWNER` és
  `ADMIN` kapja meg.
- A singleton `UnasConnectionSetting` három módot támogat:
  `ENV_FALLBACK`, `DATABASE`, `DISABLED`.
- A pontos elsőbbség: `DATABASE` esetén csak a DB credential használható;
  `DISABLED` esetén nincs credential és nincs env fallback; kizárólag az explicit
  `ENV_FALLBACK` rekord használhatja az `UNAS_API_KEY` értéket. Hiányzó singleton
  minden üzemi útvonalon `UNAS_CONNECTION_CONFIGURATION_MISSING` fail-closed hiba.
- Hibás vagy vissza nem fejthető DB envelope esetén a rendszer fail-closed; nem
  tér vissza az env kulcsra.
- A DB credential AES-256-GCM-mel készül, új 12 bájtos IV-vel, 16 bájtos taggel.
  Az AAD tartalmazza az integrációt, secret típust, envelope sémát, főkulcsverziót
  és credential revisiont.
- A főkulcs kizárólag verziózott környezeti változóból származik. M2.2-ben nincs
  KMS/HSM integráció.
- Új credential csak sikeres read-only login után írható. Ismerten hiányzó
  `getProduct` vagy `getCategory` jog elutasítja a mentést. Ismeretlen permission
  struktúra mellett a mentés `INDETERMINATE` állapottal és allowlistes
  figyelmeztetéssel engedett.
- A tárolt credential külön tesztelhető. Az UNAS-t ténylegesen elérő manuális
  teszt auditált. A cooldown miatt elutasított kérések nem írnak korlátlan számú
  audit rekordot.
- A credentialcsere 60, a manuális teszt 30 másodperces cooldownt használ. A
  jogosultság és az új timestamp egyetlen atomikus PostgreSQL műveletben,
  `CURRENT_TIMESTAMP` alapján dől el; az alkalmazáspéldány órája nem vesz részt.
- A manuális teszt az induláskori módot és revisiont rögzíti. Eredménye csak ezek
  atomikus egyezésekor írhat verification állapotot; közben történt csere vagy
  disable esetén az audit eredménye `STALE_TEST_RESULT`.
- A login dokumentált `Expire` (kompatibilitásként `ExpireTime`) mezője UNIX
  timestamp. A dokumentált kétórás token-élettartamhoz
  képest lejárt, egy percnél rövidebb vagy több mint öt perccel túl hosszú lejárat
  érvénytelen UNAS válasz.

Forrás: [UNAS login válasz](https://unas.hu/tudastar/api/azonositas-login-valasz)
és [UNAS azonosítási limitek](https://unas.hu/tudastar/api/azonositas).

- A verification 24 óra után lekérdezéskor `STALE`, de ez nem blokkol szinkront.
- Disable törli a ciphertext, IV, tag és kulcsverzió mezőket, növeli a revisiont,
  és `DISABLED` módot állít.
- Webes `adopt-environment` végpont nincs. Az env fallback átmeneti migrációs mód.
- Production induláskor kötelező a singleton, az aktív írási főkulcs és DATABASE
  módban a tárolt envelope kulcsverziójának, illetve visszafejthetőségének
  validációja. ENV_FALLBACK módban az env credential megléte is kötelező;
  DISABLED credential nélkül érvényes. Hiba esetén az API fail-fast módon nem
  indul el.

## API-szerződés

- `GET /integrations/unas/connection`
- `PUT /integrations/unas/connection/credential` – `{ "apiKey": "..." }`
- `POST /integrations/unas/connection/test`
- `DELETE /integrations/unas/connection/credential`

A response csak `configured`, fix `masked`, `modifiedAt`, valamint a verification
`status`, `checkedAt` és allowlistes `code` mezőit tartalmazza. Credential source,
ciphertext, IV, tag, kulcsverzió, revision, token és UNAS payload nem publikus.

## Audit és hibák

Audit metadata csak actiont, actort, módváltást, revisiont, mezőneveket,
verification állapotot és allowlistes kódot tartalmazhat. API-kulcs, token,
ciphertext, hash/fingerprint, UNAS XML, `<Error>` szöveg, response body és
termékadat tilos. Ismeretlen kivétel és nem allowlistes perzisztált hibakód mindig
`UNAS_CONNECTION_FAILED`. Az adatbázis CHECK constraintje második védelmi vonal;
az allowlist bővítésekor a runtime listát és a constraintet együtt kell migrálni.

## Következmények

A főkulcs elvesztésekor a DB credential nem állítható helyre; backup és rotációs
runbook szükséges. Régi főkulcsverziót a hozzá tartozó envelope-ok újratitkosításáig
meg kell tartani. A későbbi webes UI kizárólag a fenti projekcióra épülhet.
