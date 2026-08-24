# Product Catalog

## Felelősség

A Product Catalog az UNAS-ban létező termékek helyi, read-only mirror
projectionját és az Acropora OS-ben létrehozott helyi termékek közös törzsét
adja. Az UNAS-ból szinkronizált termék Product Mastere az UNAS; a helyi
terméké az Acropora OS.

A `Product.origin` a történeti, megváltoztathatatlan származás:

- `UNAS`: UNAS terméktörzsből szinkronizált termék;
- `LOCAL`: az Acropora OS-ben létrehozott helyi termék.

A `Product.catalogAuthority` az aktuális Product Master:

- `UNAS`: a generikus Product API nem módosíthatja és nem archiválhatja;
- `ACROPORA`: a generikus Product API által kezelhető.

Az eredet és az authority külön mező, mert egy ellenőrzött átvételkor az
authority változhat, miközben a történeti eredet megmarad: egy átvett termék
`origin` mezője továbbra is `UNAS`, tehát a származása visszakereshető marad.

## A törzsadat átvétele (UNAS → ACROPORA)

Az átvétel EGY IRÁNYBA működik, és külön végponton, nem az update DTO-n
keresztül:

    POST /products/:id/catalog-authority/acropora

Jogosultság: `products.catalog-authority.transfer`, szándékosan KÜLÖN a
`products.manage` jogtól, és a ROLE_PERMISSIONS szerint csak OWNER és ADMIN
kapja meg. Az indok nem a ritkaság: az átvétel után a webshop-szinkron többé
nem ír a terméken, tehát egy UNAS oldali javítás CSENDBEN nem érkezik meg.

Amit a művelet tesz:

- a váltás egyetlen feltételes írás (`catalogAuthority: "UNAS"` a where
  ágban), tehát két párhuzamos átvételből pontosan az egyik ír;
- valódi váltáskor `product.catalog-authority.transferred` DomainEvent
  keletkezik, a művelet végzőjével; megismételt hívásnál NEM keletkezik újabb
  esemény, mert a napló ugyanazt az egy döntést nem mondhatja el kétszer;
- feloldatlan (`null`) authority esetén ugyanaz a fail-closed válasz jön, mint
  az írásnál: `PRODUCT_CATALOG_AUTHORITY_UNRESOLVED`.

### Mely mezők tartoznak az átvett termékhez

Az átvétel után a `name`, a `description` **és a kategória** az Acropora OS
tulajdona: a termék-szinkron termékszinten kihagyja a rekordot, és a kihagyást a
`UnasProductSyncRun.skippedCount` mezőben számolja.

A kategória külön említést érdemel, mert a szinkron MÁS ÚTON írja, mint a nevet
és a leírást. A név és a leírás magával a termék-sorral megy be; a kategória
utána, két további írásban: a `ProductCategory` kapcsolatok `source: "UNAS"`
szűrővel törlődnek és újra létrejönnek, majd a `Product.categoryId` külön
`update` hívásban áll be. Három írás, egy gazda. Mind a három ugyanabban a
ciklusban van, a kihagyás-őrző UTÁN, ezért egy átvett terméknél egyik sem fut le.
Külön mechanizmus tehát nem kellett hozzá, de a védettséget külön teszt méri,
mert a három írás bármelyike elcsúszhatna a másik kettőtől.

**A tükör-könyvelési mezők a szinkron tulajdonában MARADNAK**, átvétel után is:
`mirrorSource`, `mirrorState`, `sourceCreatedAt`, `sourceUpdatedAt`,
`lastSyncedAt`, `missingSince`, `rawSourceHash`. Ezek nem a termékről szólnak,
hanem magáról a tükörről: ha ezeket is átvennénk, a tükör többé nem tudná leírni
a saját állapotát.

Készlet és árazás NEM része az átvételnek, azok külön domainek.

### A szerver oldali írási határ

A `PATCH /products/:id` út teljes egészében mérve, és a határ NEM a képernyőn
van:

| Réteg                          | Mit tesz                                                                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `ValidationPipe` (main.ts)     | `whitelist` és `forbidNonWhitelisted`, tehát egy ismeretlen mező már a kontroller előtt 400-at kap                                     |
| `UpdateProductDto`             | hat mezőt ismer: `name`, `description`, `productType`, `brandId`, `primaryCategoryId` és a deprecated `categoryId`                     |
| `ProductController`            | `products.manage` jogosultság                                                                                                          |
| `ProductService.updateProduct` | `assertLocallyManaged`: `UNAS` gazdánál `409 PRODUCT_MANAGED_BY_UNAS`, feloldatlan gazdánál `409 PRODUCT_CATALOG_AUTHORITY_UNRESOLVED` |
| `ProductRepository.update`     | NÉV SZERINT sorolja fel, mit ír, tehát ismeretlen mező akkor sem íródna, ha idáig eljutna                                              |

