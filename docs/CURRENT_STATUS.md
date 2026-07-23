# Acropora OS – Current Status

Utolsó ellenőrzés: 2026-07-23

## Repository

https://github.com/KratoBal/acropora-os

## Current milestone

M1 – First Production Import és stabilization, valamint M2.1 – UNAS Product
Synchronization és M2.2 – UNAS Connection Settings lezárva, mainbe
merge-elve. Azóta a webes admin felület önálló üzleti modulokkal bővült:
Felhasználókezelés, POS, Raktár/Leltár, UNAS webshop rendelés-szinkron, a
Vevők (Customers) modul UNAS vevő-szinkronnal és NAV Online Számla
adószám-lekérdezéssel, és legutóbb a Beszerzés modul első köre (EU-s
beérkezett számla rögzítése MNB árfolyammal).

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
- UNAS Product Synchronization (M2.1) és UNAS Connection Settings (M2.2) – részletek lent
- Felhasználókezelés (admin webes UI, `/admin/users`, `users.manage`): profil (`firstName`/`lastName`), jelszó hash, aktiválás/deaktiválás
- POS (Point of Sale) modul (`/pos`)
- Raktár és Leltár (inventory count) modul (`/raktar`, `/keszlet-egyeztetes`), `StockItem` baseline javítás leltárszámláláskor
- UNAS webshop rendelés-szinkron időszakos pollinggal (`/webshop`), UNAS státusz, fizetési és szállítási adatok megjelenítése
- Termék lista ár/készlet oszlopok, utolsó beszerzési ár mező a Product Extensionön
- Dashboard napszaknak megfelelő dinamikus üdvözlés
- `apiRequest` javítás: megszakított (AbortError) kérés többé nem jelenik meg hamis "szerver nem érhető el" hibaként
- **Vevők (Customers) modul** (`/vevok`, `customers.view` / `customers.manage`) – lásd lent
- **Beszerzés modul, EU-s számla rögzítés első köre** (`/beszerzes`,
  `purchasing.view` / `purchasing.manage`) – lásd lent

## UNAS Product Synchronization (M2.1, elkészült)

Az API adapter, canonical hash, identity-aware diff, perzisztens sync run/cursor,
tranzakciós mirror apply, a dokumentált product mezők API mappingje, a
full-snapshot missing/restore, a `State=deleted` terméklekérés, a Category
parent-fa reconciliation, valamint az UNAS-forrású ProductCategory és
ProductImage normalizált apply, a szerveroldali token-cache, az
adatbázis-szintű single-run kizárás, valamint a kézi admin sync és run-status
API, továbbá a korlátozott retry/Retry-After policy és a beragadt futásokat
felszabadító heartbeat, valamint az opt-in időzített háttérfuttatás és az
operátori sync run-history/kézi indítás webfelülete elkészült. A Product
Detail projection külön read-only UNAS mirror és Acropora Product Extension
blokkokat jelenít meg, a generikus Product írás pedig blokkolt az
UNAS-managed rekordokon.

## UNAS Connection Settings (M2.2, elkészült)

Additív `UnasConnectionSetting` Prisma modell és migráció singleton és
envelope/error-code DB CHECK constraint-ekkel; AES-256-GCM titkosítás,
verziózott env-alapú master key; fail-closed credential provider
(`DATABASE` / `ENV_FALLBACK` / `DISABLED`); revision-alapú UNAS token cache;
admin connection API mentés előtti read-only validációval, stored credential
teszttel, DB-idő alapú cooldownnal és stale-test védelemmel; production
startup validation; admin webes UI a `/admin/integrations/unas/connection`
oldalon. Részletek: [ADR-014](../adr/0014-unas-connection-settings.md) és
[M2.2 spec](./M2.2-UNAS-CONNECTION-SETTINGS.md).

## Vevők (Customers) modul – UNAS vevő-szinkron és NAV adószám-lekérdezés

Új önálló `Customer` / `CustomerAddress` domain modul (nem az UNAS
rendelésekből levezetve): lista (`Partnerkód`, `Név`, `Cím`, `Forrás`),
részletnézet, kézi "Új vevő" felvitel és szerkesztés. A Partnerkód
UNAS-forrású vevőnél a UNAS saját azonosítója, kézi felvitelnél generált
kód; a Forrás oszlop (`webshopos` / `általunk rögzített`) az
`ExternalReference` alapján számított, nem külön Customer-mező (lásd
[ADR-0009](../adr/0009-external-reference-strategy.md)).

