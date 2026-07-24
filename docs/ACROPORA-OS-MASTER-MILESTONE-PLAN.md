# Acropora OS – Master Milestone Plan

**Dokumentum célja:** teljes, végrehajtható fejlesztési ütemterv az Acropora OS számára, kifejezetten AI-fejlesztőnek (például Claude Code vagy Codex) történő átadáshoz.

**Állapot dátuma:** 2026-07-24
**Repository:** `KratoBal/acropora-os`
**Auditált ág:** `main`
**Auditált aktuális checkpoint:** `87cee32` (helyi commit, push a sandboxból nem lehetséges GitHub-hitelesítés hiányában – lásd 11A)
**Audit módszere:** a `main` dokumentációja, Prisma-sémája, NestJS modulregisztrációja, megosztott típusai, migrációi, feature commitjai és egyesített pull requestjei alapján

---

## 1. Használati utasítás az AI-fejlesztőnek

Ez a dokumentum a teljes termékirányt rögzíti, de **nem ad engedélyt az összes mérföldkő egyidejű implementálására**.

Az AI-fejlesztő minden munkamenetben:

1. kizárólag a felhasználó által megnevezett egy mérföldkővel vagy al-mérföldkővel dolgozzon;
2. implementáció előtt ellenőrizze a repository, a branch, a munkafa, a dokumentáció és a releváns migrációk aktuális állapotát;
3. őrizze meg a már elfogadott architekturális döntéseket;
4. ne írjon felül működő vagy felhasználói változtatást;
5. ne commitoljon és ne pusholjon külön felhasználói jóváhagyás nélkül;
6. ne helyezzen secretet, valós exportot, SQL dumpot, ügyféladatot, számlaadatot vagy más személyes adatot a Git repositoryba;
7. adatmodell-változást Prisma migrációval, teszttel és dokumentációval együtt készítsen;
8. jelentős új architekturális döntést ADR-ben rögzítsen;
9. minden külső integrációt idempotens, újrapróbálható és auditálható módon valósítson meg;
10. a mérföldkő végén futtassa a releváns ellenőrzéseket, és tényszerűen jelezze, mit tudott és mit nem tudott lefuttatni.

### Kötelező alapellenőrzések

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Adatbázist vagy NestJS dependency graphot érintő változtatásnál:

```bash
pnpm infra:up
pnpm prisma:generate
pnpm prisma:migrate
pnpm --filter @acropora/api test:bootstrap
pnpm --filter @acropora/api test:integration
pnpm --filter @acropora/api test:smoke
```

**Sandbox-korlát (2026-07-24 óta ismert):** a Cowork-sandboxban a `prisma
generate`/`validate`/`migrate` a `binaries.prisma.sh` felé 403-mal elutasított
schema-engine letöltés miatt nem futtatható, és a Prisma Query Engine csak a
felhasználó Mac-jén (`darwin-arm64`) generált binárisként érhető el, nem
`linux-arm64`-ként – ezért a sandboxban futtatott `node --test` a ténylegesen
adatbázist érintő teszteknél platform-mismatch hibával elbukik, kód szinten
hibátlan logika mellett is. `tsc --noEmit` és a tiszta logikai (mockolt)
tesztek viszont a sandboxban is megbízhatóan futtathatók, és ez volt is téve
minden idáig auditált feature-nél. A tényleges `pnpm prisma:generate`/
`migrate`/teljes `pnpm test`/`pnpm build` futtatása a felhasználó gépén
szükséges commit előtt vagy után, éles alkalmazás előtt mindenképp.

---

## 2. Termékvízió

Az Acropora OS az Acropora Kft. magyar nyelvű, moduláris vállalatirányítási rendszere. Feladata, hogy egy közös, auditálható munkafelületen kezelje:

- a terméktörzs helyi tükrét és Acropora-specifikus kiegészítéseit;
- a fizikai készletet és minden készletmozgást;
- a beszállítókat, beszerzési rendeléseket és bevételezéseket;
- a webshopos és egyéb értékesítési rendeléseket;
- a bejövő és kimenő számlákat;
- a pénzügyi egyeztetést és kifizetettségi állapotokat;
- a vevőket és kapcsolattartást;
- az akváriumokat, vízméréseket, ICP-riportokat;
- a szerviz-, karbantartási és helyszíni munkákat;
- az operatív feladatokat, értesítéseket és riportokat.

Az Acropora OS nem váltja ki automatikusan az összes külső rendszert. A rendszernek egyértelmű adatgazda-határokat kell tartania.

---

## 3. Rögzített rendszer- és adatgazda-határok

