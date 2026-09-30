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

## Ami még jön

- **A második rész:** a lista és a részlet végpontja; a szerkesztő megnyitása
  `?beerkezes=<id>` paraméterrel, előtöltve és a tárolt javaslatokkal; mentéskor a
  tétel RECEIVED lesz, és lekerül a listáról.
- **A harmadik rész:** a „Várható beérkezések” menüpont a Beszerzés alatt, egy listán
  a levélből és a NAV-ból jött, még be nem vételezett számlákkal, forrás szerint
  jelölve.