- **UNAS getCustomer API kliens és inkrementális vevő-szinkron**: az UNAS
  Product/Order sync mintáját követő cursor/overlap (120s) inkrementális
  pull, `UnasCustomerSyncRun` run-history, env-gated időzített háttérfuttatás
  (`UNAS_CUSTOMER_SYNC_ENABLED`), kézi admin sync és run-status API
  (`POST/GET /integrations/unas/customers/sync*`).
- **NAV Online Számla `queryTaxpayer` integráció**: cégtípusú vevő
  felvitelekor adószám alapján automatikus cégnév és számlázási cím
  lekérdezés a NAV technikai felhasználón keresztül (SHA-512
  jelszóhasheléssel és SHA3-512 kérésaláírással, a NAV élesalkalmazás
  végpontján). A technikai felhasználó adatait és a nyers NAV választ a
  rendszer kizárólag szerveroldalon naplózza, sosem küldi a böngészőnek.
- **Irányítószám → város best-effort lookup**: nem hivatalos, community
  `hur.webmania.cc` API proxyzása (`/integrations/postal-code/:zip`);
  hibatűrő, sosem dob kivételt, és nem írja felül a NAV-tól már kapott
  várost.
- **Vevő szerkesztő UI** (`/vevok/uj`): cég kiválasztásakor Típus után
  adószám mező és NAV lekérdezés gomb, majd Cégnév/Kapcsolattartó,
  Email/Telefon sor; Számlázási cím blokk automatikus kitöltéssel
  (Ország – alapértelmezett Magyarország, Irányítószám → város
  automatikusan, Város, Utca/házszám, Cím kiegészítés); "Szállítási cím
  megegyezik a számlázási címmel" checkbox (alapértelmezetten bepipálva),
  kikapcsolva külön Szállítási cím blokk jelenik meg ugyanazokkal a
  mezőkkel.

Migráció: `20260722130000_add_unas_customer_sync`. Helyi futtatás előtt
szükséges: `pnpm prisma:generate` és `pnpm prisma:migrate`.

Nyitott pont: a `getCustomer` válasz gyökérelemének pontos neve
(`Customers`/`Customer`) az UNAS többi list-végpontjának konvenciója alapján
feltételezett, valós UNAS-válasszal még nincs megerősítve.

## Beszerzés modul – EU-s beérkezett számla rögzítése, első kör

A tényleges üzleti folyamatot követi, nem a `docs/DOMAIN-MODEL.md`-ben
korábban vázolt, külön rendelés-jóváhagyást feltételező `PurchaseOrder` →
`GoodsReceipt` láncot: nálunk a beérkezett beszállítói számla rögzítése maga
a bevételezés, nincs külön előzetes megrendelés-jóváhagyási lépés. Emiatt a
séma egy új, számla-központú `PurchaseInvoice`/`PurchaseInvoiceLine` párral
bővült; a régi `PurchaseOrder`/`GoodsReceipt` modellek változatlanul,
érintetlenül megmaradtak a sémában egy esetleges későbbi felhasználásra.

Ez a kör kizárólag az **EU-n belüli beszerzés** kézi rögzítését szolgálja ki
ténylegesen; a belföldi (kézi ÁFA-kulcsos, illetve NAV Online Számla
lekérdezéses) folyamat még nem indult el, lásd alább.

- **`Supplier` törzs bővítése**: adószám, ISO országkód (a "HU"-tól eltérő
  érték jelöli az EU-s beszállítót), e-mail, telefon. Új `/suppliers`
  API (`purchasing.view` / `purchasing.manage`), beágyazva a számla
  rögzítő űrlapba (keresés + soron kívüli létrehozás).
- **`PurchaseInvoice`/`PurchaseInvoiceLine` séma**: számlafej (belső
  bizonylatszám, a beszállítói számla saját száma, pénznem, MNB árfolyam,
  számla kelte, fizetési határidő, fizetve/fizetés dátuma, forrás
  EU/HU_MANUAL/HU_NAV), sor (termékvariáns, rendelt és tényleges átvett
  mennyiség, egység, egységár, kedvezmény%, UNAS szinkronállapot).
- **MNB hivatalos árfolyam automatikus lekérdezése (jelenleg nem működik
  élesben, lásd Known limitations)**: a `GetExchangeRates` SOAP végpont
  hitelesítés nélküli lekérdezése a számla kelte alapján, visszafelé néző
  ablakkal hétvége/ünnepnap miatti hiányzó jegyzésre; a frontend előtölti,
  de kézzel mindig felülírható/megadható. Az MNB oldala 2026-07-23 óta
  bot-védelemmel blokkolja a programozott SOAP-hívásokat, ezért az árfolyam
  mező a gyakorlatban kézi bevitelre szorul.
