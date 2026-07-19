# UNAS Catalog import workflow

## Hatókör és biztonság

Ez a dokumentum a későbbi UNAS termék- és kategóriaimport feldolgozási sorrendjét rögzíti. A jelenlegi commit csak adatmodellt és staging szerződéseket ad: nincs XLSX parser, feltöltési endpoint, háttérjob vagy teljes importfuttatás.

- Exportfájl nem kerülhet Gitbe.
- A nyers fájlokat fejlesztésben is Git által figyelmen kívül hagyott, hozzáférés-védett ideiglenes tárban kell kezelni.
- Vásárlói export és személyes vásárlói adat nem része ennek a folyamatnak, nem használható fixture-ben vagy dokumentációban.
- Tesztadat csak mesterséges katalógusadat lehet.

## Feldolgozási fázisok

### 1. Raw staging

A parser később minden forrássort providerfüggetlen eredményborítékba helyez. Az UNAS adapter `UnasProductImportRow` vagy `UnasCategoryImportRow` típust készít, megtartva:

- a `sourceRowNumber` értéket;
- a külső ID-t és SKU-t;
- a teljes nyers payloadot;
- a provider metadata értékeket;
- a validációs issue-kat;
- a később létrehozott belső entity ID-ket.

A hibás sor nem veszhet el és nem állíthatja le automatikusan az egész batch-et. ERROR issue esetén nem transzformálható, WARNING esetén review vagy konfigurált folytatás szükséges.

Az UNAS 0/1/2/3 státuszkódjainak jelentése nincs igazolva. A kód kizárólag `ChannelListing.externalStatus` nyers string mezőbe kerül. Tilos ebből feltételezett `Product.isActive` vagy `ChannelListing.isPublished` értéket számítani, amíg nincs hiteles mapping.

### 2. Kategóriaimport

A kategóriákat a termékek előtt, szülő–gyermek sorrendben kell importálni. Az UNAS category external ID az `ExternalReference` stratégián keresztül kapcsolódik a belső `Category.id` értékhez. Az idempotens újrafuttatás external reference alapján update-et végez, nem hoz létre duplikátumot.

### 3. Brand enrichment és review

A brand nem vezethető le vakon a terméknévből. A stagingből kinyert brandjelölteket normalizálási és manuális review sorba kell tenni. Csak jóváhagyott megfeleltetés után hozható létre vagy kapcsolható `Brand` rekord.

### 4. Product és alapértelmezett ProductVariant

Egy UNAS exporttermékből:

- egy közös `Product` készül;
- egy alapértelmezett `ProductVariant` készül az export belső SKU-jával;
- az UNAS termékazonosító `ExternalReference` rekord lesz;
- az import újrafuttatásakor external ID, másodsorban SKU alapján történik a reconciliation.

SKU-ütközés vagy több belső jelölt nem oldható fel automatikusan: ERROR issue és review szükséges.

### 5. Több kategóriakapcsolat

Az elsődleges és alternatív kategóriák `ProductCategory` rekordok. Egy Producthoz alkalmazásszinten legfeljebb egy `isPrimary=true` kapcsolat engedett. A többi kapcsolat sorrendjét az opcionális `sortOrder`, eredetét a `source` őrzi.

A legacy `Product.categoryId` átmeneti kompatibilitási pointer. Új logika nem használhatja source of truth-ként; a repository az elsődleges kapcsolattal együtt tartja szinkronban, amíg külön adatátvezetés után eltávolítható.

### 6. Képek és SEO

A képek `ProductImage` rekordokként, az export sorrendjével kerülnek stagingbe. Idempotenciakulcs a Product és URL együttese; a sorrend későbbi importnál frissíthető. A fájltartalom letöltése és saját objektumtárba másolása külön folyamat.

Az UNAS megjelenési és SEO-adatok a `ChannelListing(channel=UNAS)` rekordban maradnak:

- slug és product URL;
- SEO title, description, keywords és robots;
- nyers external status;
- backorder és publikálási állapot csak igazolt mapping vagy explicit konfiguráció alapján;
- ismeretlen providermezők a metadata JSON-ban.

### 7. Árimport később

Az ár nem a Product vagy ChannelListing mezője. Későbbi PriceList/ProductPrice sprint dolgozza fel a nettó/bruttó, áfa-, pénznem-, időbeli érvényességi és customer/channel scope szabályokat. Addig exportárból nem készül tartós katalógusár.

### 8. Nyitókészlet

Importált készletből tilos közvetlen `StockItem` vagy egyenlegmezőt írni. A migráció kizárólag postolt `OPENING_BALANCE` `StockMovement` és `StockMovementLine` rekordokat hozhat létre raktáranként és variantenként. A batch és forrássor referencia biztosítja az idempotenciát és auditálhatóságot.

## Reconciliation és idempotencia

Az import batch minden sora determinisztikus kulcsot kap provider + exporttípus + external ID/SKU alapján. A feldolgozó:

1. external reference alapján megkeresi a belső aggregate-et;
2. összehasonlítja a normalizált tartalmi hash-t;
3. változatlan sor esetén skip eredményt ad;
4. változásnál tranzakcióban update-el és új sync állapotot rögzít;
5. ütközésnél nem választ önkényesen, hanem issue-t készít;
6. a végén darabszám-, hiba- és hiánylistás reconciliation riportot ad.

Az import nem töröl automatikusan olyan belső terméket, amely hiányzik egy exportból. Ehhez külön, review-zott archiválási döntés szükséges.

## Szándékosan elhalasztva

- XLSX/CSV parser és oszlopmapping UI;
- fájlfeltöltés, objektumtár és vírusellenőrzés;
- import job orchestration, retry és progress;
- brand automatikus normalizálása;
- státuszkód-mapping;
- képbinárisok letöltése;
- ár- és kedvezményimport;
- opening balance végrehajtó;
- merchandising relation import és CRUD;
- vásárlói export bármilyen feldolgozása.