A tükör-könyvelési mezők (`mirrorSource`, `mirrorState`, `sourceCreatedAt`,
`sourceUpdatedAt`, `lastSyncedAt`, `missingSince`, `rawSourceHash`) ezen az úton
tehát KÉT független okból nem írhatók: a kapu visszautasítja őket, és a tároló
réteg nem is ismeri őket. A `product-write-gate.integration.spec.ts` mind a
kettőt méri, adatbázisból visszaolvasva, nem státuszkódból.

### A kategória két reprezentációja a szerkesztésnél

A `Product.categoryId` skalár és a `ProductCategory` kapcsolatok EGYETÉRTENEK
abban, melyik az elsődleges: a szerkesztés egy tranzakcióban billenti át az
`isPrimary` jelzőt és írja a skalárt, `source: "MANUAL"` jelöléssel. Mérve.

Amit viszont tudni kell: **az előző elsődleges kapcsolat nem tűnik el**, csak
elveszti az elsődleges jelzőt. Egy átsorolt termék tehát megtartja a korábbi
kategóriáját másodlagos kapcsolatként, és a termékoldal ma minden kapcsolatot
megjelenít. Ez nem inkonzisztencia a két reprezentáció között, hanem egy
felhalmozódás, amivel a szerkesztő felületnek kezdenie kell valamit.

### A helyi mezőszerkesztő

Egy átvett termék neve, leírása és kategóriája **védett a felülírástól**, és a
`PATCH /products/:id` végponton **szerkeszthető is**. A termékoldalon egyetlen
űrlap kezeli mind a hármat (`ProductBasicsEditor`), és három feltétel kell
hozzá:

- a termék törzsadat-gazdája `ACROPORA` (ezért a szerkesztő UNAS-gazdájú
  terméken meg sem jelenik);
- a felhasználónak `products.manage` joga van;
- a szerver engedi. **A felület nem őrzi a szabályt, csak követi**: a tiltás a
  `ProductService`-ben áll, és egy megkerült képernyő ott is elhasalna.

**Miért `products.manage`, és miért nem külön jog:** az átvételnek azért van
saját, szűkebb joga, mert egyirányú és NÉMA következménye van (utána egy UNAS
oldali javítás nem érkezik meg, és erről senki nem kap értesítést). Egy név
átírása nem ilyen: visszaírható, és a következő olvasó látja, mi áll ott. A
határ nem a mező értéke, hanem a művelet visszafordíthatósága.

**Mentés után a képernyő VISSZAOLVASSA a terméket**, és azt mutatja, nem a
begépelt értéket és nem is a mentés válaszát. Az utóbbi még abból a
tranzakcióból származik, ami írt; a visszaolvasott az, amit a szerver bárki
másnak is kiadna.

VISSZAADÁS NINCS, és ez döntés, nem hiány. A visszaadás nem az ellenkező
irányú kapcsoló: a UNAS a következő szinkronnál felülírná azt a nevet és
leírást, amit közben nálunk szerkesztettek. Amíg nincs eldöntve, mi történjen
ezekkel a szerkesztésekkel, a művelet nem létezik.

A `Product` tartalmazza a közös nevet, leírást, terméktípust, brandet és
kategóriát, a `ProductVariant` az SKU-val azonosított értékesíthető és
készletezhető egység. Az Acropora saját statikus beállításai külön
`ProductExtension` modellhez tartoznak. A normatív UNAS-mirror döntés az
[ADR-013](../adr/0013-unas-product-master-and-local-extension.md), az M2.1 szerződés az
[UNAS Product Synchronization](./M2.1-UNAS-PRODUCT-SYNCHRONIZATION.md)
dokumentumban található.

A backend első szelete történetileg Product CRUD műveleteket adott. Az M2.1-ben
ezek az UNAS-authority rekordokra le vannak tiltva; a read API megmarad, az
UNAS-termékek helyi írásai külön Product Extension API-ra kerülnek. Nem
tartalmaz készletkezelést.

## Provenance migráció

Az első migráció expand–backfill lépés:

- a `ProductOrigin` és `ProductCatalogAuthority` enumok létrejönnek;
- az új mezők átmenetileg nullable értékűek;
- `mirrorSource=UNAS` esetén `UNAS`/`UNAS` a backfill;
- minden más meglévő rekord `LOCAL`/`ACROPORA` értéket kap;
- a generikus create mindig explicit `LOCAL`/`ACROPORA` értéket és
  `createdById` auditkapcsolatot ír;