- **Tételes bevételezés**: a számla mentésekor egy tranzakcióban jön létre a
  `PurchaseInvoice`, a `PURCHASE_RECEIPT` típusú `StockMovement` és a
  `StockItem` frissítés (a leltár/POS mintájával megegyező additív logika,
  több sor is hivatkozhat ugyanarra a termékre egy számlán belül), valamint
  a `ProductExtension.lastPurchaseNetPrice`/`defaultPurchaseCurrency`/
  `preferredSupplierId` frissítése. A UNAS `setStock` push a POS/leltár
  mintáját követi: a helyi írás előtt fut le, soronkénti siker/hiba
  állapottal.
- **Admin webes UI** (`/beszerzes` lista, `/beszerzes/uj` EU-s rögzítő
  űrlap, `/beszerzes/:id` részletnézet): beszállító keresés/létrehozás,
  pénznem + MNB árfolyam, tételes termékkeresés (cikkszám/név alapján),
  rendelt mennyiség beírásakor a tényleges mennyiség automatikus előtöltése.

Migráció: `20260723120000_add_purchase_invoice`. Helyi futtatás előtt
szükséges: `pnpm prisma:generate` és `pnpm prisma:migrate`.

Nyitott pont: a rendelt és tényleges mennyiség közötti eltérés kezelése
(jelzés, jóváhagyás) szándékosan később kerül kidolgozásra; ebben a körben a
két mező egymástól függetlenül szabadon szerkeszthető.

## Next steps

Nincs kijelölt következő munkacsomag. Lehetséges további irányok: belföldi
számlarögzítés a Beszerzés modulban (kézi ÁFA-kulcsos rögzítés, majd NAV
Online Számla lekérdezés integráció), rendelt/tényleges mennyiség eltérés
jelzése és jóváhagyása, Vevő szerkesztés (update) UI,
kapcsolattartó/jegyzet/címke CRM-mezők (lásd
[backlog/domain-follow-ups.md](../backlog/domain-follow-ups.md)), valódi
jelszavas login (jelenleg development mock login, lásd
[AUTHENTICATION.md](./AUTHENTICATION.md)).

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
- Dashboard: http://localhost:3000/
- Webshop (UNAS rendelések): http://localhost:3000/webshop
- POS: http://localhost:3000/pos
- Termékek: http://localhost:3000/products
- Vevők: http://localhost:3000/vevok
- Beszerzés: http://localhost:3000/beszerzes
- Új EU-s beszerzési számla: http://localhost:3000/beszerzes/uj
- Raktár: http://localhost:3000/raktar
- Készlet-egyeztetés: http://localhost:3000/keszlet-egyeztetes
- Felhasználók: http://localhost:3000/admin/users
- Márkák: http://localhost:3000/admin/brands
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
- Vevő szerkesztés (update) UI még nincs, csak létrehozás; a backend `update` végpont már készen áll.
- A NAV adószám-lekérdezés és az UNAS vevő-szinkron éles hitelesítő adatok nélkül nem tesztelhető helyben.
- Az irányítószám → város lookup nem hivatalos, harmadik féltől származó API-ra épül; kimenete nem tekinthető hatóságilag hitelesnek.
- A Beszerzés modul jelenleg csak az EU-s kézi számlarögzítést szolgálja ki; a belföldi (kézi ÁFA-kulcsos és NAV-lekérdezéses) folyamat nincs implementálva.
- **Az MNB automatikus árfolyam-lekérdezés jelenleg nem működik**: az `arfolyamok.asmx` élesben (2026-07-23-i teszt szerint) F5 bot-védelemmel válaszol minden POST SOAP-hívásra (`TS...` cookie, `Clear-Site-Data` fejléc, üres törzsű 404 - feltehetően TLS-ujjlenyomat alapú szűrés, kóddal nem megkerülhető). A kliens/szolgáltatás implementálva marad (SOAP 1.1 és 1.2 megpróbálása, szerveroldali naplózás), de gyakorlatilag mindig a kézi megadásra visszaeső hibaágat futtatja; az űrlapon az árfolyam mező emiatt elsődlegesen kézi bevitelre való.
- A rendelt/tényleges mennyiség közötti eltérés jelzése és jóváhagyása szándékosan még nincs kidolgozva.

## Important constraints

- Az `acropora-pre-m1.sql` fájlt nem szabad módosítani vagy commitolni.
- Valós importexport, adatbázis-dump, secret vagy személyes adat nem kerülhet Gitbe.
- Commit és push csak külön jóváhagyással történhet.
