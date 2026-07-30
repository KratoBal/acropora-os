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

Az eredet és az authority külön mező, mert egy későbbi, ellenőrzött
helyi–UNAS összekapcsoláskor az authority változhat, miközben a történeti
eredet megmarad. Ilyen átmeneti folyamat ebben a PR-ban még nincs.

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

A listához és detailhez kizárólag `products.view` szükséges. A még nem létező „Új termék” funkció disabled „hamarosan” jelzést kap; a felület nem végez create, update vagy archive műveletet.

Fejlesztői környezetben a termék API valódi bearer sessiont vár. Emiatt a webes development auth a mock felhasználóválasztás megtartása mellett az API `/auth/login`, `/auth/me` és `/auth/logout` végpontjait használja. Így a Product List nem egy, kizárólag a böngésző által ismert ál-tokenhez kötődik. A kliens a lejárt, az API által elutasított vagy elérhetetlen API mellett nem validálható sessiont törli; ez továbbra is kizárólag development auth, productionben tiltott.

Állapotkezelés: táblaszerkezetű initial skeleton, meglévő adatok megtartása alatti frissítésjelző, külön üres katalógus és szűrt no-results állapot, továbbá felhasználóbarát retry lehetőség hálózati/API hibánál.

Szándékosan elhalasztott UI-funkciók: szerkesztő, létrehozás, archiválás/visszaállítás, variant CRUD, képkezelés, merchandising, channel listing, ár, készlet, bulk action, saved view és oszlopszemélyre szabás.