- az UNAS termékszinkron minden új terméket explicit `UNAS`/`UNAS` értékkel
  hoz létre, meglévő rekordot pedig csak akkor frissít, ha már mindkét mező
  szerint UNAS-kezelésű.

A nullable állapot szándékos telepítési biztonsági lépés. A
`packages/database/prisma/diagnostics/product-provenance-preflight.sql`
read-only riportja jelzi a `mirrorSource`, `UnasProductSnapshot` és UNAS
`ExternalReference` közötti konfliktusokat. Production-ellenőrzés után külön
contract migráció állíthatja `NOT NULL`-ra a mezőket.

Az `origin` és `catalogAuthority` nem része a create/update DTO-knak, ezért
kliensoldalról nem írhatók. Ismeretlen/null authority esetén a generic update
és archive fail-closed módon `PRODUCT_CATALOG_AUTHORITY_UNRESOLVED` hibát ad.

## API

Minden végpont hitelesítést igényel.

| Metódus  | Útvonal         | Jogosultság       | Művelet                    |
| -------- | --------------- | ----------------- | -------------------------- |
| `GET`    | `/products`     | `products.view`   | lapozott és szűrhető lista |
| `GET`    | `/products/:id` | `products.view`   | egy Product részletei      |
| `POST`   | `/products`     | `products.manage` | Product létrehozása        |
| `PATCH`  | `/products/:id` | `products.manage` | részleges módosítás        |
| `DELETE` | `/products/:id` | `products.manage` | soft archive               |

| Metódus | Útvonal                                    | Jogosultság                           | Művelet                       |
| ------- | ------------------------------------------ | ------------------------------------- | ----------------------------- |
| `POST`  | `/products/:id/catalog-authority/acropora` | `products.catalog-authority.transfer` | törzsadat átvétele a UNAS-tól |

UNAS authority rekordra a `PATCH` és `DELETE` végpont
`409 PRODUCT_MANAGED_BY_UNAS` választ ad.

A create mezői: `name`, opcionális `description`, `productType`, opcionális `brandId` és `primaryCategoryId`. A támogatott típusok: `PHYSICAL`, `SERVICE`, `LIVESTOCK`. A korábbi `categoryId` request mező átmenetileg támogatott, de deprecated.

A detail válasz a Product mellett brandet, rendezett elsődleges és alternatív kategóriakapcsolatokat, variantlistát, csatornalistingeket és sorrendezett képeket is tartalmaz. Nem létező ID esetén a detail, update és archive HTTP 404 választ ad.
Mind a lista-, mind a detail-contract visszaadja az `origin` és
`catalogAuthority` mezőt.

## Lista, keresés és lapozás

Query paraméterek:

- `page`: 1-től induló oldalszám, alapérték 1;
- `pageSize`: 1–100 közötti elemszám, alapérték 20;
- `search`: kis- és nagybetűtől független részszöveg a Product nevében vagy variant SKU-ban;
- `active`: `true` vagy `false`; elhagyva aktív és archivált rekordot is visszaad;
- `brandId`: pontos brand szűrő;
- `categoryId`: pontos kategóriaszűrő a ProductCategory M:N kapcsolaton keresztül.

A rendezés név, majd belső ID szerint stabil. A válasz `items` mellett `page`, `pageSize`, `totalItems` és `totalPages` lapozási metaadatot ad.

## Repository és tranzakció

A controller nem használ PrismaClientet. A hívási lánc:

```text
ProductController → ProductService → ProductRepository → Prisma
```

A `ProductRepository.create` egy adatbázis-tranzakcióban hozza létre a Productot, az opcionális elsődleges ProductCategory kapcsolatot és a `product.created` típusú `DomainEvent` rekordot. Update esetén a repository előbb megszünteti a korábbi primary jelölést, majd upserteli az újat, így alkalmazásszinten egyetlen elsődleges kategória marad. Event bus vagy aszinkron publisher még nincs; a rekord a későbbi outbox/publisher alapja.

## Helyi termék létrehozása beszerzési számlából

A HU_NAV, HU_MANUAL és EU beszerzési számlák ismeretlen sora a rögzítő
felületen meglévő termékvariánshoz kapcsolható, vagy új, készletezett helyi
termékként hozható létre. Az új termékhez kötelező a név és a mértékegység;
az elsődleges kategória opcionális. A belső SKU-t
nem a felhasználó adja meg: a backend mentéskor, adatbázis-szekvenciából
automatikusan képezi `ACR-L-000001` formában, majd az egyedi
`ProductVariant.sku` mezőbe menti. A szekvencia párhuzamos tranzakciók
között is egyedi; visszagörgetés után a sorszámban maradhat hézag.

