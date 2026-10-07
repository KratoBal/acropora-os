# Árajánlat P1 – szerkesztő és BOM (API)

Jóváhagyott terv: [#1582](https://github.com/KratoBal/acropora-os/issues/1582#issuecomment-6036894392),
„P1 Editor + BOM”. Ez a lap az API részt írja le; a webes szerkesztő külön PR.

## Végpontok

Minden írás egy tranzakció, a P0 mintájára zárolva: előbb az ajánlat, aztán a
verzió `SELECT … FOR UPDATE`, és csak DRAFT verzió írható. Publikált verzió
gyerek-írása 409 („új verziót kell nyitni”). Lezárt ajánlat (ACCEPTED,
REJECTED, CANCELLED) nem szerkeszthető. Írás után a válasz a teljes ajánlat,
újraolvasva a jogfüggő részlet-mapperen át, tehát költségmező csak
`quotes.costs.view` mellett jelenik meg. Az írásokhoz `quotes.view` is kell,
mert a válasz újraolvasás.

| Végpont                                                   | Jogosultság                                         |
| --------------------------------------------------------- | --------------------------------------------------- |
| `POST /quotes` (`templateId` opcionális)                  | `quotes.manage`                                     |
| `GET /quote-templates`                                    | `quotes.manage`                                     |
| `POST /quotes/:id/versions`                               | `quotes.view` + `quotes.manage`                     |
| `PATCH /quotes/:id/versions/:v`                           | `quotes.view` + `quotes.manage`                     |
| `GET /quotes/:id/versions/:v/costing`                     | `quotes.view` + `quotes.costs.view`                 |
| `POST …/versions/:v/blocks`, `POST …/blocks/reorder`      | `quotes.view` + `quotes.manage`                     |
| `PATCH`/`DELETE …/versions/:v/blocks/:blockId`            | `quotes.view` + `quotes.manage`                     |
| `POST …/blocks/:blockId/items`, `POST …/items/reorder`    | `quotes.view` + `quotes.manage`                     |
| `PATCH`/`DELETE …/versions/:v/items/:itemId`              | `quotes.view` + `quotes.manage`                     |
| `POST …/items/:itemId/bom`, `PATCH`/`DELETE …/bom/:bomId` | `quotes.view` + `quotes.manage`                     |
| `PUT …/versions/:v/milestones`                            | `quotes.view` + `quotes.manage`                     |
| `POST …/versions/:v/snippets/:snippetId/insert`           | `quotes.view` + `quotes.manage`                     |
| `POST /quote-bom-items/:id/create-product`                | `quotes.view` + `quotes.manage` + `products.manage` |
| `GET /quote-snippets` (`includeArchived`)                 | `quotes.manage` vagy `quotes.templates.manage`      |
| `POST /quote-snippets`, `PATCH /:id`, `POST /:id/archive` | `quotes.templates.manage`                           |

A BOM-sor költség-, beszállító- és belső megjegyzés mezőit (`unitCost`,
`supplierId`, `supplierSku`, `internalNote`, `refreshCost`) csak
`quotes.costs.view` mellett lehet írni; nélküle 403, és nem íródik semmi.

## Lista és részlet (P1 kiegészítés)

A lista sora és a részlet a partner (`customerName`) és a készítő
(`createdByName`) nevét is hozza, a részlet a felelősét (`ownerName`) is;
a kapcsolt rekordból csak a név jön. A lista a legújabb verzió nem
opcionális tételeinek nettó összegét (`netTotal`) az adatbázisban összegzi,
tételsor betöltése nélkül. A részlet verziónként a nem opcionális
(`netTotal`) és az opcionális (`optionalNetTotal`) összeget külön adja,
pontos decimálisként.

## Szöveg

A megengedett TipTap-részhalmaz egy helyen áll: `packages/types`
`quote-text-schema.ts` (doc, paragraph, text, bulletList, orderedList,
listItem, hardBreak; jelölés: bold, italic). Ezt használja a szerver
validátora és az olvasó mapper, és ezt fogja a webes szerkesztő is. A
szerver minden más csomópontot, jelölést vagy extra kulcsot 400-zal
elutasít, nem szűr csendben.

Kép blokk a P1-ben nem hozható létre (feltöltés még nincs). Oldaltörésnek
nincs tartalma. A TEXT és a TERMS blokk szövege kötelező.

## Tételek és BOM

- Tétel csak SECTION és OPTIONS blokkba kerülhet.
- PRODUCT tétel létrehozáskor automatikusan kap egy BOM-sort ugyanazzal a
  változattal és mennyiséggel, költség-pillanatképpel. A sor a tétel
  módosításait ugyanabban az írásban követi: mennyiség és egység, változat-
  cserénél az új változat friss pillanatképpel; ha a tétel később lesz PRODUCT
  és nincs BOM-ja, a sor ekkor jön létre. Ha a saját sor nem egyértelmű (kézzel
  átírták, vagy több van), a rendszer nem találgat: a kalkuláció figyelmeztet.
- STANDALONE tételnek nincs BOM-ja (409).
- A BOM-sor mennyisége a TELJES ügyfélsorra vonatkozik, nem egységenként.
- Egyedi (CUSTOM) és szolgáltatás (SERVICE) sor változat és költség nélkül is
  menthető.

### Költség-pillanatkép

A PRODUCT BOM-sor költsége egyszer, a sor létrehozásakor (vagy változat-
cserénél, illetve `refreshCost` kérésre) íródik, és egy későbbi bevételezés
nem mozdítja el. A forrás sorrendje:

1. a változat utolsó beszerzési sora POSTED számlán, a számla KELTE szerint
   (nem a rögzítés sorrendjében), a sor-kedvezmény után, deviza esetén a
   számlán tárolt árfolyammal HUF-ra váltva;
2. tartalékként a változat `ProductExtension.lastPurchaseNetPrice` értéke,
   `costSource = LAST_PURCHASE` és `sourcePurchaseInvoiceLineId = null`
   jelöléssel.

Árfolyam nélküli deviza sor a tartalékra esik. Deviza tartalék árfolyam nélkül
nem kerül HUF-ként a számításba: a `unitCost` üres, az eredeti összeg marad.
A figyelmeztetéseket nem tároljuk, olvasáskor számolódnak.

### Helyi termék egyedi sorból

`POST /quote-bom-items/:id/create-product`: csak CUSTOM sorból. Új helyi
termék jön létre (`ACR-L-` cikkszám, webshopból kizárva), a neve a sor
`customName` értéke. A BOM-sor ugyanabban az írásban PRODUCT-ra vált:
`variantId` az új változat, `customName` NULL, `createdProductVariantId` =
`variantId`. Migráció nincs.

## Kalkuláció

`GET …/costing`, csak `quotes.costs.view` mellett. A javasolt egységár:

| Tétel      | Javasolt ár                                                                                     | Forrás       |
| ---------- | ----------------------------------------------------------------------------------------------- | ------------ |
| PRODUCT    | a változat mai eladási bruttója (`resolvePriceSource`), a változat ÁFA-kulcsával nettósítva     | `LIST_PRICE` |
| BOM        | a PRODUCT-sorok eladási ára mennyiséggel + a CUSTOM/SERVICE sorok költsége, egy ügyfél-egységre | `BOM_SUM`    |
| STANDALONE | nincs                                                                                           | `null`       |

Felár-szabály nincs; a forrás neve azért áll a válaszban, hogy egy későbbi
szabály mellé tudjon állni. Ha bármelyik sorból hiányzik adat, a javaslat
hiányosnak jelölt.

A fedezet: sor nettó mínusz a BOM-költség, és ennek aránya a nettóhoz. Ha
bármelyik BOM-sor költsége hiányzik, a fedezet NEM számolódik (a hiányos
költség alsó korlát, a belőle számolt fedezet túl szép lenne), és
figyelmeztetés nevezi meg a sort. Az összesítés csak a nem opcionális
tételeket számolja. Nem HUF pénznemű verziónál fedezet és javaslat nincs.

## Szövegrészletek és sablonok

A beszúrt részlet MÁSOLAT: a részlet későbbi szerkesztése vagy archiválása a
verziót nem változtatja. Archivált részlet nem szúrható be (409). A PAYMENT
részlet mérföldkövei (összegük pontosan 100%) a verzió mérföldköveit cserélik;
csak PAYMENT részlet hordozhat mérföldkövet, és annak kötelező.

Sablonszerkesztő nincs (P1, 1. döntés). Új ajánlatnál `templateId` adható: a
sablon blokkjai és mérföldkövei a szerkesztő szabályaival ellenőrizve kerülnek
az első verzióba, és a verzió megjegyzi a sablont. Hibás sablon 400, nem
félkész ajánlat.

## Ellenőrzés

Egységtesztek: `quote-costing.spec.ts`, `quote-cost-snapshot.spec.ts`,
`quote-editor-input.spec.ts`, `quote-dto.mapper.spec.ts`. Az opt-in
`quotes-p1.integration.spec.ts` a `_test`/`_ci` adatbázison HTTP-n át méri a
409-et, a költségszűrést, a pillanatkép forrását, a create-product írást, a
részlet-másolást és a sablonból indítást.

## Web (B rész)

| Útvonal                                | Képernyő (Figma 35)           | Jog                       |
| -------------------------------------- | ----------------------------- | ------------------------- |
| `/ajanlatok`                           | Lista (`567:2`)               | `quotes.view`             |
| `/ajanlatok/uj`                        | Új ajánlat (`567:190`)        | `quotes.manage`           |
| `/ajanlatok/:id`                       | Adatlap (`569:504`)           | `quotes.view`             |
| `/ajanlatok/:id/szerkesztes`           | Szerkesztő (`569:171`)        | `quotes.manage`           |
| `/beallitasok/ajanlat-szovegreszletek` | Szövegrészletek (nincs frame) | `quotes.templates.manage` |

A menüpontok a `quotes` kapcsoló mögött állnak: `QUOTES_ENABLED` értéke
`off` (alapértelmezés), `pilot` (csak a `QUOTES_PILOT_USER_IDS` listán
szereplők; üres lista mellett senki) vagy `on`. A kapcsoló csak a menüt
rejti, a végpontokat a jogosultság védi.

A szöveget a közös szerkesztő `quote` módja írja: a TipTap csak a közös
séma elemeit ismeri (bekezdés, félkövér, dőlt, felsorolás, sortörés), tehát
a beillesztett címsor vagy link szövegként marad meg, formázás nélkül, és a
kimenet JSON, nem HTML. A belső kalkuláció panel és a BOM költségmezői csak
`quotes.costs.view` mellett jelennek meg; a „Termékké alakítás” gomb csak
`products.manage` mellett.
