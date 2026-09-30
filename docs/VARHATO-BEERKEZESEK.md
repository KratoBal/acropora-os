# Várható beérkezések

Balázs kérése, 2026-09-30: a beszállítói számla feldolgozása induljon el magától,
amikor megérkezik. Amikor Luca a beszerzést indítja, a „Várható beérkezések”
listából válasszon, és onnan menjen tovább a bevételezésre.

## Egy tétel egy rendelés

Egy várható beérkezés egy beszállítói RENDELÉS (`ExpectedArrival`).

- A proforma nyitja meg, a számla ugyanahhoz a rendeléshez érkezik.
- A kettőt a rendelésszám köti össze. Az Aquarioomnál mindkét dokumentum első sora
  „AQUARIOOM Order n° …” (nautilus mérése, #1235): mind az öt rendelésnél 1:1
  párosodnak, azonos sorokkal és végösszeggel.
- Rendelésszám nélkül a számlaszám a kulcs.
- A beszállító kulcsa a normalizált adószám, vagy a név, ha a dokumentum nem hozza.

## Az első rész (ez a PR): a beérkezés

`apps/api/src/purchasing/expected-arrivals/`

- **Gmail.** Az info@ postafiókból, csak olvasásra, a figyelt feladók PDF-mellékletes
  leveleit húzza le.
  - A feladókat az illesztők nevezik meg (`SupplierPdfAdapter.senders`, #1235), és a
    `SUPPLIER_INVOICE_MAIL_SENDERS` bővítheti a listát.
  - Az illesztőt továbbra is a PDF tartalma választja; a feladó csak szűrő.
- **Minden PDF-re:**
  1. eltárolja a bájtokat a lenyomattal együtt (`IncomingSupplierDocument`);
  2. beolvassa ugyanazzal az olvasóval, mint a kézi feltöltés;
  3. megnyitja vagy kiegészíti a rendelés tételét;
  4. ha a beszállító ismert (adószám alapján), lefuttatja a sor-javaslatot (P-026),
     és a válaszokat a dokumentummal együtt tárolja.
- **Amit nem nyit új tételnek:**
  - **Duplikátum:** ugyanazok a bájtok, vagy ugyanaz a fajta ugyanazzal a
    számlaszámmal. Ilyet küld a De Jong finance@ emlékeztetője, amely a számlát újra
    csatolja.
  - **Olvashatatlan PDF:** a hibakódjával tárolódik, és semmi nem kerül kitalálásra.
  - **Le nem tölthető levél:** nem kerül a naplóba, ezért a következő futás újra
    megpróbálja.
- **Futtatás.** Időzítő, a meglévő minta szerint, alapból KIKAPCSOLVA
  (`SUPPLIER_INVOICE_MAIL_SYNC_ENABLED`). Kézzel is indítható:
  `POST /purchasing/expected-arrivals/sync`; az állapot: `GET` ugyanitt.
- **Bevételezés itt nincs.** Az ember dolga marad.

## A NAV-számlák behúzása időzítőre

A kód már megvan (`nav-incoming-invoice.scheduler.ts`), és a
`NAV_INVOICE_SYNC_ENABLED=true` kapcsolja be. Éles bekapcsolás csak Balázs igenjével,
a Várható beérkezések kiadásával együtt.

## A második rész: a lista, a részlet és a bevételezés

- **A lista:** `GET /purchasing/expected-arrivals`. Egy listán áll a levélből jött és a
  NAV-ból jött tétel, forrás szerint jelölve (acrobot döntése, 2026-09-30).
  - A levélből jött, nyitott rendelés egy sor. Ha még csak a proformája érkezett meg,
    látszik, de nem vételezhető be.
  - A NAV-ból a még be nem vételezett (NEW, DATA_FETCHED) számlák kerülnek ide, a mai
    NAV-előtöltés címével.
  - A lista a legutóbb érkezett tétellel kezdődik.
- **A részlet:** `GET /purchasing/expected-arrivals/:id`. A szerkesztőnek adja a számla
  beolvasott adatait és az érkezéskor tárolt javaslatokat.
  - Proforma-rendelésnél és már bevételezett tételnél 409-cel, magyar mondattal
    utasít el.
- **A szerkesztő:** a `/beszerzes/uj?beerkezes=<id>` a levélből jött számlával nyílik
  meg.
  - Ugyanúgy előtölt, mint a fájlfeltöltés (`applySupplierInvoice`), és az ismert
    beszállítót ki is választja.
  - A tárolt javaslatok a sorokra kerülnek a saját audit-futásukkal együtt, és ezekre
    a sorokra nem kér újat.
- **A mentés:** az `expectedArrivalId` a számlával EGY tranzakcióban RECEIVED-re
  állítja a tételt (`purchase-invoice.repository.ts`), és a tétel lekerül a listáról.
  Egy második bevételezést `EXPECTED_ARRIVAL_ALREADY_RECEIVED` állít meg, mielőtt
  bármilyen készlet mozdulna.

## Ami még jön

- **A harmadik rész:** a „Várható beérkezések” menüpont a Beszerzés alatt, egy listán
  a levélből és a NAV-ból jött, még be nem vételezett számlákkal, forrás szerint
  jelölve.