A termék, az első variáns, a beszerzési számla, a `PURCHASE_RECEIPT`
készletmozgás, a `StockItem`-frissítés, a beszerzési ár kiterjesztés és a
`product.created` audit-esemény egyetlen adatbázis-tranzakcióban jön létre.
Az eredet és Product Master explicit `LOCAL`/`ACROPORA`, a `createdById` a
számlát rögzítő felhasználó. A globális SKU-egyediségi korlát egy váratlan
prefixütközést is megfog; ilyenkor a teljes tranzakció visszagördül, és a
backend új szekvenciaértékkel legfeljebb háromszor automatikusan próbálkozik.

A helyi termék készletváltozása nem hoz létre UNAS stock outbox sort, a
számlasor szinkronállapota `NOT_APPLICABLE`. A POS-kereső szándékosan csak
`catalogAuthority=UNAS` terméket ad vissza; a helyi termék POS-csatornába
engedése későbbi, explicit üzleti kapcsoló feladata.

## Archive stratégia

A `DELETE` fizikai törlés helyett:

- `isActive = false` értéket állít;
- kitölti az `archivedAt` időpontot;
- megtartja az ID-t, kapcsolatokat és auditálhatóságot.

Az archivált Product lekérdezhető és `active=false` listafilterrel kereshető. Visszaállítási endpoint ebben a szeletben még nincs.

## Validáció és korlátok

A globális Nest `ValidationPipe` transzformálja és whitelisteli a DTO-kat; ismeretlen mezőt elutasít. Az üzleti foreign key hibák jelenleg Prisma-hibaként jutnak az általános Nest hibakezelőhöz. Egységes conflict/validation error mapping későbbi API-infrastruktúra feladat.

## Product List UI

A hitelesített alkalmazás `/products` útvonala nagy katalógusra optimalizált, szerveroldalon lapozott operatív táblát ad. Nem tölt le teljes katalógust és nem indít detail kérést soronként.

Megjelenített oszlopok:

- terméknév és első rendezett kép;
- termékeredet badge: „UNAS-termék” vagy „Helyi Acropora OS-termék”;
- első aktív variant SKU;
- brand;
- elsődleges kategória;
- aktív vagy archivált állapot;
- UNAS listing jelenléte és igazolatlan jelentésű nyers külső státuszkód;
- read-only detail navigáció.

A lista URL-paraméterei:

- `q`: név/SKU keresés, 350 ms debounce után;
- `active=true|false`: aktív vagy archivált rekordok; hiányában minden állapot;
- `categoryId`, `brandId`: pontos szűrő;
- `page`: 1-től induló oldalszám;
- `pageSize`: 25, 50 vagy 100.

Szűrőváltozáskor az oldal visszaáll 1-re. Az URL az egyetlen navigációs source of truth, így frissítés, browser back és forward megőrzi az állapotot. Hibás query érték biztonságos alapértékre áll vissza.

Használt read-only API contractok:

- `GET /products`: Prisma-független `ProductListResponse` summary projection;
- `GET /products/:id`: `ProductDetail` read-only nézet;
- `GET /categories/options`: breadcrumb labellel rendezett kategóriák;
- `GET /brands/options`: név szerint rendezett brandek.

A listához és detailhez kizárólag `products.view` szükséges. Önálló
terméklétrehozó felület még nincs; helyi termék jelenleg a beszerzési
számlasorból hozható létre `purchasing.manage` jogosultsággal. A Product
List nem végez create, update vagy archive műveletet.

Fejlesztői környezetben a termék API valódi bearer sessiont vár. Emiatt a webes development auth a mock felhasználóválasztás megtartása mellett az API `/auth/login`, `/auth/me` és `/auth/logout` végpontjait használja. Így a Product List nem egy, kizárólag a böngésző által ismert ál-tokenhez kötődik. A kliens a lejárt, az API által elutasított vagy elérhetetlen API mellett nem validálható sessiont törli; ez továbbra is kizárólag development auth, productionben tiltott.

Állapotkezelés: táblaszerkezetű initial skeleton, meglévő adatok megtartása alatti frissítésjelző, külön üres katalógus és szűrt no-results állapot, továbbá felhasználóbarát retry lehetőség hálózati/API hibánál.

Szándékosan elhalasztott UI-funkciók: önálló terméklétrehozó, szerkesztő,
archiválás/visszaállítás, variant CRUD, képkezelés, merchandising, channel
listing, ár, készlet, bulk action, saved view és oszlopszemélyre szabás.
