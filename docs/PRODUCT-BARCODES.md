# Termékvonalkódok

A `ProductBarcode` tábla korábban létezett, és két kereső már olvasta is
(`pos-product-search.repository.ts`, `purchase-product-search.repository.ts`),
de **semmi nem írt bele**, ezért üresen állt. A bolti beolvasás ma úgy működik,
hogy a vonalkód magában a cikkszám mezőben ül, mert az UNAS-ban nincs külön EAN
mező.

Ez a leírás az első lépést dokumentálja: a vonalkód kap egy saját helyet.
**Átnevezés nincs**, a cikkszám mezőben minden marad, ahogy volt.

## Adatmodell

```prisma
model ProductBarcode {
  id        String  @id @default(cuid())
  variantId String
  code      String  @unique
  isPrimary Boolean @default(false)
}
```

A modell nem változott. Két dolog következik belőle, és mindkettő szándékos:

- **A kód az egész katalógusban egyedi**, nem csak változaton belül. Egy
  beolvasás így pontosan egy változatot ad, további kontextus nélkül.
- **Az „egy elsődleges változatonként" szabályt az alkalmazás tartatja be**, nem
  adatbázis-megszorítás. A Prisma nem tud részleges egyedi indexet (`WHERE
isPrimary`) leírni, egy `[variantId, isPrimary]` egyedi index pedig a MÁSODIK
  NEM-elsődleges vonalkódot is tiltaná, ami pont az, amit engedni akarunk.
  Ezért a művelet serializable tranzakcióban fut.

## Felület

A termék adatlapján, a változat kártyáján. Egy változatnak több vonalkódja
lehet, közülük egy az elsődleges.

- Az első felvitt vonalkód automatikusan elsődleges lesz. Egyetlen vonalkód,
  ami nem elsődleges, olyan állapot, amit senki nem akar.
- Az elsődleges törlésekor a maradékból a következő lép a helyére, tehát ha van
  vonalkód, pontosan egy elsődleges is van.
- A beviteli mező egy sima szövegmező űrlapban. A kézi olvasó beírja a
  számokat, majd Entert küld -- **a submit-on-Enter maga a scanner-támogatás**,
  eszközfüggő kód nem kell hozzá.

## Végpontok

Mind `products.view` (olvasás) vagy `products.manage` (írás) jogot igényel.

| Végpont                                                 | Leírás                                       |
| ------------------------------------------------------- | -------------------------------------------- |
| `GET /product-barcodes/:variantId`                      | A változat vonalkódjai                       |
| `POST /product-barcodes/:variantId`                     | Új vonalkód (`code`, opcionális `isPrimary`) |
| `PATCH /product-barcodes/:variantId/:barcodeId/primary` | Elsődlegessé tesz                            |
| `DELETE /product-barcodes/:variantId/:barcodeId`        | Törlés                                       |

Ütközésnél a hibaüzenet **megnevezi a másik cikkszámot**. A végpont
`products.manage` jogot igényel, tehát az olvasó belsős munkatárs; a puszta
„már használatban" üzenet egy tízmásodperces javításból keresgélést csinálna.

## Vonalkód-normalizálás

`parseBarcode` (`apps/api/src/products/barcode.util.ts`):

- eltávolítja a szóközöket, a nem törő szóközt, a nulla szélességű
  karaktereket és a BOM-ot -- ezeket az olvasó és a táblázatkezelő is hozzáadja,
  és egyik sem látszik semmilyen felületen;
- nagybetűsít, hogy a keresés találjon;
- csak számot és angol nagybetűt enged; **az írásjelet elutasítja, nem
  eldobja** -- egy csendben kiszedett kötőjel két különböző kódot mosna egybe;
- az **EAN ellenőrző számjegyet ellenőrzi, és hibás számjegy esetén elutasít.**

### Miért nem zárja ki ez a belső kódokat

A szabály a `false` értékre szűr, **soha nem a `null`-ra**, és ez a különbség
tartja használhatónak a boltot:

| kód                                       | ellenőrzés | eredmény       |
| ----------------------------------------- | ---------- | -------------- |
| `5901234123457` (13 jegy, jó számjegy)    | `true`     | bekerül        |
| `5901234123458` (13 jegy, rossz számjegy) | `false`    | **elutasítva** |
| `ACRO12345` (nem EAN alakú)               | `null`     | bekerül        |

