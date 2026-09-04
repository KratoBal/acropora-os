# Acropora OS – Current Status

Utolsó ellenőrzés: 2026-08-18

## Hogyan készült ez a dokumentum

A 2026-07-31 és 2026-08-17 közötti szakaszt a `git log` alapján
rekonstruáltuk, nem emlékezetből és nem a dokumentum korábbi állapotából. A
kiindulópont a `ba504a3` commit (`#39`, projektkészlet-foglalás), mert a
dokumentum eddig bezárólag volt naprakész; azóta **29 pull request**
került a `main` ágba, **30 commitban**.

A két szám azért tér el, mert a `#46` nem squash-merge-dzsel érkezett:
egy merge commit és egy saját commit tartozik hozzá. A `#62` pedig nem
található a `main` ágban.

Két dolgot érdemes tudni az olvasáshoz:

- **A „beolvasztva" és az „élesben fut" nem ugyanaz.** A git csak azt
  mondja meg, mi került a `main` ágba. Hogy egy adott változás benne
  van-e a futó production image-ben, abból nem derül ki: a repository
  nem tartalmaz release tageket és changelogot. Ahol az alábbiakban nincs
  külön megjegyzés, ott az állítás **beolvasztásra** vonatkozik.
- Amit a commitokból nem lehetett eldönteni, az `[KITÖLTENDŐ]` jelölést
  kapott. Ezeket ki kell tölteni, nem kitalálni.

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

