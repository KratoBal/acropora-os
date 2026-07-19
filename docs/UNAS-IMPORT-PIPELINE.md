# UNAS import pipeline

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

Kötelező munkalapok: `Products`, `Categories`. A `Brands` opcionális. A parser
fejléc-aliasokat támogat, de az eredeti cellaértékeket változatlan raw payloadban
őrzi meg. A `Products` exportból legalább SKU, név, kategória, brand, kép URL,
nyers státusz és aktív állapot olvasható. Az ismeretlen UNAS státusz jelentését a
rendszer nem találja ki és nem alakítja Product aktivitássá.

## Validáció és diff

Error: hiányzó vagy duplikált SKU, hiányzó név, hibás termék- vagy
szülőkategória-hivatkozás, hibás kategóriaazonosító vagy név. Warning: hiányzó
brand, nem található Brands-lapi brand, hibás kép URL és váratlan nyers státusz.
Minden issue súlyosságot, kódot, mezőt, entity típust és forrássort adhat vissza.

A diff SKU alapján hasonlít a jelenlegi katalógushoz, és külön jelzi a cím,
kategóriák, brand, képek, UNAS channel listing, valamint aktív állapot változását.
Kategóriák külső azonosításához az `ExternalReference(system=UNAS,
entityType=Category)` rekordok az irányadók.

## Dry-run riport

A riport Product create/update/unchanged számokat, Category create/update
számokat, error/warning összesítést, soronkénti műveletet és mezőszintű diffet
tartalmaz. Az `INVALID` sorok stagingben megmaradnak, de nem számítanak létrehozási
vagy módosítási műveletnek.

## Szándékosan elhalasztva

- import apply/approval workflow;
- production automatikus futtatás;
- nyitókészlet és árak;
- vevő- és rendelésimport;
- képek letöltése;
- UNAS státuszkódok üzleti jelentésének megfejtése;
- objektumtáras fájlmegőrzés, vírusellenőrzés és aszinkron nagyfájl-feldolgozás.
