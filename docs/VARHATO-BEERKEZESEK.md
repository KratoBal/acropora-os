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

## Marine Aquatics (a negyedik PDF-illesztő)

`adapters/marine-aquatics.pdf-adapter.ts`. Mérve 8 PDF-en, 7 levélből (2026-04..09,
az info@ postafiókból, feladó: r.macek@marine-aquatics.eu). Mind a 8 figyelmeztetés
nélkül olvasható, és a sorok összege egyezik a végösszeggel.

- A számla és a proforma ugyanazt a rendelésszámot hordozza („Order No.: | 18260”),
  ezért párosodnak.
- Az előleg-elszámoló számla negatív sora („PRE-PAYMENT …”) fizetés, nem áru: kimarad.
  A nettó végösszeg az áruké, nem a 0,00-s fizetendő.
- A végösszeg egész euróra kerekített. Az 1 eurónál kisebb eltérés „Kerekítés” díjsor
  lesz, a nagyobb figyelmeztetés marad.
- A szállítási számlán üres a rendelésszám, ezért a saját számlaszáma a kulcs.
- **Nyitott pont: a javított számla.** A 32600434-es számla kétszer jött (eredeti és
  „UPDATED INVOICE”, 15 perc különbséggel), és a javított változatban eggyel több sor
  áll. A mai szabály ugyanazt a fajtát ugyanazzal a számlaszámmal duplikátumnak veszi,
  tehát a javított változat elveszne, és az eredeti maradna. Hogy mi legyen helyette,
  az döntés, nem kód.

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

## A harmadik rész: a menüpont és az oldal

- **Menüpont:** „Várható beérkezések” a Pénzügy csoportban, közvetlenül a „Beszerzés”
  alatt (`/beszerzes/varhato`, `purchasing.view`). Új csoport nincs (acrobot,
  2026-09-30).
- **A lap:** egy táblázat, forrás szerint szűrhető (Összes, Levélből, NAV). A sorok:
  - forrás, beszállító, rendelés és számlaszám, érkezés, nettó összeg;
  - a sorok száma, és hány sorra van javaslat;
  - állapot: „Bevételezhető”, vagy „Csak proforma, a számla még nem érkezett meg”.
- **Kattintás:** egy bevételezhető sor a szerkesztőbe visz, előtöltve; a proforma sora
  nem kattintható.
- **A levél-behúzás:**
  - a lap tetején egy mondat mondja meg, magától fut-e;
  - a „Levelek ellenőrzése” gomb (`purchasing.manage`) kézzel indítja.