Az azóta beolvasztott munkát a
[2026-07-31 óta beolvasztva](#2026-07-31-óta-beolvasztva-git-log-alapján)
szakasz sorolja fel: UNAS készlet- és rendelés-javítások, mobil
alkalmazás, POS kedvezmények, Foxpost elszámolás, szerviz eszközkezelés,
személyes feladattábla gépi ingesttel, repository-higiénia és a
termék-vonalkódok írási útja.

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
- Product provenance és Product Master authority alapok:
  `Product.origin` (`UNAS`/`LOCAL`), `Product.catalogAuthority`
  (`UNAS`/`ACROPORA`), helyi létrehozás `createdById` auditja, determinisztikus
  expand/backfill migráció és termékeredet badge a listán/részleten
- Dashboard napszaknak megfelelő dinamikus üdvözlés
- `apiRequest` javítás: megszakított (AbortError) kérés többé nem jelenik meg hamis "szerver nem érhető el" hibaként
- **Vevők (Customers) modul** (`/vevok`, `customers.view` / `customers.manage`) – lásd lent
- **Beszerzés modul, EU-s számla rögzítés első köre** (`/beszerzes`,
  `purchasing.view` / `purchasing.manage`) – lásd lent

## 2026-07-31 óta beolvasztva (git log alapján)

Huszonkilenc pull request a `#40`--`#69` tartományból (a `#62` nem
található a `main` ágban). Témánként csoportosítva, a
commitok dátumával. Egyik sorról sem állítjuk, hogy élesben fut -- lásd
fent.

### UNAS készlet és rendelés javítások (2026-07-31 -- 2026-08-09)

- `#40` CSRF token küldése fájlfeltöltésnél és kijelentkezésnél
- `#41` catalog authority betöltése leltár-korrekció közben
- `#42` UNAS készlet-snapshot szinkron és csomagtermékek kezelése
- `#43` első teljes UNAS készlet-szinkron lefuttatása
- `#44` UNAS variánsszintű készlet
- `#45` készlet rendezése fizikailag törölt UNAS rendelésnél
- `#46` UNAS Key használata biztonságos rendelés-frissítéshez
- `#47` célzott UNAS készlet-helyreállítás publikálása
- `#48` eltávolított UNAS rendelési sorok auditja
- `#49`, `#50`, `#51` UNAS készlet-snapshot backfill és az Aquavital 250
  snapshot javítása

Migrációk: `20260731110000_add_unas_package_products_and_stock_snapshot`,
`20260731140000_add_unas_variant_inventory`,
`20260731200000_add_unas_order_deletion_reconciliation`,
`20260809130000_add_unas_order_line_removal_audit`, valamint három
backfill/korrekciós migráció (`20260809170000`, `20260809193000`,
`20260809213000`).

Új runbook: [RUNBOOK-UNAS-DELETED-ORDER-RECOVERY.md](./RUNBOOK-UNAS-DELETED-ORDER-RECOVERY.md).

### Mobil alkalmazás (2026-08-09 -- 2026-08-15)

- `#52` bejelentkezési folyamat
- `#53` webshop rendelések kezelése
- eszköz-képernyők (lista, részletek, új eszköz, QR-olvasó) a
  szerviz-eszköz körrel együtt

`[KITÖLTENDŐ]` Hol tart a mobil kiadása (store, belső terjesztés,
staging) -- a commitokból nem derül ki. Kapcsolódó dokumentum:
[HETZNER-MOBILE-STAGING.md](./HETZNER-MOBILE-STAGING.md).

### POS és beszerzés (2026-08-09)

- `#54` POS kedvezmények (soronkénti és rendelés-szintű), beszerzési
  validáció. Migráció: `20260809220000_add_pos_discounts`
- `#55` beszállítók szűrése ország szerint

### Foxpost elszámolás (2026-08-10 -- 2026-08-16)

- `#56` Foxpost Gmail-alapú elszámolás automatizálása. Migráció:
  `20260809234000_add_foxpost_gmail_settlements`
- `#57` kézi elszámolás-jóváhagyás javítása. Migrációk:
  `20260815100000_add_foxpost_manual_line_approval`,
  `20260816175300_fix_foxpost_manual_approval_index_name`

Dokumentum: [FOXPOST-GMAIL-SETTLEMENTS.md](./FOXPOST-GMAIL-SETTLEMENTS.md).
Felület: `/penzugy/foxpost`.

### Szerviz eszközkezelés (2026-08-15)

- `#58` eszközkezelés: `Asset` törzs, hierarchia, QR-token generálás és
  olvasás, események. Migráció: `20260815143000_add_service_asset_management`
- `#59` bővítés: dokumentum-csatolás, QR-csere, beszállítói tulajdon.
  Migráció: `20260815193000_enhance_service_assets`

Dokumentum: [SERVICE-ASSET-MANAGEMENT.md](./SERVICE-ASSET-MANAGEMENT.md).
Felület: `/szerviz/eszkozok`.

### Személyes feladattábla és gépi ingest (2026-08-16 -- 2026-08-17)

- `#60` személyes feladattábla a `/feladataim` oldalon. Migráció:
  `20260816175344_add_personal_tasks`
- `#61` szűkített jogkörű gépi ingest feladatokhoz, service tokennel.
  Migráció: `20260816190000_add_service_tokens`. Döntés:
  [ADR-0015](../adr/0015-service-token-machine-ingest.md)
- `#67` a service-token CLI production alakjának dokumentálása

Dokumentum: [TASKS.md](./TASKS.md).

### Repository-higiénia (2026-08-17)

- `#63` commitolt build output eltávolítása és megelőzése
- `#64` a teljes forrásfa formázása
- `#65` formázatlan commitot visszautasító pre-commit hook
- `#66` a megosztott `Textarea` komponens bevezetése az utolsó öt helyen
- `#68` annak kimondása, hogy az elromlott ellenőrzések a saját címkéjük
  ellenkezőjét csinálták

### Termék-vonalkódok (2026-08-17)

- `#69` a `ProductBarcode` írási útja: a termék-részletező oldalon
  variánsonként rögzíthető több kód, közülük egy elsődleges, plusz egy
  egyszeri CLI a SKU mezőben álló kódok átemelésére. A commit üzenete
  szerint az importáló nem írja a `sku` mezőt, kétszeri futtatás nem hoz
  létre semmit másodszor, és egyetlen hibás sor sem állítja meg a futást.

Dokumentum: [PRODUCT-BARCODES.md](./PRODUCT-BARCODES.md).

**Élesbe kerülés:** a `#69` az operátor jelzése szerint 2026-08-17-én
délelőtt lett beolvasztva, és 18:07-kor került a production image-be. Ez
az egyetlen pont, ahol az élesbe kerülés ideje ismert; ez az információ
nem a repositoryból származik.

`[KITÖLTENDŐ]` A `#40`--`#68` élesbe kerülésének ideje.

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
`catalogAuthority=UNAS` rekordokon. Az UNAS sync új rekordot explicit
`origin=UNAS`/`catalogAuthority=UNAS` értékekkel hoz létre, meglévő rekordot
pedig csak igazolt `UNAS`/`UNAS` authority esetén frissít; a generikus Product
create explicit `LOCAL`/`ACROPORA` értéket ír. A két mező az első expand
migrációban átmenetileg nullable; a production preflight után külön contract
migráció szigorítja majd őket.

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

## Beszerzés modul – EU-s és belföldi (NAV-alapú) beérkezett számla rögzítése

A tényleges üzleti folyamatot követi, nem a `docs/DOMAIN-MODEL.md`-ben
korábban vázolt, külön rendelés-jóváhagyást feltételező `PurchaseOrder` →
`GoodsReceipt` láncot: nálunk a beérkezett beszállítói számla rögzítése maga
a bevételezés, nincs külön előzetes megrendelés-jóváhagyási lépés. Emiatt a
séma egy új, számla-központú `PurchaseInvoice`/`PurchaseInvoiceLine` párral
bővült; a régi `PurchaseOrder`/`GoodsReceipt` modellek változatlanul,
érintetlenül megmaradtak a sémában egy esetleges későbbi felhasználásra.

Az EU-n belüli kézi, a belföldi kézi ÁFA-kulcsos és a NAV Online Számla
alapú folyamat ugyanazt a bevételezési modellt használja.

- **`Supplier` törzs bővítése**: adószám, ISO országkód (a "HU"-tól eltérő
  érték jelöli az EU-s beszállítót), e-mail, telefon, bankszámla-adatok
  (EU-s beszállítónál IBAN + SWIFT/BIC, belföldinél hazai formátumú
  bankszámlaszám), ügyintéző (név, telefon, e-mail) és cím (irányítószám,
  város, utca/házszám, cím kiegészítés - irányítószám → város
  best-effort automatikus kitöltéssel, mint a Vevő űrlapon). Az Ország mező
  az adószámból automatikusan meghatározott (kétbetűs EU-s adószám-előtag →
  az adott ország, betűjel nélküli/belföldi formátum → "HU"; szükség esetén
  felülírható), mind a Partnerek szerkesztőben, mind az EU-s számla űrlap
  soron kívüli beszállító-létrehozásában. Az EU-s adószámok a hivatalos VIES
  (`ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number`) REST
  szolgáltatással is ellenőrizhetők egy "VIES ellenőrzés" gombbal (mindkét
  helyen) - érvényes/érvénytelen jelzéssel és a VIES-ben nyilvántartott
  cégnév/cím megjelenítésével, ha a tagállam visszaadja; a nyers VIES
  hibaválasz csak szerveroldalon naplózódik. `/suppliers` API
  (`purchasing.view` / `purchasing.manage`) kereséssel, létrehozással és
  szerkesztéssel (`PATCH`, optimista konkurrenciakezeléssel,
  `expectedUpdatedAt` alapján) - beágyazva a számla rögzítő űrlapba
  (keresés + soron kívüli, minimális adatokkal történő létrehozás), illetve
  önálló **Partnerek** menüpontként (`/partnerek`, `/partnerek/uj`,
  `/partnerek/:id`) kereshető/szűrhető listával és teljes
  létrehozás/szerkesztés űrlappal.
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
  `preferredSupplierId` frissítése. UNAS-authority terméknél a
  készletmódosítás ugyanabban a tranzakcióban UNAS stock outbox rekordot
  hoz létre; az aszinkron worker lease/retry/backoff/dead-letter védelemmel
  küldi ki az aktuális `StockItem.onHand` értéket. ACROPORA-authority helyi
  terméknél nincs UNAS outbox.
- **Admin webes UI** (`/beszerzes` lista, `/beszerzes/uj` EU-s rögzítő
  űrlap, `/beszerzes/:id` részletnézet): beszállító keresés/létrehozás,
  pénznem + MNB árfolyam, tételes termékkeresés (cikkszám/név alapján),
  rendelt mennyiség beírásakor a tényleges mennyiség automatikus előtöltése.

- **Terméktörzsben nem szereplő tétel felvétele**: a számla soron a
  termékvariáns kiválasztása immár nem kötelező - "Kézi tétel felvétele
  (nincs a terméktörzsben)" gombbal olyan sor is felvehető, aminek nincs
  megfeleltethető `ProductVariant`-ja (pl. a számlán szereplő, de a
  terméktörzsben nem vezetett tétel). Ilyenkor a számlán szereplő megnevezés
  (`sourceDescription`) és az egység kötelező, cikkszám/termléknév nincs. A
  sor `syncStatus`-a `NOT_LINKED`, nem generál `StockMovement`/`StockItem`
  frissítést, és nem kerül be a UNAS stock outbox körbe (sem
  siker-, sem hibaszámlálóba) - kizárólag a terméktörzshöz kötött sorok
  szinkronizálódnak. A számla lista és részletnézet "Nincs terméktörzsben"
  jelzéssel jeleníti meg ezeket a sorokat.

- **Új helyi termék létrehozása számlasorból**: az ismeretlen HU_NAV,
  HU_MANUAL vagy EU sor meglévő termékhez kapcsolható, vagy név,
  mértékegység és opcionális kategória megadásával készletezett fizikai
  termékké alakítható. A belső SKU-t a backend automatikusan generálja
  `ACR-L-000001` formában, párhuzamos kérések között is egyedi
  adatbázis-szekvenciából. A `LOCAL`/`ACROPORA` termék, első variáns,
  számla, készletmozgás és audit egyetlen tranzakcióban jön létre. A sor
  `NOT_APPLICABLE` státuszú, készletre kerül, de UNAS outboxot nem kap. A
  helyi termék nem jelenik meg a POS keresőben, amíg külön POS-csatorna
  nincs számára engedélyezve.

Migráció: `20260723120000_add_purchase_invoice`,
`20260723140000_add_supplier_bank_contact_details`,
`20260723150000_add_supplier_address`,
`20260724100000_purchase_invoice_line_optional_variant`. Helyi futtatás
előtt szükséges: `pnpm prisma:generate` és `pnpm prisma:migrate`.

Nyitott pont: a rendelt és tényleges mennyiség közötti eltérés kezelése
(jelzés, jóváhagyás) szándékosan később kerül kidolgozásra; ebben a körben a
két mező egymástól függetlenül szabadon szerkeszthető.

## Belföldi beszerzés – NAV Online Számla alapú bevételezés

A belföldi beszállítói számlák bevételezését a NAV Online Számla rendszerből
letöltött adatok segítik, ugyanazt az űrlapot használva, mint az EU-s
folyamat (`/beszerzes/uj`), csak deviza+MNB árfolyam helyett HUF+ÁFA-kulcs
mezővel.

- **"NAV számla lekérés" menüpont** (`/beszerzes/nav-szamlak`,
  `purchasing.view`/`purchasing.manage`): a NAV-tól letöltött belföldi
  bejövő (INBOUND irányú) számlák listája, "Frissítés" gombbal kézi
  szinkron-indítással, illetve env-kapcsolt (`NAV_INVOICE_SYNC_ENABLED`)
  időszakos háttérfuttatással (a UNAS vevő-szinkron mintáját követve,
  `insDate`-kurzoros ablakos lekérdezéssel, 120s átfedéssel). A digest-ben
  szereplő MODIFY/STORNO műveletű tételeket a v1 szándékosan kihagyja
  (csak CREATE-tételek kerülnek be) - lásd Known limitations.
- **Lusta teljes adat lekérdezés**: a lista csak a NAV `queryInvoiceDigest`
  kivonatát tárolja; a részletnézet megnyitásakor kerül lekérdezésre és
  elparszolásra a teljes számla-XML (`queryInvoiceData`, base64+opcionális
  gzip dekódolással) - a beszállító neve/adószáma/címe, valamint a tételek
  (megnevezés, mennyiség, egység, egységár, ÁFA-kulcs).
- **"Bevételezés" gomb** a részletnézeten a bevételező űrlapra visz
  (`/beszerzes/uj?navInvoiceId=...`), előtöltve a beszállító
  keresőmezőjét/soron kívüli gyorslétrehozás mezőit (adószám alapú
  egyeztetés, nem automatikus összekapcsolás) és a tételeket (a NAV-on
  szereplő megnevezéssel, mennyiséggel, egységárral, `variantId` nélkül) -
  ezeket írja át a felhasználó a saját termékneveire és a ténylegesen
  átvett mennyiségre, mielőtt rögzíti. A számla mentésekor a NAV számla
  `RECEIVED` állapotba kerül és összekapcsolódik a létrejött
  `PurchaseInvoice`-dzsal (egy NAV számla csak egyszer vételezhető be).
- **ÁFA-kulcs egyszerűsítés**: mivel a `PurchaseInvoice` séma szándékosan
  egyetlen, számla-szintű ÁFA-kulcsot tárol (nem soronkéntit), vegyes
  ÁFA-kulcsú NAV-számlánál a form a tételek leggyakoribb kulcsával
  töltődik elő, amit a felhasználó felülírhat.
- **Belföldi kézi rögzítés**: a bevételező űrlapon "Belföldi (kézi)" forrás
  is választható NAV-előtöltés nélkül, ugyanazokkal a HUF+ÁFA-kulcs
  mezőkkel - ez zárja a korábban nyitott "belföldi kézi ÁFA-kulcsos
  rögzítés" pontot.

Migrációk: `20260724110000_add_nav_incoming_invoice` és
`20260730110000_add_nav_connection_settings`. A technikai felhasználó és a
kötelező szoftveradatok a **Beállítások → NAV** oldalon menthetők. A teljes
adatcsomag AES-256-GCM titkosítással kerül adatbázisba, visszaolvasó API
nélkül; mentés előtt a rendszer valódi `queryInvoiceDigest` hívással
ellenőrzi a hitelesítést és a "Számla lekérdezés" jogosultságot. Ehhez a
szerveren egyszer be kell állítani a
`NAV_CREDENTIAL_ACTIVE_KEY_VERSION`/`NAV_CREDENTIAL_MASTER_KEY_V*`
titkosítási kulcsot. A korábbi `NAV_TECHNICAL_USER_*` és `NAV_SOFTWARE_*`
env-készlet kompatibilis fallback marad az első UI-mentésig. Cserekulcs
nem kell, mert a rendszer nem hív `manageInvoice`/`tokenExchange`
műveletet. Az időszakos szinkront a `NAV_INVOICE_SYNC_ENABLED` kapcsolja
be, alapértelmezett intervalluma 15 perc.

## Számlázz.hu integráció – adatmodell (M8, ADR-005 spec-fázis)

2026-07-24-én a tulajdonos megerősítette (lásd
[DECISIONS.md](./DECISIONS.md) ADR-005): a bejövő/kimenő
**számlanyilvántartás** elsődleges szinkronforrása a Számlázz.hu lesz, a
NAV Online Számla csak napi, független ellenőrzésre szolgál. Hosszabb
távon a Számlázz.hu bejövő számla push a fenti NAV-alapú bevételezési
segédletet (`/beszerzes/nav-szamlak`) is ki fogja váltani, de ez **nem
azonnali** - a NAV-alapú bevételezés változatlanul üzemel, amíg ez külön
jóváhagyást nem kap.

Ebben a körben, a felhasználó explicit kérésére, **csak az adatmodell**
készült el, élő Számlázz.hu-kapcsolat vagy hitelesítő adat nélkül:

- `Invoice`/`InvoiceLine`: a teljes bejövő+kimenő számlaregiszter (irány,
  bizonylattípus, forrás, Számlázz.hu belső ID mint idempotenciakulcs,
  sztornó/helyesbítő lánc, tételek) - szándékosan **nem** azonos a
  `PurchaseInvoice`-zal, ami a fizikai bevételezés bizonylata marad;
- `SzamlazzConnectionSetting`: az `UnasConnectionSetting` mintáját követő
  kapcsolatbeállítás, de két külön titkosított credentiallel (Agent kulcs a
  kimenő számlázáshoz, pénzügyi adatkapcsolati kulcs a push-fogadáshoz),
  mert eltérő Számlázz.hu-oldali jogosultsághoz tartoznak.

Migráció: `20260724130000_add_invoice_registry_and_szamlazz_connection`.

**Nyitva, nem ebben a körben:** kapcsolatbeállítás service/UI, a
`POST /api/integrations/szamlazz/{outgoing,incoming}-invoices` fogadó
endpoint (XML validáció, XXE-védelem, idempotens upsert), a kimenő
automatikus számlázás workerje, és az, hogy a Számlázz.hu bejövő push
pontosan hogyan kapcsolódik/vált-e ki a meglévő NAV-alapú bevételezési
UI-hoz - ez utóbbi tisztázása implementáció előtt szükséges.

## Projektkészlet a bevételezésben

A beszerzési számlasorok mennyisége egy vagy több projekthez rendelhető. A
hozzárendelések összege legfeljebb a ténylegesen bevételezett mennyiség
lehet; a fennmaradó rész automatikusan normál raktárkészlet.

- `Project`: minimális projekttörzs automatikus `PRJ-000001` formátumú
  projektszámmal; a teljes M15 workflow ezt később bővíti;
- `ProjectInventoryReservation`: a számlasor, projekt, variant, raktár és
  StockItem közötti auditálható foglalási tény;
- `StockItem.onHand` továbbra is a fizikailag jelen lévő mennyiség;
- `StockItem.reserved` az aktív projektfoglalások projectionje;
- eladható/UNAS felé publikálható készlet: `onHand - reserved`;
- a számla, a fizikai `PURCHASE_RECEIPT` mozgás, a foglalások, a
  `reserved` projection és az UNAS-outbox célértéke egyetlen tranzakcióban
  készül;
- UNAS- és helyi Acropora OS-termék is rendelhető projekthez; helyi termék
  továbbra sem kerül UNAS-outboxba;
- a POS-termékkereső már a szabad, nem a teljes fizikai készletet mutatja.

Migráció:
`20260730190000_add_project_inventory_reservations`.

## Next steps

**Folyamatban (nincs a `main` ágban):** a Munkalap v0 első szelete --
adatmodell, számozás (`PARTNER-ALEGYSÉG-ÉV-SORSZÁM`, a sorszám a
lezáráskor kerül kiosztásra) és a lezárt lap verziózása, az aláírással a
verzióhoz kötve. Külön ágon áll, PR-t még nem kapott. Specifikáció:
`agents/murena/spec-munkalap-v0.md` (a fejlesztői ágens munkakönyvtárában,
nem ebben a repositoryban).

Következő projektkészlet-munkacsomag: a foglalás felhasználása/felszabadítása
a Szerviz és Projekt modulból, projektlezárási szabályokkal és külön
készletmozgással. További irányok: a NAV
digest-ben szereplő MODIFY/STORNO számlamódosítások kezelése (jelenleg
csak az eredeti CREATE-számlák kerülnek be), rendelt/tényleges mennyiség
eltérés jelzése és jóváhagyása, Vevő szerkesztés (update) UI,
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
pnpm typecheck
pnpm test
pnpm --filter @acropora/api test:integration
pnpm --filter @acropora/api test:brands:integration
pnpm --filter @acropora/api test:bootstrap
pnpm --filter @acropora/api test:smoke
pnpm --filter @acropora/api test:unas:connection
pnpm --filter @acropora/api test:foxpost
pnpm --filter @acropora/api test:assets
pnpm test    # a belépési pont a gyökér parancs; a csomag-szintű hívás nem épít, lásd CONTRIBUTING.md
pnpm build
```

Egyszeri parancssori eszközök:

```bash
pnpm --filter @acropora/api service-token
pnpm --filter @acropora/api barcode-import
pnpm --filter @acropora/api unas:probe
```

## Local URLs

- Web: http://localhost:3000
- Login: http://localhost:3000/login
- Dashboard: http://localhost:3000/
- Webshop (UNAS rendelések): http://localhost:3000/webshop
- POS: http://localhost:3000/pos
- Termékek: http://localhost:3000/products
- Vevők: http://localhost:3000/vevok
- Feladataim: http://localhost:3000/feladataim
- Szerviz: http://localhost:3000/szerviz
- Szerviz eszközök: http://localhost:3000/szerviz/eszkozok
- Új eszköz: http://localhost:3000/szerviz/eszkozok/uj
- Foxpost elszámolás: http://localhost:3000/penzugy/foxpost
- Beszerzés: http://localhost:3000/beszerzes
- Új EU-s/belföldi beszerzési számla: http://localhost:3000/beszerzes/uj
- NAV számla lekérés: http://localhost:3000/beszerzes/nav-szamlak
- Partnerek (beszállítók): http://localhost:3000/partnerek
- Új beszállító: http://localhost:3000/partnerek/uj
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
- A NAV Online Számla `queryInvoiceDigest`/`queryInvoiceData` integráció éles technikai felhasználó nélkül nem tesztelhető helyben - a válasz-XML mezőnevei (invoiceApi.xsd/invoiceData.xsd) a NAV nyilvános specifikációja és a közösségi `nav-online-invoice` referenciakliens alapján implementáltak, de valós NAV-válasszal még nincs megerősítve (ugyanaz a caveat, mint a UNAS `getCustomer` válasz gyökérelemén él).
- A NAV digest-szinkron v1-ben csak az eredeti (`CREATE` műveletű) számlákat dolgozza fel; a módosító/sztornó (`MODIFY`/`STORNO`) digest-tételeket szándékosan kihagyja.
- A NAV-alapú bevételezés a számla tételeit `variantId` nélküli, kézi sorként tölti elő - nincs automatikus terméktörzs-egyeztetés soronként, a felhasználó írja át a saját megnevezésére (vagy törli és keres rá egy létező termékre).
- **Az MNB automatikus árfolyam-lekérdezés jelenleg nem működik**: az `arfolyamok.asmx` élesben (2026-07-23-i teszt szerint) F5 bot-védelemmel válaszol minden POST SOAP-hívásra (`TS...` cookie, `Clear-Site-Data` fejléc, üres törzsű 404 - feltehetően TLS-ujjlenyomat alapú szűrés, kóddal nem megkerülhető). A kliens/szolgáltatás implementálva marad (SOAP 1.1 és 1.2 megpróbálása, szerveroldali naplózás), de gyakorlatilag mindig a kézi megadásra visszaeső hibaágat futtatja; az űrlapon az árfolyam mező emiatt elsődlegesen kézi bevitelre való.
- A rendelt/tényleges mennyiség közötti eltérés jelzése és jóváhagyása szándékosan még nincs kidolgozva.
- A projektkészlet bevételezéskori foglalása elkészült, de a foglalás
  felhasználása, részleges felszabadítása és projektlezáráskor történő
  rendezése a későbbi Szerviz/Projekt workflow része.
- **A szerviz-eszköz modul tesztjeit egyetlen automatizmus sem futtatja.**
  A `apps/api` `test` szkriptje nem hivatkozik a
  `service-assets/qr-svg.spec.js` és a
  `service-assets/service-assets.service.spec.js` fájlokra; azok csak a
  külön `test:assets` szkriptben szerepelnek, amit a CI workflow nem hív
  meg. A tesztek léteznek, de nem adnak fedezetet. Ez önálló hibajegy,
  nem ennek a dokumentumnak a lábjegyzete.
- A `#40`--`#69` körben beolvasztott funkciók éles működéséről a
  repository nem tartalmaz bizonyítékot (nincs release tag, nincs
  changelog), ezért ebből a dokumentumból sem olvasható ki.

## Important constraints

- Az `acropora-pre-m1.sql` fájlt nem szabad módosítani vagy commitolni.
- Valós importexport, adatbázis-dump, secret vagy személyes adat nem kerülhet Gitbe.
- Commit és push csak külön jóváhagyással történhet.
