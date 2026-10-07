# Árajánlat P0 – domain alap

Jóváhagyott terv: [#1582](https://github.com/KratoBal/acropora-os/issues/1582#issuecomment-6036894392).

## API

A belső, autentikált API négy végpontot ad:

| Végpont             | Jogosultság     | Művelet                                                             |
| ------------------- | --------------- | ------------------------------------------------------------------- |
| `GET /quotes`       | `quotes.view`   | Lapozott lista; `page`, `pageSize` (legfeljebb 100), opcionális `q` |
| `POST /quotes`      | `quotes.manage` | DRAFT ajánlat és első DRAFT verzió létrehozása                      |
| `GET /quotes/:id`   | `quotes.view`   | Ajánlat verziókkal és szűrt eseményekkel                            |
| `PATCH /quotes/:id` | `quotes.manage` | Publikálás előtti DRAFT fej-adatok módosítása                       |

A létrehozás kötelező mezői: `title`, `validUntil` (valós `YYYY-MM-DD` dátum).
Opcionális: `customerId`, `ownerUserId`, `currency` (alapérték HUF),
`priceDisplay` (NET, GROSS, BOTH; alapérték NET). A PATCH kizárólag
`title`, `customerId`, `ownerUserId` mezőt fogad; a két hivatkozás nullázható.
A publikált verzióval rendelkező ajánlat fejének módosítása 409 választ ad.
Ismeretlen bemeneti mezők elutasításra kerülnek.

A létrehozás és az audit/esemény írás egy tranzakció. Az `AJ-YYYY-NNNN`
azonosító globális PostgreSQL-szekvenciából készül, a címke évét Budapest
időzónája adja. A szekvencia évente nem indul újra; rollback után hézag lehet.
A verzió érvényessége PostgreSQL `date`, nem időpont.

## Jogosultság és DTO

OWNER, ADMIN és MANAGER minden `quotes.*` jogot kap. SALES írhat és olvashat
ajánlatot, és rendelkezik a későbbi publikálás, küldés és elfogadás-rögzítés
kulcsaival; költség, sablonkezelés és handoff jogot nem kap. VIEWER semmilyen
`quotes.*` jogot nem kap. A hatályos egyéni engedélyek és visszavonások érvényesek.

A mapper három explicit mezőlistából épít kimenetet: belső költséggel,
belső költség nélkül és ügyfél. Az API minden listázási és írási válaszában
a `quotes.costs.view` dönt a BOM és beszerzési mezők kiadásáról. A pénz és
mennyiség decimális karakterláncként kerül a DTO-ba. Az ügyfél-mapper P0-ban
nem kap nyilvános végpontot.

Szabad JSON nem kerül át automatikusan a válaszba. A szöveg-, kép- és
ügyfél-snapshot mezők saját megengedett mezőlistát használnak. Az esemény
payload csak néhány primitív azonosító- és állapotmezőt ad ki, költség-,
BOM- és fedezet-adatot privilegizált hívónak sem.

## Adatbázis és dokumentumtár

Az új modellek: Quote, QuoteVersion, QuoteBlock, QuoteItem, QuoteBomItem,
QuotePaymentMilestone, QuoteTemplate, QuoteSnippet és QuoteEvent.
A publikálási mezők teljességét CHECK, az egyetlen DRAFT verziót részleges
egyedi index őrzi. CHECK követeli meg a PRODUCT sor termékhivatkozását,
a nem termék BOM sor nevét, valamint a PAYMENT részlet mérföldkő-listáját.
A blokk–tétel–BOM kapcsolatok összetett FK-ja kizárja a verziók keverését.

A részlet tartalma másolat; a `sourceSnippetId` csak eredetjelölés,
törléskor SetNull. Sablon és részlet archiválása időbélyeggel történik.
A dokumentumtár új gazdája `quote`, könyvtára `quotes`; az egyeztető
a verzió PDF-kulcsait ismeri. PDF előállítás P0-ban nincs.

## Ellenőrzés és határ

A jogosultságok és mapperek adatbázis nélkül tesztelhetők. Az opt-in
`quotes.integration.spec.ts` saját `_test`/`_ci` adatbázison ellenőrzi
a CHECK-eket, az FK-kat, a HTTP validációt, a költségszűrést és a
párhuzamos sorszámozást. Az adatbáziskapu más céladatbázist elutasít.

P0 nem ad szerkesztőt, BOM-felületet, PDF-et, emailt, elfogadást, projekt-
vagy készletműveletet. A MaterialRequest és ProjectInventoryReservation
változatlan. A PR nem jelent környezeti élesítést vagy P1 indítást.