A bolt saját belső számozása nem EAN alakú, tehát `null`-t ad, és érintetlen
marad. Amit a szabály kizár, az a **kitalált EAN**: olyan kód, amely EAN-nak
adja ki magát, de a saját ellenőrző számjegye ellentmond neki. A katalógusban
hét ilyen ismert (öt AquaForte UV-C izzó és két Grotech bögre, ahol valaki a
variánsok utolsó jegyét a teljesítményhez rendelte).

Ezért az ellenőrzés **két helyen** van, és ez nem redundancia: az egyszeri
betöltő listája egyszer fut le, a beolvasó mező viszont naponta kap kódot
emberi kézből.

## Egyszeri betöltés a meglévő vonalkódokhoz

A cikkszám mezőben álló vonalkódok bemásolása a táblába. **A betöltő soha nem
ír `sku`-t**; csak olvassa, hogy megtalálja a változatot.

### A fájl formátuma

Ez szerződés a lista előállítójával, nem találgatás. Fejléces CSV:

```csv
unas_id,barcode,isPrimary
159850145,5901234123457,igen
```

A terméket **vagy** `unas_id`, **vagy** `sku` azonosítja, sosem mindkettő. A
lista az UNAS oldaláról készül, ahol csak UNAS-azonosító létezik -- a
`variantId` az Acropora belső azonosítója, amit kívülről senki nem ismerhet --,
ezért az `unas_id` a várt oszlop. A `sku` kézzel írt fájlhoz marad meg.

**A fejléc kötelező**, és név szerint olvassuk az oszlopokat: egy felcserélt
oszlopsorrend így hangosan elszáll, nem vonalkódokat importál cikkszámként. Ha
mindkét azonosító szerepel a fejlécben, a betöltő elutasítja a fájlt -- hogy
melyik nyerne, az csendes találgatás lenne arról, hova kerül a vonalkód.

### A UNAS-azonosító terméket nevez meg, nem változatot

Az `unas_id` az `ExternalReference(UNAS, "Product", externalId)` soron keresztül
egy **termékre** mutat, pontosan úgy, ahogy a szinkron írja. Egy termék viszont
több változatot is tarthat (az UNAS variánskészletes termékei helyben
változatonként külön sorra bomlanak).

- Egy változat esetén a feloldás egyértelmű.
- **Több változat esetén a sor `AMBIGUOUS_VARIANT` eredményt kap, és NEM kerül
  be.** Egy vonalkód pontosan egy változaté, a fájl viszont nem mondja meg,
  melyiké. A kimenet felsorolja a szóba jövő cikkszámokat, és a döntés emberé
  marad. Rossz polcra tett vonalkód rosszabb, mint egy kihagyott sor.

### Futtatás

```bash
cd /path/to/acropora-os
pnpm --filter @acropora/api barcode-import -- vonalkodok.csv --dry-run
pnpm --filter @acropora/api barcode-import -- vonalkodok.csv
```

A `--dry-run` minden keresést és döntést elvégez, de **semmit nem ír**. Éles
adatbázison érdemes ezzel kezdeni.

### Amit garantál

- **Idempotens.** Egy már bent lévő kód `ALREADY_PRESENT`, és a futás megy
  tovább. Egy megszakadt futás után az újrafuttatás biztonságos és unalmas.
- **Egyetlen sor sem állítja meg.** Minden sor kap egy eredményt, és a végén
  összesítés jön. Egy 412. sornál megálló futás után senki nem tudná, mi
  történt és mi nem.
- **Számot ad.** Létrehozva / már megvolt / más változaté / ismeretlen
  azonosító / több változat (döntés kell) / érvénytelen vonalkód / hibás EAN
  ellenőrző jegy / hibás sor / duplikátum a fájlban.

Kihagyott sorokkal a futás **sikeres** (kilépési kód 0): a kihagyás az adatról
szóló tény, és mind ott áll a kimenetben. Nem-nulla kilépési kód csak akkor van,
ha a fájl olvashatatlan vagy a fejléce hibás.