| Adatkör | Elsődleges rendszer | Acropora OS szerepe |
|---|---|---|
| Terméktörzs, webshopnév, leírás, eladási ár, webshop-státusz | UNAS | Read-only, normalizált helyi tükör |
| Acropora-specifikus termékbeállítások | Acropora OS | Elsődleges adatgazda |
| Fizikai készlet és készletmozgás | Acropora OS | Elsődleges adatgazda |
| Webshopban publikált eladható készlet | Acropora OS → UNAS | Számítás és visszaírás |
| Webshopos rendelés | UNAS | Helyi, idempotens tükör és teljesítési workflow |
| Beszállító, beszállítói cikkszám és beszerzési feltétel | Acropora OS | Elsődleges adatgazda |
| Beszerzési ár története | Acropora OS | Bevételezési tételekből képzett történet |
| Kimenő számla jogi bizonylata és számlaszáma | Számlázz.hu | Helyi tükör, státusz és dokumentumhivatkozás |
| Bejövő számlák napi adatforrása | Számlázz.hu pénzügyi adatkapcsolat (**tervezett elsődleges forrás, lásd 6.0A**) | Push alapú helyi fogadás |
| NAV-nak jelentett számlák | NAV Online Számla | Napi teljességi és eltérésellenőrző forrás (**másodlagos, nem elsődleges adatforrás – döntés megerősítve 2026-07-24, lásd 11. döntés #6**) |
| Banki tranzakciók | Bank/Számlázz.hu Autokassza vagy külön banki kapcsolat | Import, párosítás és egyeztetés |
| Ügyfél, akvárium, szerviz és mérés | Acropora OS | Elsődleges adatgazda |

### Megváltoztathatatlan alapelvek

1. Az UNAS a Product Master.
2. Az UNAS-tól tükrözött termékmezők az Acropora OS-ben nem szerkeszthetők.
3. A fizikai készlet forrása a postolt készletmozgási főkönyv.
4. Hibás postolt készletmozgást nem törlünk vagy írunk át; ellenmozgással javítunk.
5. Katalógusszinkron soha nem módosíthat fizikai készletet.
6. Eladási ár nem írhat felül beszerzési árat.
7. Külső API-hívás nem része az üzleti adatbázis-tranzakciónak.
8. Külső művelethez outbox/queue, idempotenciakulcs és korlátozott retry szükséges.
9. Stabil külső hivatkozás csak igazolt külső azonosítóból készülhet.
10. Pénzügyi és készletadatok változása auditálandó.

---

## 4. Technológiai alap

- pnpm workspace és Turborepo;
- Next.js webalkalmazás;
- NestJS API;
- PostgreSQL és Prisma;
- Redis háttérfeladatokhoz, zároláshoz és gyorsítótárhoz;
- megosztott UI-, config-, database- és types-csomagok;
- magyar nyelvű kezelőfelület;
- role + permission alapú jogosultságkezelés;
- AuditLog és DomainEvent;
- idempotens integrációs feldolgozás;
- strukturált naplózás és health endpointok.

---

## 5. Állapotjelölések

- **DONE:** elkészült, csak regressziójavítás vagy éles validálás maradhat.
- **IN PROGRESS:** aktív fejlesztési mérföldkő.
- **COMMITTED:** elfogadott következő termékirány.
- **PROPOSED:** üzletileg indokolt, de megvalósítás előtt külön jóváhagyandó.
- **OPTIONAL:** csak akkor készüljön el, ha a használati igény és megtérülés igazolt.

---

# 6. Mérföldkövek

## 6.0 Repository-audit: ténylegesen megtalált funkciók

Ez a leltár nem pusztán a roadmap állításaira épül. A megjelölt funkciókhoz a
repositoryban tényleges adatmodell, migráció, API-, UI- és/vagy tesztkód
található. A „részben” megjelölés azt jelenti, hogy használható első iteráció
elkészült, de a teljes üzleti vagy production workflow még nem.

| Terület | Tényleges állapot a `main` ágon | Bizonyíték/jellemző képesség |
|---|---|---|
| Repository foundation | DONE | pnpm/Turborepo, Next.js, NestJS, PostgreSQL, Redis, Prisma, teszt/build parancsok |
| Development auth és RBAC | DONE fejlesztéshez | globális Auth/Permission guard, központi role-permission mátrix |
| Admin felhasználókezelés | DONE | `/admin/users`, profil, role, scrypt jelszóhash, aktiválás/inaktiválás, audit |
| Production bejelentkezés | NOT STARTED | a jelszómezők elkészültek, de a login továbbra is development mock |
| Brand Management/Import Assistant | DONE | staging, review, bulk brand, alias, conflict/idempotencia |
| UNAS terméktükör | DONE | teljes/inkrementális sync, kategória, kép, missing/restore, Product Extension |
| UNAS kapcsolatbeállítás | DONE | AES-256-GCM, DATABASE/ENV_FALLBACK/DISABLED, admin API és UI |
| Éles UNAS termék-sync | DONE első éles validálással | 1884 termékes teljes futás dokumentált, valós UNAS parserhibák javítva |
| Terméklista/részlet | DONE első iteráció | ár, akciós ár, helyi készlet, UNAS mirror, Product Extension |
| Utolsó beszerzési ár | DONE | Product Extension nettó ár, pénznem és HUF ÁFA-kezelés |
| Raktár és leltár | DONE első iteráció | XLSX leltár, inline számlálás, diff, StockMovement/StockItem korrekció |
| UNAS készlet-visszaírás | PARTIAL | leltár, POS és beszerzés közvetlen `setStock` hívásai elkészültek |
| POS | DONE első iteráció | termékkeresés, kosár, fizetési mód, készletcsökkentés, napi eladások |
| UNAS rendelésszinkron | DONE első iteráció | polling, cursor, SalesOrder, SALE/RETURN_IN mozgás, discrepancy nézet |
| Vevőtörzs | DONE első iteráció | lista, részlet, létrehozás, backend update, címek, forrásjelölés |
| UNAS vevőszinkron | DONE implementáció, live contract nyitott | cursor/overlap, scheduler, run history, admin sync |
| NAV adózólekérdezés | DONE | `queryTaxpayer`, NAV-aláírás, cégnév/cím előtöltés |
| Irányítószám-lookup | DONE best-effort | nem hivatalos külső API, NAV-adatot nem ír felül |
| Beszállítótörzs | DONE első iteráció | lista/keresés/létrehozás, adószám, ország, elérhetőség, **önálló Partnerek modul (`/partnerek`) bank-/cím-/kapcsolattartó-mezőkkel és VIES adószám-ellenőrzéssel (2026-07-24)** |
| EU-s beszerzés | DONE első iteráció | PurchaseInvoice, tételek, készletnövelés, UNAS push, termékextension-frissítés, **terméktörzsben nem szereplő tétel manuális (`NOT_LINKED`) felvétele (2026-07-24)** |
| MNB árfolyamkliens | IMPLEMENTED BUT BLOCKED | SOAP 1.1/1.2 és fallback elkészült, éles botvédelem miatt kézi árfolyam kell |
| Belföldi beszerzés | **DONE első iteráció (2026-07-24)** | kézi ÁFA-kulcsos rögzítés és NAV Online Számla (`queryInvoiceDigest`/`queryInvoiceData`) alapú bejövőszámla-betöltés a közös `/beszerzes/uj` űrlapon; NAV-sorok soronkénti formális termékvariáns-egyeztetése még nem indult el |
| Számlázz.hu | NOT STARTED | adatmodellben/POS-ban előkészítő mező van, működő integráció nincs; **2026-07-24-től az elsődleges bejövő/kimenő számlaszinkron tervezett forrása, lásd 6.0A** |
| NAV számlareconciliation | NOT STARTED | csak `queryTaxpayer` és a belföldi bevételezéshez épített `queryInvoiceDigest`/`queryInvoiceData` készült el, önálló napi teljességi/eltérés-egyeztetés (M9) nem |
| CRM-bővítések | NOT STARTED | kontaktok, jegyzetek, címkék, timeline hiányzik |
| Akvárium/szerviz/ICP | SCHEMA-ONLY | Prisma modellek vannak, regisztrált NestJS modul/UI nincs |
| Operations | NOT STARTED | production auth, monitoring, backup/restore és deployment hardening hiányzik |

### 6.0A Frissen megerősített üzleti döntés: Számlázz.hu elsődleges, NAV másodlagos

2026-07-24-én a tulajdonos megerősítette a korábban nyitott 11. döntés #6
pontját: **a Számlázz.hu marad az elsődleges bejövő és kimenő
számlaszinkron-forrás, a NAV Online Számla pedig kizárólag napi
teljességi/eltérés-ellenőrzésre szolgál**, az eredetileg is így tervezett M8
(elsődleges) / M9 (másodlagos, független ellenőrző) munkamegosztás szerint.

Ez a döntés **nem vonja vissza** a 2026-07-24-én elkészült NAV-alapú
belföldi bevételezési (`bevételezés`/goods-receipt) folyamatot – az a
`PurchaseInvoice`/tényleges készletbevétel útja marad, a NAV-adat ott
kézi ellenőrzés/import-segédlet szerepét tölti be, nem a
számlanyilvántartás (M8.4) elsődleges adatforrása. A Számlázz.hu-integráció
egy különálló, azt kiegészítő modul (M8), amely a **számlanyilvántartás**
(bejövő+kimenő számlaregiszter) elsődleges szinkronforrása lesz; a NAV
ehhez a nyilvántartáshoz csak napi kereszt-ellenőrzésként kapcsolódik (M9).
A pontos határvonal (marad-e a NAV a bevételezési UI segédlete, vagy a
Számlázz.hu bejövő számla push idővel azt is kiváltja) implementáció előtti
tisztázást igényel – lásd a következő AI-feladat szakaszt (10.).

### Fontos, kódból látható technikai adósságok

1. A POS, a leltár és a beszerzés jelenleg a helyi adatbázisírás előtt hívja az
   UNAS `setStock` műveletét. Ez működő első iteráció, de nem felel meg teljesen
   a dokumentált outbox/queue elvnek. Production hardening során tartós outbox,
   retry és reconciliation szükséges.
2. A POS engedi a negatív készletet, csak figyelmeztet. Ezt üzleti döntéssel és
   permissionnel kell véglegesíteni.
3. Az UNAS rendelésszinkron helyi `SALE` mozgást hoz létre. Éles validáláskor
   bizonyítani kell, hogy ez nem duplázza az UNAS oldali készletlevonást, és a
   reconciliation szemantikája helyes.
4. Az UNAS vevőválasz gyökérelemének pontos live contractja még nincs igazolva.
5. A beszerzés jelenlegi source of truth-ja a beérkezett számla, nem egy előzetes
   `PurchaseOrder → GoodsReceipt` lánc. A roadmapnek ezt a valós működést kell
   elsődlegesnek tekintenie.
6. A `PurchaseOrder` és `GoodsReceipt` modellek továbbra is a sémában vannak,
   de nem jelentenek elkészült üzleti modult.
7. A `ServiceJob`, `Aquarium`, `AquariumMeasurement`, `IcpReport` és
   `IcpResult` modellek megléte önmagában nem jelent kész funkciót.
8. A felhasználókhoz jelszó már beállítható, de production jelszavas login még
   nincs bekötve.
9. **(új, 2026-07-24)** A NAV Online Számla belföldi bevételezési folyamat v1
   szándékosan nem kezeli a `MODIFY`/`STORNO` digest-láncot (csak `CREATE`
   tételek kerülnek be, `skippedCount`-ba számolva), és nem végez automatikus
   soronkénti termékvariáns-egyeztetést – minden NAV-sor manuális/`NOT_LINKED`
   sorként kerül be, amit a felhasználó ír át. Mindkettő tudatos v1
   scope-szűkítés, nem hiányosság.

## M0 – Repository Foundation

**Állapot:** DONE

### Cél

Stabil monorepo, fejlesztői környezet és alapvető minőségkapuk kialakítása.

### Funkciók

- pnpm/Turborepo monorepo;
- Next.js web és NestJS API;
- PostgreSQL és Redis Docker Compose környezet;
- Prisma migráció és seed;
- megosztott csomagok;
- lint, typecheck, unit test és build;
- health endpoint és alap smoke teszt;
- repository-, security- és contribution-dokumentáció.

### Kész definíciója

- tiszta telepítés dokumentált módon elindul;
- migráció üres adatbázison alkalmazható;
- a teljes quality gate zöld;
- secret és valós üzleti adat nincs a repositoryban.

---

## M1 – Identity, Access, Import Foundation és Brand Management

**Állapot:** DONE fejlesztési használatra; admin user management DONE; production login nyitott

### Elkészült funkciók

- providerfüggetlen session-abstrakció;
- development mock bejelentkezés;
- belső `User.id` feloldás;
- szerepkör- és permissionmátrix;
- szerepkörök: OWNER, ADMIN, MANAGER, SALES, WAREHOUSE, SERVICE, VIEWER;
- API guardok és permission dekorátorok;
- UI navigáció jogosultság szerinti szűrése;
- XLSX staging, validáció, diff, review, approval és apply alapok;
- Brand Management;
- Brand Import Assistant;
- brand alias és external mapping;
- `MISSING_BRAND`, `AMBIGUOUS`, `ARCHIVED_MATCH`, `CONFLICT` kezelése;
- legfeljebb 200 soros, explicit kijelölésű bulk brand-létrehozás;
- soronkénti eredmény és idempotens működés;
- AuditLog és DomainEvent.

### Az alapmérföldkő után elkészült admin funkciók

- felhasználólista, keresés, role- és státuszszűrés;
- felhasználó létrehozása és szerkesztése optimistic concurrencyvel;
- keresztnév, vezetéknév, e-mail és role;
- scrypt jelszóhash és adminisztratív jelszóbeállítás/csere;
- aktiválás és inaktiválás;
- saját fiók véletlen inaktiválásának UI-védelme;
- role-hoz tartozó hozzáférések megjelenítése;
- titokmentes AuditLog és DomainEvent;
- dinamikus dashboard-üdvözlés a bejelentkezett felhasználó keresztnevével.

### Nyitott production követelmények

- valódi identity provider vagy biztonságos saját hitelesítés;
- jelszókezelés és jelszó-visszaállítás;
- MFA legalább OWNER és ADMIN szerepkörhöz;
- biztonságos HttpOnly/SameSite cookie vagy megfelelő tokenkezelés;
- perzisztens szerveroldali session-store;
- CSRF-védelem;
- session- és credential-rotáció;
- brute-force és rate-limit védelem;
- be- és kijelentkezési audit.

---

## M2.1 – UNAS Product Synchronization

**Állapot:** DONE, éles teljes szinkronnal validálva

### Cél

Az UNAS termékkatalógusának ismételhető, auditálható, read-only helyi tükrözése.

### Elkészült vagy dokumentált képességek

- stabil UNAS product ID használata;
- termékek, változatok, kategóriák, brandek és képek szinkronja;
- canonical payload hash;
- ownership-aware diff;
- create/update/unchanged/conflict/missing/restore állapotok;
- teljes és inkrementális futás;
- törölt termékek kezelése;
- hiányzó termék retention alapjai;
- UNAS reported stock összehasonlítási snapshotként;
- perzisztens sync run és cursor;
- adatbázis-szintű single-run kizárás;
- heartbeat és stale-run felszabadítás;
- korlátozott retry, backoff, jitter és `Retry-After`;
- szerveroldali UNAS token-cache;
- időzített háttérfuttatás;
- kézi admin sync;
- sync run history és operátori UI;
- Product Detail read-only UNAS blokk;
- Acropora-owned Product Extension blokk;
- Product Extension auditált szerkesztése;
- generikus Product írás blokkolása UNAS-managed rekordokon.

### Éles validálás során lezárt pontok

- valós UNAS login válasz `ExpireTime` értelmezésének javítása;
- top-level kategória `Parent.Id = 0` sentinel kezelése;
- törölt szülőkategória materializálása;
- live teljes futás 1884 létrehozott termékkel és nulla hibával;
- PostgreSQL integrációs tesztek és migrációvalidáció.

### További hardening és üzleti tisztázás

- az eladási alapár pénznemének igazolása;
- `LastModTime` időzóna és változási szemantika igazolása;
- reported stock jelentésének igazolása;
- másodlagos egység konverziós irányának igazolása;
- shop rate limit és biztonságos lapméret igazolása;
- törölt kategóriák retention policy;
- monitoring és riasztási integráció.

### Elfogadási kritérium

- változatlan újrafuttatás no-op;
- sync nem ír készlet-ledgert;
- Product Extension sync után változatlan;
- external ID/SKU ellentmondás blokkoló conflict;
- hiányzó termék nem törlődik automatikusan;
- minden futás auditálható és visszakövethető.

---

## M2.2 – UNAS Connection Settings

**Állapot:** DONE, mainbe merge-elve

### Cél

Az UNAS kapcsolat biztonságos, adminisztrálható és ellenőrizhető konfigurációja.

### Scope

- `UnasConnectionSetting` singleton konfiguráció;
- `ENV_FALLBACK` és adatbázisban kezelt credential mód;
- API-kulcs titkosított tárolása;
- IV, authentication tag és key version;
- credential revision és optimistic concurrency;
- kulcs maszkolt megjelenítése;
- secret soha nem kerül API-válaszba vagy naplóba;
- kapcsolat tesztelése read-only hívással;
- verification státusz és időpont;
- kulcscsere és audit;
- OWNER/ADMIN-only kezelés;
- sync és connection setting egyértelmű UI-elválasztása;
- hibakódok secretmentes megjelenítése;
- env fallback működés dokumentálása;
- key rotation/recovery runbook.

### Ténylegesen elkészült hardening

- singleton és envelope/error-code adatbázis CHECK constraint;
- AES-256-GCM és verziózott env master key;
- fail-closed credential provider;
- revision-alapú token-cache;
- mentés előtti read-only UNAS validáció;
- stored credential teszt;
- adatbázis-idő alapú cooldown;
- stale-test overwrite védelem;
- production startup validation;
- admin API és külön admin UI.

### Elfogadási kritérium

- kulcs plaintextként nem tárolódik;
- API és UI nem szivárogtat credentialt;
- sikertelen teszt nem törli a korábban működő konfigurációt;
- párhuzamos mentés nem írja felül észrevétlenül az újabb credentialt;
- minden változás actorhoz kötött AuditLogot hoz létre;
- sync csak feloldott, engedélyezett credentiallel indul.

---

## M2.3 – UNAS Production Readiness

**Állapot:** PARTIAL – az éles termékszinkron validált, központi monitoring/riasztás nyitott

### Cél

Az M2.1–M2.2 éles használatra történő lezárása.

### Funkciók

- éles read-only probe;
- sandbox vagy biztonságos tesztmód;
- integrációs health dashboard;
- utolsó sikeres sync és adatkésés kijelzése;
- hibaarány- és stale-run riasztás;
- manuális teljes reconciliation;
- biztonságos XLSX fallback/recovery;
- operátori runbook;
- metrikák: duration, throughput, retry, error, discrepancy;
- konfigurált adatmegőrzési szabályok;
- disaster recovery próba.

---

## M3 – Inventory Core

**Állapot:** PARTIAL – StockItem/StockMovement és teljes leltárworkflow elkészült

### Cél

Az Acropora OS legyen a fizikai készlet és minden készletváltozás elsődleges nyilvántartása.

### M3.1 – Raktártörzs

- raktárak;
- raktárhelyek/polchelyek;
- aktív/inaktív állapot;
- alapértelmezett raktár és hely;
- helyhierarchia vagy zóna–polc–rekesz jelölés;
- jogosultság raktáranként, ha később szükséges.

### M3.2 – Készletmozgási főkönyv

- immutable, postolható `StockMovement`;
- típusok: nyitó, bevét, kiadás, átvezetés, korrekció, leltár, rendelésfoglalás, foglalásfeloldás, visszáru;
- piszkozat → ellenőrzött → postolt állapotgép;
- forrás- és célraktár/hely;
- tételes mennyiség és mértékegység;
- hivatkozás forrásbizonylatra;
- actor, időpont, megjegyzés és audit;
- postolt mozgás módosítása helyett ellenmozgás.

### M3.3 – Készletprojekció

- on-hand;
- reserved;
- available;
- raktár- és helyszintű bontás;
- projection újraépítés a ledgerből;
- negatív készlet policy;
- készletkártya időrendi nézettel;
- UNAS reported stockkal való eltérés kimutatása.

### M3.4 – Vonalkód és operátori használat

- SKU/EAN/gyártói cikkszám keresés;
- vonalkódolvasó-barát bevitel;
- gyors készletlekérdezés;
- címke- és polccímke-előkészítés;
- mobilbarát raktári felület.

### M3.5 – Leltár

- leltár létrehozása az automatikusan biztosított főraktárhoz – **DONE**;
- Excel-sablon aktuális mennyiségekkel – **DONE**;
- visszatöltés és üres/nem számolt cella biztonságos kezelése – **DONE**;
- inline mennyiségrögzítés és élő eltérés – **DONE**;
- nem számolt tételek kiemelése és sorbarendezése – **DONE**;
- korrekció `StockItem` + `StockMovement` tranzakcióval – **DONE**;
- UNAS abszolút készlet-visszaírás és soronkénti eredmény – **DONE**;
- korábban nem követett, de azonos értékű termék baseline létrehozása – **DONE**;
- több raktár, helyszintű leltár és újraszámlálási/jóváhagyási workflow – **OPEN**.

### M3.6 – Általános készletműveletek – OPEN

- manuális bevét/kiadás;
- raktárközi átvezetés;
- polchelyek teljes kezelőfelülete;
- foglalás és foglalásfeloldás;
- visszáru, karantén és selejt;
- általános készletkártya;
- negatív készlet végleges policy és permission.

### Elfogadási kritérium

- minden készletváltozás mozgásból származik;
- projection ledgerből újraépíthető;
- postolt mozgás nem szerkeszthető és nem törölhető;
- párhuzamos postolás konzisztens;
- mennyiségek `Decimal`, nem lebegőpontos számok;
- minden készletkorrekció indoklással és actorral rendelkezik.

---

## M4 – Supplier and Purchasing

**Állapot:** PARTIAL – beszállítótörzs, EU-s és belföldi számlaközpontú bevételezés elkészült

### Cél

Beszállítók, beszerzési feltételek, rendelések és bevételezések teljes kezelése.

### M4.1 – Beszállítótörzs

- cégnév, adószám, EU-adószám;
- számlázási és szállítási cím;
- kapcsolattartók;
- e-mail, telefon és weboldal;
- alapdeviza;
- fizetési feltétel;
- alapértelmezett szállítási mód;
- megjegyzések és aktív/inaktív állapot;
- duplikációellenőrzés.

**2026-07-24 kiegészítés:** bankszámla-adatok (IBAN+SWIFT EU-s, hazai
bankszámlaszám belföldi beszállítónál), ügyintéző (név/telefon/e-mail), cím
(irányítószám → város best-effort kitöltéssel), ország automatikus
meghatározása az adószámból, EU-s adószám VIES-ellenőrzés, valamint önálló
**Partnerek** (`/partnerek`) menüpont a beszállítói törzs kereséséhez,
létrehozásához és szerkesztéséhez – mind **DONE**.

### M4.2 – Supplier Product

- beszállító–termékváltozat kapcsolat;
- supplier SKU;
- beszállítói terméknév;
- MOQ;
- csomagméret;
- rendelési egység és készletezési egység konverzió;
- tipikus lead time;
- utolsó ismert ár;
- érvényesség és preferált beszállító;
- több beszállító összehasonlítása.

### M4.3 – Beszerzési rendelés – OPTIONAL/FUTURE

- piszkozat;
- számozás;
- beszállító és célraktár;
- pénznem;
- rendelt tételek, egységár és adó;
- várható érkezés;
- jóváhagyás;
- elküldés;
- részleges teljesítés;
- lezárás és visszavonás;
- PDF vagy nyomtatható rendelési dokumentum;
- e-mail-küldés későbbi opcionális integrációként.

### M4.4 – Utánrendelési javaslat

- minimum/optimális készlet;
- reorder point és safety stock;
- nyitott rendelés figyelembevétele;
- foglalt készlet figyelembevétele;
- phase-out és purchasing-disabled kizárás;
- beszállítónként csoportosított javaslat;
- automatikus PO helyett első körben ember által jóváhagyott draft.

### M4.5 – Goods Receipt

Az eredeti `PurchaseOrder → GoodsReceipt` folyamat nem az Acropora jelenlegi
valós folyamata, ezért nem elsődleges követelmény. A meglévő Prisma modellek
megmaradhatnak későbbi használatra, de nem tekintendők elkészült modulnak.

### M4.5A – Purchase Invoice alapú EU-s bevételezés – DONE első iteráció

- beszállítói számlaszám és belső `BESZ-*` bizonylatszám;
- beszállító és célfőraktár;
- számla kelte, határidő, fizetettség és fizetési dátum;
- deviza és kézi/automatikus árfolyam;
- rendelt és tényleges átvett mennyiség;
- nettó egységár és kedvezmény;
- ugyanazon termék több sorának halmozott készlethatása;
- `PURCHASE_RECEIPT` StockMovement és StockItem növelés;
- Product Extension utolsó beszerzési ár, pénznem és preferált beszállító;
- UNAS `setStock` soronkénti siker/hiba;
- lista, új EU-s számla és részletoldal;
- duplikált beszállítói számlaszám elleni egyediség;
- **(2026-07-24)** terméktörzsben nem szereplő tétel is felvehető
  (`variantId` opcionális, `sourceDescription`+egység kötelező,
  `syncStatus: NOT_LINKED`, kihagyva a készlet- és UNAS-szinkronból).

### M4.5B – Purchase Invoice folytatás — belföldi bevételezés DONE első iteráció

- ~~belföldi kézi, ÁFA-kulcsos rögzítés~~ — **DONE (2026-07-24)**: az EU-s
  űrlap deviza+árfolyam mezője helyett HUF+ÁFA-kulcs (alapértelmezett 27%,
  felülírható);
- ~~NAV Online Számlából történő bejövőszámla-betöltés~~ — **DONE első
  iteráció (2026-07-24)**: "NAV számla lekérés" menüpont
  (`/beszerzes/nav-szamlak`), digest (`queryInvoiceDigest`) + teljes adat
  (`queryInvoiceData`) lekérdezés, kézi és env-kapcsolt időszakos szinkron,
  "Bevételezés" gomb a közös bevételező űrlapra ugrik előtöltött
  adatokkal;
- **még nyitva:**
  - NAV-sorok soronkénti formális termékvariáns-egyeztetése (jelenleg
    minden NAV-sor manuális/`NOT_LINKED` sorként kerül be, a felhasználó
    írja át saját terméknevekre);
  - a NAV digest `MODIFY`/`STORNO` láncának kezelése (v1 csak
    `CREATE`-tételeket dolgoz fel);
  - rendelt/tényleges eltérés jelzés és jóváhagyás;
  - elutasított/sérült mennyiség;
  - polchely;
  - tartós outbox alapú UNAS készletszinkron;
  - fizetési státusz későbbi pénzügyi egyeztetése;
  - jóváírás és beszállítói visszáru.

**Fontos irányváltás (2026-07-24, lásd 6.0A és 11. döntés #6):** a
tulajdonos megerősítette, hogy a **számlanyilvántartás** (M8.4, a teljes
bejövő/kimenő számlaregiszter) elsődleges szinkronforrása a Számlázz.hu
lesz, nem a NAV. A fenti, itt leírt NAV-alapú funkció a **bevételezési**
workflow segédlete marad (a beérkezett áru rögzítéséhez), nem azonos a
számlanyilvántartás M8-cel tervezett Számlázz.hu-szinkronjával. A két
folyamat viszonyát (marad-e párhuzamosan mindkettő, vagy a Számlázz.hu
bejövő számla push idővel kiváltja a NAV-alapú bevételezési segédletet is)
az M8 implementációja előtti preflight/ADR-nek kell tisztáznia.

### M4.7 – MNB árfolyam

- SOAP 1.1/1.2 kliens és hétvégi/ünnepnapi visszakeresés – **IMPLEMENTED**;
- HUF esetén 1-es árfolyam – **DONE**;
- kézi árfolyam – **DONE és jelenleg elsődleges**;
- automatikus éles hívás – **BLOCKED**, az MNB F5 botvédelme miatt;
- kerülő megoldás csak hivatalos, stabil és jogszerű adatforrás alapján vezethető be.

### M4.6 – Visszaküldés beszállítónak

- bevételezésre hivatkozó visszaküldés;
- sérült/hibás/eltérő termék oka;
- készletcsökkentő mozgás;
- beszállítói jóváírás hivatkozása;
- nyitott pénzügyi eltérés.

---

## M5 – UNAS Stock Synchronization

**Állapot:** PARTIAL – leltár, POS és beszerzés készlet-visszaírása működik

### Cél

Az Acropora OS-ben számított eladható készlet biztonságos publikálása az UNAS felé.

### Funkciók

- Acropora on-hand és available készlet számítása;
- raktárak publikálási policy-ja;
- foglalások levonása;
- biztonsági készlet levonása opcionálisan;
- `in/out` relatív módosítás normál üzleti eseménynél;
- teljes készletérték csak leltár-reconciliation esetén;
- outbox/queue;
- tételenkénti idempotenciakulcs;
- retry és dead-letter állapot;
- UNAS visszaigazolás;
- helyi és UNAS stock discrepancy;
- manuális újraküldés;
- tömeges reconciliation;
- operátori hiba- és várólista.

### Már elkészült

- `UnasApiClient.setStock`;
- leltárkorrekció abszolút mennyiséggel;
- POS-eladás utáni eredő mennyiség;
- beszerzés utáni eredő mennyiség;
- soronként izolált UNAS-hiba;
- `syncStatus`/`syncError` több érintett üzleti tételen;
- `StockItem` hiányában reported stock fallback az első helyi mozgásnál.

### Production hardeninghez nyitott

- adatbázis-tranzakcióval együtt létrehozott outbox;
- worker, tartós retry és dead-letter;
- lokális írás és külső push sorrendjének biztonságossá tétele;
- automatikus újraküldés;
- teljes készlet-reconciliation;
- több raktár publikálási policy;
- monitoring és riasztás.

### Kritikus szabály

Az UNAS-ból olvasott reported stock nem írhatja felül az Acropora fizikai készletet. Eltérés esetén feladat vagy riasztás keletkezik.

---

## M6 – UNAS Order and Customer Synchronization

**Állapot:** DONE első iteráció; live contract és készletszemantika validálása nyitott

### Cél

Az UNAS-rendelések, vevőadatok és rendelésváltozások idempotens helyi tükrözése.

### M6.1 – Rendelésimport

- teljes és inkrementális lekérdezés;
- webhook, ha az UNAS támogatása és megbízhatósága igazolt;
- stabil UNAS order ID;
- rendelésfej és tételek;
- számlázási/szállítási cím;
- fizetési és szállítási mód;
- kupon, kedvezmény, szállítási díj;
- pénznem és összegek;
- rendelési megjegyzés;
- külső státusz és source timestamp;
- raw payload biztonságos megőrzése;
- duplicate import no-op.

### M6.2 – Termék- és vevőfeloldás

- SKU/external ID alapján termékpárosítás;
- ismeretlen SKU operátori hibasorba;
- magánszemély és cég kezelése;
- adószám és e-mail alapú, kontrollált vevőfeloldás;
- automatikus hibás vevő-összevonás tiltása;
- guest rendelés támogatása;
- GDPR-adatminimalizálás.

### M6.3 – Rendelésváltozások

- törlés;
- visszanyitás;
- tételváltozás;
- státuszváltozás;
- ellentétes foglalási/készletmozgási esemény;
- auditált operátori konfliktuskezelés.

### Ténylegesen elkészült rendelésoldal

- 5 perces, env-gated polling;
- `TimeModStart` cursor;
- kézi „sync now”;
- stabil ExternalReference;
- SalesOrder és tételek;
- UNAS státusz-, fizetési és szállítási adatok;
- ismeretlen SKU soronkénti `FAILED` állapottal;
- `SALE` StockMovement;
- `close_fault` esetén egyszeri `RETURN_IN`;
- helyi és reported stock discrepancy nézet;
- `/webshop` lista és `/webshop/:id` részlet.

### Ténylegesen elkészült vevőoldal

- önálló Customer/CustomerAddress modul;
- UNAS `getCustomer` inkrementális sync 120 másodperces overlap ablakkal;
- run history, scheduler, cursor és kézi admin sync;
- ExternalReference-alapú webshopos/manuális forrásjelölés.

### Nyitott validálások

- valós UNAS `getCustomer` gyökérelem;
- valódi UNAS oldali rendeléstörlés megkülönböztetése;
- annak bizonyítása, hogy a helyi SALE mozgás és az UNAS készletkezelés együtt
  nem eredményez kétszeres levonást;
- rendelésmódosítás teljes tételdiffje;
- customer merge/duplicate policy.

---

## M7 – Sales Order and Fulfilment

**Állapot:** PARTIAL – POS első iteráció és UNAS SalesOrder tükör elkészült

### Cél

Az online és kézi értékesítési rendelések egységes teljesítési folyamata.

### Funkciók

- csatornák: UNAS webshop, üzlet, telefon/e-mail, projekt/szerviz;
- rendelésállapotgép;
- termékfoglalás;
- részleges teljesítés;
- komissiózási lista;
- csomagolás és átadás;
- személyes átvétel;
- szállítási adat és nyomkövetési szám;
- kiadási készletmozgás;
- törlés és foglalásfeloldás;
- visszáru és csere;
- kézi árengedmény jogosultsággal;
- rendelési aktivitásnapló;
- nyomtatható bizonylatok;
- későbbi futárintegráció bővítési pontja.

### Értékesítési visszáru

- eredeti rendelés/számla hivatkozása;
- visszavett mennyiség;
- visszatehető, karantén vagy selejt állapot;
- készletmozgás;
- pénzvisszatérítés/jóváírás státusz;
- Számlázz.hu helyesbítő vagy sztornó folyamat.

### Elkészült POS-funkciók

- termékkeresés SKU, név és vonalkód alapján;
- aktuális UNAS bruttó ár, ÁFA és legjobb ismert készlet;
- szerkeszthető kosármennyiség és bruttó egységár;
- készpénz, bankkártya és átutalás;
- nettó/ÁFA/bruttó számítás;
- anonim értékesítés, opcionális Customer kapcsolat az adatmodellben;
- negatív készlet figyelmeztetéssel;
- helyi készletcsökkentés és UNAS push;
- napi eladási lista;
- eladáslista/részlet és receipt-szerű nézet;
- `invoiceRequested` előkészítő mező a későbbi számlázáshoz.

### Nyitott POS- és fulfilment-funkciók

- vevő kiválasztása a már elkészült Customer modulból;
- nyugta/számla tényleges kiállítása;
- pénztárnyitás/zárás és kasszaegyeztetés, ha szükséges;
- visszáru és csere;
- kedvezményjogosultság és árváltoztatási audit;
- komissiózás, csomagolás, shipment és tracking;
- foglalás és részleges teljesítés.

---

## M8 – Számlázz.hu Integration and Invoice Registry

**Állapot:** COMMITTED — **kiválasztott következő fő irány (2026-07-24)**

### Cél

A kimenő számlázás automatizálása, valamint a bejövő és kimenő számlák teljes
helyi nyilvántartása, **Számlázz.hu-t elsődleges szinkronforrásként
használva; a NAV Online Számla csak napi teljességi/eltérés-ellenőrzés
(M9), nem elsődleges adatforrás** — 2026-07-24-én megerősített irány, lásd
6.0A és 11. döntés #6.

### M8.1 – Számlázz.hu Connection Settings

- Agent kulcs és pénzügyi adatkapcsolati kulcs elkülönített kezelése;
- titkosított credentialtárolás;
- masked UI;
- kapcsolatellenőrzés;
- jogosultság és audit;
- környezeti fallback és kulcsrotáció.

### M8.2 – Kimenő automatikus számlázás

1. rendelés számlázható állapotba kerül;
2. Acropora OS idempotens invoice requestet hoz létre;
3. kötött sorrendű Számlázz.hu XML készül;
4. worker elküldi a kérést;
5. válaszból számlaszám, PDF és hivatkozás mentődik;
6. UNAS rendelésben számlastátusz, szám és URL visszaíródik;
7. UNAS-visszaírás hibája esetén csak a visszaírás ismétlődik;
8. új számla ugyanarra az idempotenciakulcsra nem készülhet.

### Támogatandó bizonylatok

- számla;
- előlegszámla;
- végszámla;
- sztornó;
- helyesbítő/jóváíró;
- díjbekérő opcionálisan;
- nyugta külön későbbi döntés alapján.

### M8.3 – Online pénzügyi adatkapcsolat

Külön fogadó végpontok:

```text
POST /api/integrations/szamlazz/outgoing-invoices
POST /api/integrations/szamlazz/incoming-invoices
```

Követelmények:

- `application/xml`, UTF-8;
- `X-Szamlazzhu-Key` ellenőrzése;
- XML/XSD validáció;
- megfelelő kimenő és bejövő namespace;
- Számlázz.hu belső `<alap><id>` alapján idempotens upsert;
- egy számla ismételt teljes adatcsomagját update-ként kezelni;
- HTTP 200 és előírt válasz-XML;
- válaszban az eredeti Számlázz.hu ID;
- Acropora iktatószám opcionális visszaadása;
- nyers XML biztonságos megőrzése;
- opcionális Base64 PDF dekódolása és objektumtárba mentése;
- payloadméret-korlát és biztonságos XML parser;
- XXE és entity expansion tiltása;
- feldolgozási és hibaaudit.

**Kapcsolódási pont a NAV-alapú bevételezéssel:** a `POST
.../incoming-invoices` végpont potenciálisan ugyanazt a bejövő számla adatot
szolgáltatja, mint amit a 2026-07-24-én épített NAV `queryInvoiceDigest`/
`queryInvoiceData` a belföldi bevételezési (`/beszerzes/nav-szamlak`)
folyamathoz letölt. Az M8 implementációja előtt tisztázandó, hogy a két
forrás hogyan viszonyul egymáshoz a bevételezési workflow-ban (lásd M4.5B
záró bekezdése és a 10. fejezet).

### M8.4 – Számlanyilvántartás

- bejövő/kimenő irány;
- bizonylattípus;
- számlaszám és külső belső ID;
- szállító/vevő;
- kelte, teljesítés, határidő;
- pénznem és árfolyam;
- nettó, áfa, bruttó;
- áfakulcsonkénti összesítés;
- tételek;
- hivatkozott számla;
- sztornó/helyesbítő lánc;
- fizetettség;
- PDF és eredeti XML;
- forrás: Számlázz.hu, NAV, kézi, import;
- iktatási és könyvelési státusz;
- címkék és megjegyzés;
- keresés, szűrés és export.

### M8.5 – Visszamenőleges betöltés

- kezdődátum megadása a Számlázz.hu kapcsolat aktiválásakor;
- bulk backfill biztonságos feldolgozása;
- progress és hibasor;
- duplikációmentes újrafuttatás;
- egyeztetési riport.

---

## M9 – NAV Online Számla Reconciliation

**Állapot:** PARTIAL alapintegráció — `queryTaxpayer` és a belföldi
bevételezéshez épített `queryInvoiceDigest`/`queryInvoiceData` NAV-kliens
elkészült; **önálló, M8-cal szembeni napi egyeztető reconciliation (a
tényleges cél e mérföldkőnél) még nincs**

### Cél

Nem elsődleges napi adatforrás, hanem független teljességi és eltérésellenőrzés — **ez a szerep 2026-07-24-én megerősítést nyert az M8/M9 munkamegosztás részeként (lásd 6.0A)**.

### Funkciók

- NAV technikai felhasználó biztonságos kezelése — **DONE** (`NavCredentialsService`, közös a `queryTaxpayer`-rel és a belföldi bevételezéssel);
- Online Számla API 3.0 hitelesítés — **DONE**;
- `queryInvoiceDigest` INBOUND és OUTBOUND — **DONE INBOUND-ra** (a belföldi bevételezéshez épült, OUTBOUND irány M9-hez még nyitott);
- `queryInvoiceData` részletes adat — **DONE** (ugyanazon build része);
- időablakos, átfedő inkrementális lekérdezés — **DONE** (`NavInvoiceSyncRun`, 120s overlap, a UNAS vevőszinkron mintáját követve);
- lapozás és cursor — **DONE**;
- módosító és sztornólánc — **NOT STARTED** (a belföldi bevételezés v1 szándékosan kihagyja, lásd M4.5B);
- Számlázz.hu/Acropora számlával történő párosítás — **NOT STARTED**, ez az M8 utáni tényleges M9-munka;
- NAV-ban megvan, Acroporában nincs — **NOT STARTED**;
- Acroporában megvan, NAV-ban nincs — **NOT STARTED**;
- összeg-, adószám-, dátum- vagy státuszeltérés — **NOT STARTED**;
- operátori egyeztetési lista — **NOT STARTED**;
- napi automatikus futás — **RÉSZBEN** (a belföldi bevételezési szinkron env-kapcsolt időszakos futása megvan, de célja jelenleg a bevételezés, nem az egyeztetés);
- NAV XML nem tekintendő automatikusan eredeti számla-PDF-nek — elv rögzítve.

### Kritikus korlát

Külföldi és NAV-nak nem jelentett számlák teljessége nem ellenőrizhető kizárólag NAV-adatból.

### Már elkészült NAV-képesség

- szerveroldali NAV Online Számla kliens;
- SHA-512 technikai felhasználói jelszóhash;
- SHA3-512 request signature;
- `queryTaxpayer`;
- adószám alapján cégnév és számlázási cím előtöltése;
- böngésző felé secret- és raw-response-mentes szerződés;
- **(2026-07-24)** `queryInvoiceDigest`/`queryInvoiceData` INBOUND irányra,
  a belföldi bevételezési folyamat részeként — technikailag újrahasznosítható
  M9-hez, de jelenleg más célt szolgál (bevételezés, nem egyeztetés).

Ez nem azonos a bejövő/kimenő számlák **egyeztetési** (M9 tényleges cél)
funkciójával — az `queryInvoiceDigest`/`queryInvoiceData` alapok megvannak,
de a Számlázz.hu-val való párosítás, eltérés-lista és operátori egyeztetés
az M8 után kezdhető munka.

---

## M10 – Financial Operations and Bank Reconciliation

**Állapot:** PROPOSED

### Cél

Számlák, banki tranzakciók és kifizetések operatív egyeztetése könyvelőprogram kiváltásának ígérete nélkül.

### M10.1 – Kötelezettség és követelés nézet

- nyitott bejövő számlák;
- nyitott kimenő számlák;
- lejárt tételek;
- részfizetés;
- túlfizetés;
- fizetési határidő szerinti lista;
- beszállító/vevő szerinti egyenleg;
- devizás összegek.

### M10.2 – Banki tranzakcióimport

Lehetséges források külön üzleti döntéssel:

- Számlázz.hu Autokassza/pénzügyi adatkapcsolat;
- banki export;
- későbbi közvetlen banki API;
- OTP eBIZ kapcsolódás, ha a technikai lehetőség igazolt.

### M10.3 – Párosítás

- számlaszám a közleményben;
- partner bankszámla;
- összeg és pénznem;
- határidőközeli dátum;
- egy tranzakció–egy számla;
- egy tranzakció–több számla;
- több tranzakció–egy számla;
- automatikus javaslat, emberi jóváhagyás;
- bizonytalansági szint;
- feloldás és újrapárosítás auditja.

### M10.4 – Utalási javaslat és export

- esedékes bejövő számlák kiválasztása;
- kedvezményezett és bankszámla ellenőrzése;
- jóváhagyási workflow;
- bank által támogatott utalási fájl/jegyzék;
- OTP eBIZ-kompatibilis export csak hivatalosan igazolt formátum alapján;
- Acropora OS önállóan ne indítson utalást külön erős jóváhagyás nélkül.

### Korlát

Ez a modul operatív pénzügyi nyilvántartás. Főkönyvi könyvelést, adóbevallást és jogszabályi beszámolót csak külön, szakértővel validált projektben szabad vállalni.

---

## M11 – Customer and CRM

**Állapot:** PARTIAL – alaptörzs, címek, létrehozás és UNAS sync elkészült

### Funkciók

- magánszemély és cég;
- ügyfélszám;
- név, cégnév és adószám;
- e-mail és telefon;
- több cím;
- kapcsolattartók;
- aktív/archivált állapot;
- rendelés-, számla-, akvárium- és szervizkapcsolatok;
- kommunikációs megjegyzések;
- belső címkék;
- ügyfél-idővonal;
- duplikációjelzés;
- kontrollált összevonás;
- marketing e-mail és SMS hozzájárulás;
- hozzájárulás története;
- adatletöltési és törlési/anonymizálási workflow;
- hozzáférési audit.

### Elkészült

- `/vevok` lista partnerkóddal, címmel és forrással;
- `/vevok/uj` manuális létrehozás;
- személy/cég típus;
- NAV cégadat-lookup;
- számlázási és külön szállítási cím;
- „szállítási cím megegyezik” workflow;
- irányítószám alapján best-effort városkitöltés;
- backend részlet és update;
- `customers.view` és `customers.manage`;
- UNAS vevőszinkron.

### Nyitott

- tényleges webes szerkesztő UI meglévő vevőhöz;
- kapcsolattartók;
- jegyzetek;
- címkék;
- timeline;
- duplikációjelzés és kontrollált merge;
- GDPR workflow;
- hivatalos vagy saját irányítószám-adatforrás.

---

## M12 – Aquarium Registry and Water Measurements

**Állapot:** COMMITTED

### M12.1 – Akváriumtörzs

- saját, ügyfél- és bemutató akvárium;
- akváriumszám és név;
- ügyfélkapcsolat;
- méretek és rendszertérfogat;
- helyszín;
- karbantartjuk-e;
- felelős munkatárs;
- aktív/archivált;
- rendszerleírás;
- berendezések és telepítési adatok későbbi bővítése.

### M12.2 – Vízmérések

- teszt időpontja;
- teszt helye;
- forrás: `shop`, `user`, `onsite`;
- mérő személy;
- hőmérséklet;
- pH;
- sótartalom/sűrűség;
- KH;
- kalcium;
- magnézium;
- nitrát;
- foszfát;
- nitrit;
- ammónia/ammónium;
- szilikát;
- réz;
- kálium;
- stroncium;
- jód;
- paraméterenkénti mértékegység;
- cél-, minimum- és maximumérték;
- megjegyzés;
- trend és eltérésjelzés;
- történeti grafikon;
- manuális és importált mérés megkülönböztetése.

### M12.3 – Mérési minőség

- hiányzó és nem mérhető érték külön kezelése;
- mérési módszer vagy tesztkészlet opcionális rögzítése;
- mértékegység-konverzió;
- módosítási audit;
- hibás mérés érvénytelenítése törlés helyett.

---

## M13 – ICP Report Processing

**Állapot:** COMMITTED

### Cél

Fauna Marin, Triton és ATI ICP-riportok egységes feldolgozása.

### Funkciók

- PDF vagy támogatott export feltöltése;
- fájlhash és duplikációellenőrzés;
- labor és formátum felismerése;
- mintavételi és riportdátum;
- akváriumhoz rendelés;
- elemek és értékek strukturált kinyerése;
- mértékegység-normalizálás;
- labor referencia-, minimum-, maximum- és célérték;
- parser confidence;
- bizonytalan mezők emberi ellenőrzése;
- eredeti fájl biztonságos tárolása;
- trend és előző riporttal összehasonlítás;
- eltérések kategorizálása;
- felhasználói jóváhagyás után véglegesítés;
- új laborformátum plugin-szerű bővíthetősége.

### Biztonsági követelmények

- PDF-tartalom nem kerül naplóba;
- fájlfeltöltés méret- és típuskorlátos;
- rosszindulatú fájlok kezelése;
- parser nem írja felül kézi mérést;
- nyers és normalizált adat külön marad.

---

## M14 – Service, Maintenance and Field Work

**Állapot:** COMMITTED alapséma, PROPOSED teljes workflow

### Funkciók

- szervizmunka-szám;
- ügyfél és akvárium;
- cím/helyszín;
- cím, leírás és prioritás;
- állapot: új, tervezett, folyamatban, várakozik, kész, számlázott, lezárt;
- felelős munkatárs;
- tervezett kezdés és időtartam;
- ismétlődő karbantartás;
- checklist/sablon;
- helyszíni mérés;
- felhasznált termék és készletkiadás;
- munkaidő;
- kilométer/utazási költség;
- fénykép és dokumentum;
- ügyfél-megjegyzés és belső megjegyzés;
- aláírás vagy teljesítésigazolás opcionálisan;
- következő karbantartási időpont;
- számlázási előkészítés;
- mobilbarát helyszíni használat;
- offline mód csak külön műszaki mérföldkőként.

---

## M15 – Projects, Quotations and Aquarium Builds

**Állapot:** PROPOSED

### Cél

Egyedi akváriumépítési, dekorációs és intézményi projektek kezelése.

### Funkciók

- ajánlatkérés;
- ajánlat és verziók;
- ügyfél és helyszín;
- projektfázisok;
- költségbecslés;
- termék-, anyag-, munka- és alvállalkozói tételek;
- jóváhagyás;
- előleg és mérföldkő alapú számlázás;
- beszerzési igény;
- projektkészlet;
- feladatok és határidők;
- dokumentumok, tervek és fényképek;
- változáskezelés;
- átadás-átvétel;
- garanciális feladat;
- projekt eredményességi riport.

---

## M16 – Tasks, Notifications and Workflow Inbox

**Állapot:** PROPOSED

### Funkciók

- személyes és szerepkör-alapú feladatlista;
- határidő;
- prioritás;
- entitáshivatkozás;
- felelős és követő;
- emlékeztető;
- rendszer által generált feladat;
- in-app értesítés;
- e-mail/push későbbi integráció;
- olvasott/lezárt állapot;
- értesítési preferenciák;
- duplikált riasztások összevonása.

### Automatikus események példái

- UNAS sync hiba;
- készleteltérés;
- minimumkészlet alá csökkenés;
- lejárt beszerzési rendelés;
- részben bevételezett PO;
- lejárt bejövő számla;
- párosítatlan banki tranzakció;
- közelgő karbantartás;
- rendellenes vízérték vagy ICP-eredmény.

---

## M17 – Dashboards, Search, Reports and Export

**Állapot:** PARTIAL – dashboard shell és dinamikus üdvözlés elkészült

### Általános keresés

- termék/SKU/EAN;
- partner;
- rendelés;
- számla;
- beszerzési rendelés;
- bevételezés;
- szervizmunka;
- akvárium.

### Dashboardok

- értékesítési áttekintés;
- készletérték és készleteltérés;
- alacsony készlet;
- nyitott beszerzések;
- bevételezési késés;
- nyitott és lejárt számlák;
- pénzügyi egyeztetési hibák;
- integrációs állapot;
- mai és heti szervizfeladatok.

### Riportok

- készletkártya;
- készletérték;
- készletforgás;
- elfekvő készlet;
- árrés termékenként/kategóriánként;
- beszerzési ár változása;
- beszállítói teljesítés;
- értékesítés csatornánként;
- rendelésátfutás;
- szervizmunka ráfordítás;
- akvárium vízértéktrend;
- export CSV/XLSX formátumba jogosultsággal;
- riportadat forrásának és időpontjának kijelzése.

---

## M18 – Production Security and Operations

**Állapot:** COMMITTED, a production indulás előtt kötelező

### M18.1 – Production Authentication

- valódi auth provider;
- MFA;
- biztonságos session;
- session visszavonás;
- account lockout/rate limit;
- jelszó-visszaállítás, ha releváns;
- admin felhasználó- és szerepkörkezelés;
- inaktív felhasználó azonnali tiltása.

### M18.2 – Security

- HTTPS;
- CSRF, XSS és security header policy;
- XML XXE védelem;
- fájlfeltöltés-védelem;
- input validation;
- secret manager vagy titkosított tárolás;
- kulcsrotáció;
- személyes adat naplózásának tiltása;
- dependency és container security scan;
- jogosultságtesztek minden érzékeny végpontra.

### M18.3 – Observability

- strukturált log;
- correlation ID;
- request és job metrikák;
- queue depth;
- integration lag;
- health/readiness/liveness;
- hiba-riasztás;
- auditkereső;
- secret- és PII-redaction.

### M18.4 – Backup and Recovery

- automatizált PostgreSQL backup;
- objektumtár backup/policy;
- restore próba;
- RPO/RTO célérték;
- migrációs rollback vagy forward-fix stratégia;
- incidens-runbook;
- audit- és pénzügyi adatok megőrzése.

### M18.5 – Deployment

- dev/staging/production elkülönítés;
- környezeti konfiguráció;
- migrációs release gate;
- zero/low-downtime elvek;
- rollback;
- verzió és buildazonosító;
- production smoke test.

---

## M19 – Mobile and External API

**Állapot:** OPTIONAL

### Lehetséges scope

- reszponzív PWA elsőként;
- raktári vonalkódos nézet;
- helyszíni szerviznézet;
- vízmérés gyorsrögzítés;
- fotófeltöltés;
- push értesítés;
- későbbi natív app csak igazolt igény esetén;
- külső API-kulcsok és scoped permissionök;
- webhookok;
- rate limit és audit;
- Acropora Tools alkalmazással kontrollált adatkapcsolat.

---

# 7. Keresztmetszeti követelmények

## 7.1 Audit

Auditálandó legalább:

- credential változtatás;
- jogosultságváltozás;
- master data módosítás;
- Product Extension változás;
- postolás és ellenmozgás;
- leltárlezárás;
- PO jóváhagyás;
- bevételezés;
- számlázás;
- fizetési párosítás;
- ügyféladat-összevonás;
- mérés érvénytelenítése;
- export.

Az audit ne másoljon secretet, teljes raw payloadot vagy szükségtelen személyes adatot.

## 7.2 Idempotencia

Minden külső import és export rendelkezzen:

- stabil provider + operation + aggregate identity értékkel;
- egyedi idempotenciakulccsal;
- request/payload hash-sel, ahol indokolt;
- no-op változatlan újrafuttatással;
- retry-számlálóval;
- kontrollált végleges hibával;
- operátori újraindítás lehetőségével.

## 7.3 Pénz és mennyiség

- pénz: `Decimal(19,4)` vagy indokolt nagyobb pontosság;
- készletmennyiség: `Decimal(19,6)`;
- ICP: szükség szerint `Decimal(19,8)`;
- pénznem explicit ISO 4217 kód;
- árfolyam és forrás/időpont rögzítése;
- JavaScript `number` ne legyen pénzügyi számítás forrása.

## 7.4 Dátum és idő

- adatbázisban UTC;
- UI-ban Europe/Budapest szerinti megjelenítés;
- külső rendszer időzónája explicit;
- üzleti dátum és technikai timestamp külön mező.

## 7.5 Dokumentumok

- fájlok objektumtárban, nem adatbázisblobként, ha nincs erős ellenindok;
- adatbázisban metadata, hash, MIME, méret és storage key;
- jogosultságellenőrzött letöltés;
- vírus/malware ellenőrzési bővítési pont;
- megőrzési és törlési szabály.

## 7.6 UI

- magyar nyelv;
- egyértelmű source-of-truth jelölés;
- read-only és szerkeszthető blokkok vizuális elkülönítése;
- mentés és postolás megkülönböztetése;
- veszélyes művelet explicit megerősítése;
- tömeges művelet kijelöléshez kötve;
- betöltési, üres, hiba- és részleges sikerállapot;
- billentyűzetes és mobilbarát operátori használat.

## 7.7 Hozzáférés

- UI-elrejtés önmagában nem biztonsági kontroll;
- minden védett művelet API permissiont igényel;
- lehető legkisebb jogosultság;
- érzékeny export és credential kizárólag külön permissionnel;
- ownership és tenant határ előkészítése akkor is, ha kezdetben egy cég használja.

---

# 8. Javasolt végrehajtási sorrend

## Fázis A – Stabil termék- és integrációs alap

1. M2.1 és M2.2 – **DONE**.
2. M2.3 hátralévő monitoring/riasztás.
3. M1 production authentication minimumának megtervezése.

## Fázis B – Készlet és beszerzés

4. M3 leltármag – **DONE**, általános mozgások és több raktár folytatása.
5. M4 EU-s és belföldi Purchase Invoice – **DONE első iteráció mindkét irányban**, per-line NAV variant-egyeztetés és MODIFY/STORNO kezelés nyitva.
6. M5 közvetlen UNAS stock push – **DONE első iteráció**, outbox hardening.

## Fázis C – Értékesítés

7. M6 UNAS Order and Customer Synchronization – **DONE első iteráció**.
8. M7 POS – **DONE első iteráció**, fulfilment folytatás.
9. M8 Számlázz.hu Integration and Invoice Registry — **kiválasztott aktuális irány (2026-07-24)**.

## Fázis D – Pénzügyi kontroll

10. M9 NAV Reconciliation — az M8 után, a Számlázz.hu-val párosítva.
11. M10 Bank Reconciliation és utalási javaslat.

## Fázis E – Acropora-specifikus működés

12. M11 Customer/CRM.
13. M12 Aquarium and Measurements.
14. M13 ICP Processing.
15. M14 Service and Maintenance.
16. M15 Projects and Quotations.

## Fázis F – Hatékonyság és éles üzem

17. M16 Tasks and Notifications.
18. M17 Dashboards and Reports.
19. M18 Production Security and Operations.
20. M19 Mobile/External API, ha igazolt az igény.

---

# 9. Függőségi térkép

| Mérföldkő | Kötelező előzmény |
|---|---|
| M2.2 | M0, M1, M2.1 |
| M2.3 | M2.1, M2.2 |
| M3 | M0, M1, Product mirror |
| M4 | M3 alapok, Product Extension |
| M5 | M3, M4 bevételezés, M2 UNAS kapcsolat |
| M6 | M2 UNAS kapcsolat, Product mirror |
| M7 | M3, M6 |
| M8 | M6/M7 a rendelésalapú számlázáshoz; registry önállóan is kezdhető |
| M9 | M8 számlanyilvántartás |
| M10 | M8; banki párosításhoz tranzakcióforrás |
| M11 | M1 |
| M12 | M11 |
| M13 | M12 |
| M14 | M11, M12; készletfelhasználáshoz M3 |
| M15 | M4, M7, M8, M11, M14 |
| M16 | érintett domainmodulok |
| M17 | érintett domainmodulok és stabil riportprojekciók |
| M18 | folyamatosan, production előtt teljes egészében |

---

# 10. Következő javasolt AI-feladat

**2026-07-24-i frissítés:** az alábbi eredeti A opció (belföldi beszerzés
folytatása) **elkészült** ugyanezen a napon, lásd 6.0/6.0A és M4.5B. A
tulajdonos emellett explicit döntést hozott: a következő fő irány a **B
opció (Számlázz.hu)**, azzal a megerősített kiegészítéssel, hogy a NAV
Online Számla marad az elsődleges bejövő/kimenő számlaszinkron-forrás
szerepéből kizárva, kizárólag napi ellenőrzésre szolgál.

### B – Számlázz.hu pénzügyi adatkapcsolat — **AKTUÁLIS IRÁNY**

> Készíts külön specifikációt és ADR-t a Számlázz.hu bejövő/kimenő push
> adatkapcsolathoz, mielőtt bármilyen séma- vagy kódváltoztatás történne.
> Első körben csak a fogadó szerződés, biztonsági modell, idempotencia,
> invoice registry adatmodell és tesztstratégia készüljön el. Éles végpont
> vagy credential használata külön jóváhagyást igényel.
>
> A spec kifejezetten térjen ki arra, hogyan viszonyul a Számlázz.hu bejövő
> számla push (M8.3) a 2026-07-24-én elkészült NAV-alapú belföldi
> bevételezési segédlethez (`/beszerzes/nav-szamlak`) — marad-e mindkettő
> párhuzamosan (NAV = bevételezési segédlet, Számlázz.hu = számlanyilván-
> tartás elsődleges forrása), vagy a Számlázz.hu idővel kiváltja a NAV-ot a
> bevételezésben is. Ez nyitott kérdés, amit implementáció előtt a
> tulajdonossal tisztázni kell.

### C – Production auth

> A meglévő User/passwordHash/admin user management alapjára építve készíts
> production hitelesítési specifikációt és implementációt biztonságos sessionnel,
> jelszavas loginnal, rate limittel, session visszavonással és productionben
> tiltott development login biztos kizárásával.

Egy munkamenetben csak egy kiválasztott csomag készülhet. Mindkét fennmaradó
esetben (B, C) először read-only preflight szükséges a friss `main` ágon.

---

# 11. Nyitott üzleti döntések

Ezeket az implementáció előtt a tulajdonosnak külön jóvá kell hagynia:

1. Mely raktárak készlete publikálódjon az UNAS-ba?
2. Engedélyezett-e negatív készlet, és mely szerepkörnek?
3. Melyik költségszámítás szükséges: utolsó beszerzési ár, mozgóátlag, FIFO vagy más?
4. Kell-e lot/lejárat/serial kezelés, és mely termékköröknél?
5. Kell-e a Számlázz.hu PDF minden számlához, és mennyi ideig őrizzük?
6. ~~A Számlázz.hu marad-e az elsődleges bejövőszámla-forrás, NAV napi reconciliation mellett?~~ — **DÖNTVE (2026-07-24): igen**, Számlázz.hu elsődleges, NAV csak napi ellenőrzés. Nyitva marad ugyanakkor, hogy ez a döntés mennyiben érinti a NAV-alapú bevételezési segédletet (lásd M4.5B, M8.3, 10. fejezet).
7. Mely banki adatforrást használjuk?
8. Kell-e OTP eBIZ utalási jegyzék/export, és milyen hivatalos formátumban?
9. Milyen production identity provider legyen?
10. Mely riportok szükségesek az első éles verzióhoz?
11. Az akvárium/szerviz modul belső használatú lesz, vagy az Acropora Tools ügyfélalkalmazással is összekapcsolódik?
12. Mely modulok alkotják a legkisebb éles MVP-t?

---

# 11A. Repository audit trail

A státuszok meghatározásakor figyelembe vett fő implementációs checkpointok:

| Commit/PR | Tartalom |
|---|---|
| PR #1–#3 | M1 stabilizáció, M2.1 UNAS termékszinkron, safe read-only probe |
| PR #4 | M2.2 UNAS Connection Settings backend |
| PR #5 | M2.2 admin UI |
| PR #6–#8 | valós UNAS login- és kategóriaválaszokhoz szükséges javítások |
| `4af1b2a` / PR #11 | Product Extension utolsó beszerzési ár |
| `2d9b5aa` / PR #12 | leltár/készlet-egyeztetés |
| `7655328` / PR #13 | POS |
| `e645700` / PR #14 | UNAS rendelésszinkron |
| `bebfc64` / PR #15 | admin felhasználókezelés |
| `82d1f4b` / PR #16 | leltár utáni StockItem baseline javítás |
| PR #17 | terméklista ár- és készletoszlopok |
| PR #18 | dinamikus dashboard-üdvözlés |
| `70a2b29` | Customer modul, UNAS vevősync, NAV `queryTaxpayer` |
| `ed092b3` | projektstátusz és roadmap frissítése |
| `97517a1` | EU-s Purchase Invoice/beszerzés modul |
| `235cac9` | beszerzés modul formázási checkpoint |
| `87cee32` | **(2026-07-24)** belföldi beszerzés NAV Online Számla alapon, Partnerek modul, VIES ellenőrzés, `NOT_LINKED` számlasor — helyi commit, push a sandboxból hitelesítés hiányában nem történt meg, a felhasználónak kell push-olnia vagy hitelesítést biztosítania |

Az audit során látott aktív vagy megmaradt feature/fix branchek nem jelentenek
automatikusan mainen kívüli, szükséges funkciót. A roadmap állapotát a `main`
tényleges fájljai és a merge-elt/aktuális commitok alapján kell értelmezni.

---

# 12. Ajánlott MVP-határ

Az első valóban használható belső Acropora OS kiadás javasolt tartalma:

- productionképes auth és jogosultság – **OPEN**;
- stabil UNAS terméktükör és connection settings – **DONE**;
- Product Extension – **DONE**;
- StockItem/StockMovement és leltár – **DONE első iteráció**;
- általános raktári mozgások – **OPEN**;
- beszállítótörzs – **DONE első iteráció, Partnerek modullal és VIES-ellenőrzéssel bővítve**;
- EU-s számlaközpontú bevételezés – **DONE első iteráció**;
- belföldi bevételezés – **DONE első iteráció (2026-07-24)**, NAV per-line variant-egyeztetés nyitva;
- UNAS készlet-visszaírás – **DONE első iteráció, hardening OPEN**;
- UNAS rendelésimport – **DONE első iteráció**;
- POS – **DONE első iteráció**;
- webshopos fulfilment – **OPEN**;
- Vevőtörzs és UNAS vevősync – **DONE első iteráció**;
- Számlázz.hu kimenő számlázás – **OPEN, aktuális kiválasztott irány**;
- bejövő és kimenő számlanyilvántartás – **OPEN, aktuális kiválasztott irány**;
- audit alapok – **DONE**;
- monitoring, backup és restore – **OPEN**.

Az akvárium-, ICP-, szerviz-, projekt-, fejlett pénzügyi és mobilmodul az ERP-mag stabil működése után következzen.
