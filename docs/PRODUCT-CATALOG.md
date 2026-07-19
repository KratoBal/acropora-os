# Product Catalog backend

## Felelősség

A Product Catalog a közös termékidentitás source of truth-ja. A `Product` tartalmazza a közös nevet, leírást, terméktípust, brandet, kategóriát és archiválási állapotot. A konkrét SKU, barcode, ár és készlet a későbbi `ProductVariant` funkció része.

A backend első szelete kizárólag Product műveleteket ad. Nem tartalmaz frontend felületet, variant CRUD-ot vagy készletkezelést.

## API

Minden végpont hitelesítést igényel.

| Metódus  | Útvonal         | Jogosultság       | Művelet                    |
| -------- | --------------- | ----------------- | -------------------------- |
| `GET`    | `/products`     | `products.view`   | lapozott és szűrhető lista |
| `GET`    | `/products/:id` | `products.view`   | egy Product részletei      |
| `POST`   | `/products`     | `products.manage` | Product létrehozása        |
| `PATCH`  | `/products/:id` | `products.manage` | részleges módosítás        |
| `DELETE` | `/products/:id` | `products.manage` | soft archive               |

A create mezői: `name`, opcionális `description`, `productType`, opcionális `brandId` és `primaryCategoryId`. A támogatott típusok: `PHYSICAL`, `SERVICE`, `LIVESTOCK`. A korábbi `categoryId` request mező átmenetileg támogatott, de deprecated.

A detail válasz a Product mellett brandet, rendezett elsődleges és alternatív kategóriakapcsolatokat, variantlistát, csatornalistingeket és sorrendezett képeket is tartalmaz. Nem létező ID esetén a detail, update és archive HTTP 404 választ ad.

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
