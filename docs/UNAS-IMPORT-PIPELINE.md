# UNAS import pipeline

> A brand review, approval és Apply kezelőfelület részletes folyamata: [UNAS-BRAND-REVIEW-UI.md](./UNAS-BRAND-REVIEW-UI.md).

## Cél és biztonsági határ

A pipeline UNAS katalógus XLSX exportot fogad, validál, staging rekordokba ír és
dry-run riportot készít. Product, ProductVariant, ProductCategory, ProductImage,
ChannelListing és készlet rekordot nem hoz létre és nem módosít. Production
import-végrehajtás nincs bekötve.

Az exportfájl csak a kérés idejére, memóriában létezik. A fájl nem kerül Gitbe,
adatbázisba vagy tartós fájltárba; a staging a forrássor számát, nyers és parse-olt
payloadot, external ID-t, SKU-t és validációs problémákat őrzi. A fájlnév és
SHA-256 hash a batch idempotencia- és auditnyoma.

## API

- `POST /imports/unas/catalog/dry-run`: `multipart/form-data`, `file` mező,
  `products.manage` jogosultság. Kizárólag `.xlsx`, legfeljebb 25 MiB.
- `GET /imports/unas/:batchId/report`: korábban elkészült JSON/UI-ready riport,
  `products.view` jogosultság.

## Admin varázsló

A `/admin/imports/unas` oldal kizárólag `products.manage` jogosultsággal érhető
el. Az ötlépéses felület XLSX drag-and-dropot és fájlválasztót, feltöltési
progress állapotot, dry-run összegző kártyákat, külön error/warning validációs
tabokat, entitás- és szövegszűrést, termékenként csoportosított meződiffet,
valamint JSON letöltést és másolható összegzést ad.

Korábbi dry-run a staging batch ID megadásával újranyitható. A varázslóban nincs
import jóváhagyás vagy alkalmazás gomb, ezért a frontend sem tud Product táblát
módosító végpontot meghívni.

Kötelező munkalapok: `Products`, `Categories`. A `Brands` opcionális. A parser
fejléc-aliasokat támogat, de az eredeti cellaértékeket változatlan raw payloadban
őrzi meg. A `Products` exportból legalább SKU, név, kategória, brand, kép URL,
nyers státusz és aktív állapot olvasható. Az ismeretlen UNAS státusz jelentését a
rendszer nem találja ki és nem alakítja Product aktivitássá.

## Validáció, brand resolution és diff

Error: hiányzó vagy duplikált SKU, hiányzó név, hibás termék- vagy
szülőkategória-hivatkozás, hibás kategóriaazonosító vagy név. Warning: hiányzó
brand, nem található Brands-lapi brand, hibás kép URL és váratlan nyers státusz.
Minden issue súlyosságot, kódot, mezőt, entity típust és forrássort adhat vissza.

Az alapvalidáció után a determinisztikus Brand Resolution Engine fut. Az explicit
brandet, kategóriaútvonalakat, terméknevet, gyártói cikkszámot és konfigurált
SKU-prefixeket evidence-ként pontozza. Az automatikusan feloldható eredmény a
dry-run diffben használható, a bizonytalan és feloldatlan esetek
`BrandResolutionReview` staging sorba kerülnek. A nyers `MISSING_BRAND` warning
ettől függetlenül megmarad. Részletes szabályok: `docs/UNAS-BRAND-RESOLUTION.md`.

A diff SKU alapján hasonlít a jelenlegi katalógushoz, és külön jelzi a cím,
kategóriák, brand, képek, UNAS channel listing, valamint aktív állapot változását.
Kategóriák külső azonosításához az `ExternalReference(system=UNAS,
entityType=Category)` rekordok az irányadók.

## Dry-run riport

A riport Product create/update/unchanged számokat, Category create/update
számokat, error/warning összesítést, soronkénti műveletet és mezőszintű diffet
tartalmaz. Az `INVALID` sorok stagingben megmaradnak, de nem számítanak létrehozási
vagy módosítási műveletnek. A visszafelé kompatibilis opcionális
`brandResolution` blokk összesített és termékszintű döntést, jelölteket,
evidence-eket és verziókat ad.

## Szándékosan elhalasztva

- approval/review frontend és háttérfolyamat; a backend Apply Engine leírása:
  `docs/UNAS-APPLY-ENGINE.md`;
- production automatikus futtatás;
- nyitókészlet és árak;
- vevő- és rendelésimport;
- képek letöltése;
- UNAS státuszkódok üzleti jelentésének megfejtése;
- objektumtáras fájlmegőrzés, vírusellenőrzés és aszinkron nagyfájl-feldolgozás.
