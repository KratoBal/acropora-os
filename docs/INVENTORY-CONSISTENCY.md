# Készletkonzisztencia: Acropora OS mint a készlet hiteles forrása

Státusz: folyamatban (checkpoint 1-5 elkészült - lásd `ROADMAP.md`/audit
jegyzőkönyv). Ez a dokumentum a **leltár, beszerzés és POS folyamatok
tényleges átvezetését** (checkpoint 3), a **UNAS rendelésimport
delta-logikáját** (checkpoint 4) és a **read-only reconciliation/
diagnosztikát** (checkpoint 5) írja le úgy, ahogy ténylegesen elkészült.
A **mutáló repair API** és a **teljes health/monitoring felület**
tervezett, de még nem implementált - lásd az egyes szakaszok saját "Ismert
korlátok"/"Biztonságos javítási terv" jegyzeteit.

## Alapelv

Az Acropora OS a készlet **source of truth**-ja, nem a UNAS. A UNAS
termékadat-master (név, ár, leírás, kép), de a belső készletkönyvelést az
Acropora OS vezeti - a UNAS-ban látott készlet mindig az Acropora OS által
számított, aktuális abszolút készlet **tükörképe**, soha nem fordítva (azon
egy kivétellel, hogy a webshopon leadott rendelés maga az esemény, amit
könyvelni kell - de a *könyvelt mennyiséget* onnantól az Acropora OS
tekinti hitelesnek).

## Egységes készletmódosító primitív

`apps/api/src/common/inventory-movement-writer.ts` - `postInventoryMovement`.

Minden készletet érintő folyamat (leltár, beszerzés, POS, UNAS
webshoprendelés import/módosítás/sztornó, később reconciliation-javítás)
ezen a függvényen keresztül, a saját tranzakcióján *belülről* hívva
módosítja a készletet. Egy hívás:

1. ellenőrzi az `idempotencyKey`-t a `StockMovement` táblán - ismételt
   hívás ugyanazzal a kulccsal (retry, duplikált poll) nem könyvel
   kétszer;
2. létrehoz egy `StockMovement`-et és soronként egy `StockMovementLine`-t;
3. minden sor előjeles `quantityDelta`-ját atomian alkalmazza a
   `StockItem.onHand`-re, (variantId, warehouseId) kulcsonként
   sorosítva egy Postgres tranzakció-szintű **advisory lock**-kal;
4. ugyanabban a tranzakcióban soronként egy `UnasStockSyncOutbox` sort ír,
   ami az imént kiszámított ABSZOLÚT eredő készletet hordozza.

### Miért advisory lock, és nem `Serializable`/`SELECT ... FOR UPDATE`

A `StockItem` egyedi kulcsa `(variantId, warehouseId, locationId, lotId)` -
Postgres a NULL `locationId`/`lotId` értékeket nem tekinti egyenlőnek/
ütközőnek, így `SELECT ... FOR UPDATE` nem tud zárolni egy még nem létező
sort, és két egyidejű *első* mozgás akár `Serializable` alatt is
létrehozhatna két duplikált sort. A `pg_advisory_xact_lock(hashtextextended(
variantId || ':' || warehouseId, 0))` mindkét esetet (lost update ÉS
duplikált bootstrap-sor) egy mechanizmussal zárja ki, tranzakció-scope-pal
(automatikus feloldás commit/rollback-kor).

**Ismert, dokumentált maradék kockázat:** ha egy jövőbeli kódrészlet
megkerülné ezt a writer-t és közvetlenül írna `StockItem`-et, a fenti
védelem nem érvényesül rá. Emiatt szabály: **minden** készletmódosítás
kizárólag ezen a függvényen keresztül történhet - ezt a checkpointot
lezáró átvezetési munka (leltár/beszerzés/POS/UNAS import) pontosan ezt
garantálja majd kódszinten is.

### Negatív készlet

Üzleti döntés (2026-07-27): a POS-eladás eredményezhet negatív készletet,
figyelmeztetéssel a felhasználói felületen - a készletmozgást ettől
függetlenül mindig könyvelni kell. A webshop-import, sztornó, leltár és
bevételezés mindig a tényleges eseményt könyveli, a negatív-készlet
kérdés rájuk nem értelmezhető ugyanígy (ők nem "eladást tiltanak", hanem
egy már megtörtént eseményt rögzítenek). A writer maga sosem tiltja a
negatív eredményt - a `wentNegative` flaget visszaadja, a hívó dönt, mit
kezd vele (POS: figyelmeztetés).

## UNAS készletszinkron outbox

Modell: `UnasStockSyncOutbox` (`packages/database/prisma/schema.prisma`).
Mezők: `variantId`, `warehouseId`, `sku`, `targetOnHand` (abszolút érték),
`idempotencyKey` (egyedi), `sourceProcess`/`sourceRecordId`, `status`
(`PENDING`/`PROCESSING`/`SUCCEEDED`/`FAILED`/`DEAD_LETTER`), `attempts`,
`nextAttemptAt`, `lastError`, `resolutionNote`, `leaseExpiresAt`,
`claimedBy`, `sequence` (monoton, autoincrement), `createdAt`/`updatedAt`/
`processedAt`.

### "Régebbi esemény nem írhat felül egy újabbat" - két védelmi vonal

1. **Íráskor**: `postInventoryMovement` minden új sor létrehozása előtt
   lezárja (SUCCEEDED + `resolutionNote`) az adott (variantId,
   warehouseId) kulcshoz tartozó, még nyitott (`PENDING`/`FAILED`/
   `DEAD_LETTER`) sorokat - ténylegesen UNAS-hívás nélkül, mivel az új sor
   úgyis publikálni fogja az aktuális készletet.
2. **Feldolgozáskor** (`UnasStockSyncOutboxService.processOne`,
   közvetlenül a UNAS-hívás előtt): `isSuperseded` ellenőrzi, hogy létezik-e
   NÁLA frissebb (nagyobb `sequence`-ű) sor ugyanerre a kulcsra - ha igen,
   ez a sor UNAS-hívás nélkül SUCCEEDED-re zárul
   (`resolutionNote: superseded_by_outbox_id:<id>`). Ez fedi azt az esetet,
   amikor egy sor már `PROCESSING` volt (tehát az 1. védelmi vonal nem
   érte el), amikor egy újabb készletmozgás történt.

Mindkét eset SUCCEEDED státuszban zárul (a kért 5 státusz egyike marad),
`resolutionNote` különbözteti meg a tényleges UNAS-publikálástól.

**Miért garantált, hogy a legfrissebb állapot végül tényleg kiküldésre
kerül**: minden sikeresen könyvelt készletmozgás létrehoz egy saját outbox
sort. Ha egy sor (A) feldolgozás közben (PROCESSING) van, amikor egy újabb
mozgás egy másik sort (B) hoz létre, A nem szuperszedeálódik íráskor - de A
feldolgozásakor a worker az AKTUÁLIS `StockItem.onHand`-et olvassa újra
(nem a beírt `targetOnHand`-et), tehát A vagy a B előtti, vagy a B utáni
(véletlenül helyes) értéket küldi ki - mindegy, mert B saját, önálló sorként
biztosan feldolgozásra kerül egy következő worker-tick-ben, és ekkor is
frissen olvassa újra a készletet. B nem szuperszedeálódhat (nincs nála
frissebb sor még), tehát B mindenképp lefut és a ténylegesen legfrissebb
állapotot publikálja.

### Mit publikálunk ténylegesen: outboxban tárolt érték vs friss újraolvasás

A worker a UNAS-hívás előtt **újraolvassa** a `StockItem.onHand`-et (nem az
outbox sorban rögzített `targetOnHand`-et küldi). Mivel a `StockItem`
kizárólag a `postInventoryMovement`-en keresztül változik, és az minden
mozgáshoz ír egy outbox sort, ez az érték - amikor nincs nála frissebb
outbox sor a kulcsra (ezt az `isSuperseded` ellenőrzés már garantálja) -
bizonyíthatóan megegyezik a `targetOnHand`-del. A friss újraolvasás mégis
megmarad védekező rétegként: ha ez az invariáns valaha megsérülne (pl. egy
jövőbeli kód közvetlenül írna `StockItem`-et), a UNAS akkor is a ténylegesen
aktuális készletet kapja, nem egy elavult pillanatképet.

## Outbox worker: claim, retry, dead-letter

Fájlok: `unas-stock-sync-outbox.repository.ts` (adat-hozzáférés + claim
SQL), `unas-stock-sync-outbox.service.ts` (feldolgozási logika,
konfiguráció, hibaosztályozás), `unas-stock-sync-outbox.scheduler.ts`
(önütemező poller), `unas-stock-sync-outbox.controller.ts` (admin
API: lista, összegzés, manuális retry, manuális azonnali futtatás).

### Claim: `FOR UPDATE SKIP LOCKED`

Egyetlen SQL statement (writable CTE + `UPDATE ... FROM ... RETURNING`):

```sql
WITH claimable AS (
  SELECT id FROM "UnasStockSyncOutbox"
  WHERE (status IN ('PENDING','FAILED') AND "nextAttemptAt" <= now())
     OR (status = 'PROCESSING' AND "leaseExpiresAt" < now())
  ORDER BY sequence ASC
  LIMIT :batchSize
  FOR UPDATE SKIP LOCKED
)
UPDATE "UnasStockSyncOutbox" o
SET status = 'PROCESSING', attempts = o.attempts + 1,
    "leaseExpiresAt" = now() + make_interval(secs => :leaseSeconds),
    "claimedBy" = :workerId, "updatedAt" = now()
FROM claimable c WHERE o.id = c.id
RETURNING o.*;
```

Két worker-példány (vagy egy ütemezett tick és egy manuális "futtatás
most" admin hívás) egyidejű claim-je esetén a `FOR UPDATE SKIP LOCKED` miatt
egy sor sosem kerülhet mindkét eredményhalmazba - az egyik egyszerűen
kihagyja, amit nem tud azonnal zárolni. A SELECT és az UPDATE egyetlen
statement, nincs rés a "kiválasztás" és a "megjelölés" között.

### Elárvult PROCESSING sor helyreállítása (lease)

`leaseExpiresAt`: a claim-kor kap egy `now() + leaseSeconds` értéket. Ha a
worker összeomlik feldolgozás közben, a sor `PROCESSING` marad, de a
`leaseExpiresAt` lejár - a legközelebbi claim (akár ugyanaz, akár egy másik
worker-példány) a fenti WHERE-ág alapján visszaveszi. Nincs külön "reaper"
job - maga a claim query oldja meg. `leaseSeconds` alapértéke (120s)
érdemben hosszabb, mint a `setStock` hívás legrosszabb esete (a UNAS
kliens saját, belső 3-próbálkozásos retry-jával együtt).

### Retry és backoff

Exponenciális backoff jitterrel (ugyanaz a képlet-stílus, mint
`unasRetryDelayMs`-nél a UNAS kliensben):

```
delay = min(maxBackoffMs, baseBackoffMs * 2^(attempts-1)) * (0.75 + random()*0.5)
```

`attempts` a claim által már megnövelt érték (az adott próbálkozás sorszáma).
Alapértékek (`.env.example`): `UNAS_STOCK_SYNC_WORKER_BASE_BACKOFF_SECONDS=30`,
`..._MAX_BACKOFF_SECONDS=1800`, `..._MAX_ATTEMPTS=8`,
`..._INTERVAL_SECONDS=15`, `..._LEASE_SECONDS=120`, `..._BATCH_SIZE=20`.

### Átmeneti vs végleges hiba

`classifyError` (unas-stock-sync-outbox.service.ts): a UNAS kliens
zárt hibakód-készletéből (`UnasApiErrorCode`) a `REQUEST_INVALID`,
`FIELD_FORMAT_INVALID`, `XML_FORBIDDEN`, `XML_TOO_LARGE`, `XML_INVALID`,
`RESPONSE_SHAPE_INVALID` kódok **véglegesnek** számítanak (ugyanazt a
kérést újraküldeni sosem fog sikerülni) - ezek azonnal `DEAD_LETTER`-be
kerülnek, a próbálkozási keret elfogyasztása nélkül. Minden más kód
(hálózat, timeout, rate limit, 5xx, auth, kétértelmű 4xx, üzleti
elutasítás) átmenetinek számít és backoff-fal újrapróbálkozik, amíg el nem
éri a max próbálkozásszámot - onnantól szintén `DEAD_LETTER`.

Az utolsó hiba **soha nem** a nyers hibaüzenet/stack - kizárólag a
`UnasApiError.code` zárt enum-értéke, egy már kód-alakú (`^[A-Z0-9_:.-]+$`)
`Error.message`, vagy egy fix fallback (`UNAS_STOCK_SYNC_UNEXPECTED_ERROR`)
kerül eltárolásra - így secret/token sosem íródhat ki.

### Manuális retry

`UnasStockSyncOutboxRepository.manualRetry(id, actorUserId)`: kizárólag
`FAILED`/`DEAD_LETTER` sort mozgat vissza `PENDING`-be, nullázza az
`attempts`-et, törli a lease-t. Idempotens: ha a sor közben már nem
`FAILED`/`DEAD_LETTER` (pl. a worker időközben feldolgozta, vagy egy másik
admin már visszaküldte), `{ retried: false, status: <aktuális> }`-t ad
vissza hiba helyett. Admin API: `POST
/integrations/unas/stock-sync/outbox/:id/retry`
(`PERMISSIONS.INVENTORY_MANAGE`).

### Diagnosztika (jelenlegi kör)

`GET /integrations/unas/stock-sync/outbox/summary` - worker
enabled/interval, `PENDING`/`PROCESSING`/`SUCCEEDED`/`FAILED`/
`DEAD_LETTER` darabszám, utolsó ténylegesen sikeres UNAS-publikálás
időpontja (a szuperszedeált SUCCEEDED sorokat kiszűrve). `GET
.../outbox` (lista, szűrhető státuszra) és `GET .../outbox/:id`
(`PERMISSIONS.INVENTORY_VIEW`). A teljes health-check (order sync
utolsó futása, worker fut-e stb. egy nézetben) a következő
checkpointban készül el.

## UNAS webshoprendelések: delta-alapú készletkönyvelés és sztornó

Fájl: `apps/api/src/orders/unas-order-sync/unas-order-sync.repository.ts`.
Minden rendelésimport/frissítés/sztornó a `postInventoryMovement`-en
keresztül könyvel - nincs többé közvetlen `StockItem`/`StockMovement`/
`StockMovementLine` írás vagy UNAS `setStock` hívás ebben a fájlban.

### A könyvelt mennyiség forrása: a ledger, nem egy tárolt mező

Ahelyett, hogy egy új Prisma-mezőben tárolnánk "ennyi lett eddig levonva
ehhez a rendeléshez", ez a `StockMovement`/`StockMovementLine` ledgerből
számolódik minden alkalommal újra
(`computeBookedOutAndGeneration`): az adott rendelésre
(`referenceType="SalesOrder"`, `referenceId=orderId`) mutató összes
`SALE`/`RETURN_IN` mozgás sorait variánsonként előjelesen összegezve
(`SALE` = +, `RETURN_IN` = -) kapjuk a `bookedOut` térképet. Ez eleve
ellenálló megszakadt/replay-elt importra, párhuzamos ugyanazon-sor
variánsokra és utólagos `SalesOrderItem`-szerkesztésre, mert a ledger
maga a bizonyíték arra, mi történt ténylegesen - nincs külön "state"
mező, ami elszakadhatna tőle. **Nincs ehhez új Prisma-modell vagy
migráció** - ez tudatos döntés, nem elmaradt munka.

### Delta-algoritmus

Rendelésenként, variánsonként: `delta = targetOut - bookedOut`, ahol
`targetOut` a jelen UNAS-sighting alapján számolt, kumulált cél-mennyiség
(`aggregateTargetOut` - ugyanaz a variáns több UNAS-soron át egy célba
összegződik). `delta > 0` -> egy `SALE` mozgás sora `quantityDelta =
-delta`; `delta < 0` -> egy `RETURN_IN` mozgás sora `quantityDelta =
|delta|`; `delta = 0` -> nincs mozgás erre a variánsra. Egy hívás
(`applyOrderStockDelta`) akár mindkét irányú mozgást is posztolhatja
egyszerre (ha az egyik sor mennyisége nőtt, a másiké csökkent) - ilyenkor
két külön `postInventoryMovement`-hívás történik ugyanabban a
tranzakcióban, mert egy `StockMovement.type` csak egy érték lehet.
`targetOut` üres `Map` (minden korábban könyvelt variáns célja 0) a
sztornó/törlés esetén - ez automatikusan pontosan a még vissza nem adott
mennyiséget adja vissza, nem duplán.

### Idempotenciakulcs és az A -> B -> A eset

`UNAS_ORDER:<unasKey>:g<generation>:<SALE|RETURN>`, ahol `generation` a
rendelés eddigi `SALE`/`RETURN_IN` mozgásainak SZÁMA (ugyanaz a lekérdezés
adja, ami a `bookedOut`-ot is számolja, az order-szintű advisory lock
alatt olvasva). **Ez tudatos eltérés** a checkpoint saját javasolt
hash-alapú kulcsformátumától (`<canonicalInventoryStateHash>`): a hash
maga vetette fel a checkpoint specifikációja, hogy A -> B -> A esetén a
második A ugyanazt a hash-t, tehát ugyanazt a kulcsot adná, mint az
első A - ezt `postInventoryMovement` idempotencia-ellenőrzése tévesen már
lekönyveltként kezelné. A ledger-alapú generation-számláló szigorúan
monoton (minden tényleges posztolás eggyel, vagy SALE+RETURN egyidejű
posztolásakor kettővel nő), és nem igényel se hash-t, se külön verzió-
mezőt: egy valódi retry (pl. egy összeomlott worker újrafutása, mielőtt
bármi új sighting érkezne) ugyanazt a deltát ugyanarra a generation-re
számolja újra, amit `postInventoryMovement` saját idempotencyKey-
ellenőrzése természetesen kiszűr; egy később érkező, valódi átmenet
(akár A -> B -> A) mindig magasabb generation-t lát, tehát friss kulcsot
kap.

### Konkurencia és tranzakció

`lockUnasOrder` (`pg_advisory_xact_lock(hashtextextended('UNAS_ORDER:'||
key, 0))`) az adott rendelés STABIL UNAS `key`-ére zárolva - nem a helyi
cuid-ra, mert `createNewOrder` a helyi id létrejötte előtt számolja ezt -
ugyanaz a minta, mint `inventory-movement-writer.ts`
`lockVariantWarehouse`-a, csak rendelés-szinten. A zárolás a ledger-
olvasás ELŐTT történik, hogy két egyidejű sighting (ütemezett batch-tick
és egy manuális "Rendelés frissítése" admin-hívás) sose olvashassa
ugyanazt a "már könyvelt" pillanatképet, mielőtt bármelyik commitolna.
Minden lépés (zárolás, ledger-olvasás, delta-számítás, `SalesOrder`/
`SalesOrderLine` frissítés, `postInventoryMovement` hívás(ok)) ugyanabban
a hívó-szintű tranzakcióban történik (`apply()`/`refreshOrder()` saját
`$transaction`-je, `Serializable` izolációval) -
`postInventoryMovement` sosem nyit saját tranzakciót. Több variáns esetén
a writer saját, variantId szerinti determinisztikus zárolási sorrendje
(lásd feljebb) érvényesül, változatlanul.

### Nem kapcsolt (unlinked) termékek és a FAILED -> OK előreoldás

`resolveEffectiveVariantId` egyetlen, mindkét helyen (a
`SalesOrderLine`-írásban és a `targetOut`-aggregálásban) használt szabály:
egy technikai költségsor sosem készletes; egy már OK-lekötött meglévő sor
MEGTARTJA a perzisztált variantId-ját (akkor is, ha a friss SKU-keresés
most máshogy vagy sikertelenül oldódna) - a készlettörténet sosem íródik
felül csendben; egy FAILED meglévő sor, aminek a SKU-ja most feloldódik,
előre-oldódik az új variantId-ra; minden más eset (még mindig
feloldatlan, vagy egy új sor sikertelen kereséssel) nem készletes. Ebből
következik: egy ismeretlen SKU sosem nyúl a készlethez és sosem kap
outbox-sort; amikor később linkelhetővé válik, a még szükséges delta
PONTOSAN egyszer könyvelődik (a `bookedOut` addig 0 volt rá); egy korábban
linkelt, később fel nem oldható tétel megőrzi a történeti variantId-ját,
így a sztornója biztonságos marad (a sztornó-ág nem is végez élő
SKU-keresést, csak a perzisztált `existing.lines`-ra és a ledgerre
támaszkodik).

### UNAS-státusz -> Acropora állapot mapping (a sztornó/törlés alapja)

`unas-order-status.mapper.ts`: `close_fault` -> `CANCELLED`, `close_ok`
-> `COMPLETED`, `open_prepare` -> `ON_HOLD`, `open_normal`/egyéb ->
`CONFIRMED`. Kizárólag a `CANCELLED`-be történő ÁTMENET (azaz `existing.
status !== "CANCELLED"` -> `newStatus === "CANCELLED"`) váltja ki a
sztornó-ágat (`targetOut` = üres `Map`); egy már `CANCELLED` rendelés
ismételt `CANCELLED` sightingja szándékosan semmit nem csinál a
készlettel (lásd a kód hosszú kommentjét) - a ledger-alapú `bookedOut`
ellenőrzés emiatt is biztonságos lenne, ha mégis lefutna, de az explicit
korai-kilépés elkerüli a felesleges munkát.

### Felfedezett és javított látens hiba

Egy rendelés, ami MÁR `CANCELLED`/`close_fault` állapotban érkezik meg
első sightingra (soha nem volt élő), a régi kódban feltétel nélkül kapott
egy `SALE` mozgást, amit soha nem lehetett visszafordítani (az aktív ->
CANCELLED átmenet-ág egy születésétől fogva halott rendelésre sosem fut
le). Az egységes delta-modell mellékhatásként javítja ezt: `createNewOrder`
`targetOut`-ja üres, ha a rendelés már CANCELLED-ként érkezik, így
`delta = 0` minden variánsra - nincs mozgás, nincs mit visszafordítani.

### Meglévő (checkpoint előtti) rendelések migrációs/aktiválási biztonsága

Nincs Prisma-migráció, tehát nincs backfill-kockázat: minden már importált
rendelés `StockMovement`/`StockMovementLine` ledgerje pontosan azt
tükrözi, ami ténylegesen lekönyvelődött a régi kóddal - ugyanaz a ledger,
amit az új `computeBookedOutAndGeneration` olvas. Az első resync
deploy után minden érintett rendelésre helyesen számolja ki a deltát a
VALÓDI ledger-állapotból, különleges eset-kezelés nélkül: ha egy rendelés
korábban pl. 3 egységet könyvelt el SALE-ként és azóta nem változott, a
következő sighting `targetOut=3`, `bookedOut=3`, `delta=0` - nincs
újra-levonás. Egyetlen előfeltétel: hogy a régi kód ugyanazt a
`referenceType="SalesOrder"`/`referenceId`-mintát használta - ez már
korábban is így volt (l. a régi `reverseOrder` és a manuális
stock-mozgás-létrehozás kódja), tehát a ledger visszamenőleg is helyesen
olvasható.

## Készlet-reconciliation, diagnosztika és biztonságos javítási folyamat

Fájlok: `apps/api/src/common/stock-ledger.util.ts` (megosztott előjel-
konvenció), `apps/api/src/inventory/stock-reconciliation.{types,repository,
service,controller}.ts`, `apps/api/src/orders/unas-order-sync/
unas-order-stock-audit.{types,repository,service,controller}.ts`.

**Ez a modul kizárólag olvas.** Egyik fájl sem hív `create`/`update`/
`upsert`/`delete`-t semelyik táblán - lásd az egyes repository-k saját
TypeScript interfészét (`StockReconciliationDatabase`,
`UnasOrderStockAuditDatabase`), amik STRUKTURÁLISAN sem tartalmaznak
mutáló metódust, így az erre épülő kód nem is tudna véletlenül írni.

### Igazságforrások és amit önmagában bizonyítanak

1. **`StockMovement`/`StockMovementLine` ledger** - mit *könyveltünk el*.
2. **`StockItem.onHand`** - a jelenlegi, gyorsítótárazott abszolút készlet.
3. **`UnasProductSnapshot.reportedStock`** - amit a UNAS *jelent* (termék-
   szinten, nem variánsonként - lásd alább).
4. **`UnasStockSyncOutbox`** - mi van *folyamatban* a kettő összehangolására.

### A ledger NEM bizonyítja önmagában az abszolút készletet - miért

Két külön, egymástól független ok miatt:

**a) `ADJUSTMENT` mozgás előjele nem rekonstruálható.** A
`StockMovementLine.quantity` MINDIG abszolút értékben tárolódik
(`postInventoryMovement`: `quantity: line.quantityDelta.abs()`). Ez rendben
van azoknál a típusoknál, ahol az üzleti előjel FIX (egy `SALE` mindig
csökkent, egy `PURCHASE_RECEIPT` mindig növel) - de egy leltári
`ADJUSTMENT` delta (`countedQty - expectedQty`,
`inventory-count.repository.ts`) lehet pozitív VAGY negatív, és mindkét
eset azonos alakban tárolódik. A ledgerből utólag nem dönthető el, melyik
volt. Ez a jelenlegi séma valódi, strukturális korlátja, nem ebben a
checkpointban bevezetett hiba - `stock-ledger.util.ts` `
LEDGER_PROVABLE_MOVEMENT_SIGN`/`SIGN_AMBIGUOUS_MOVEMENT_TYPES` dokumentálja
pontosan. Bármely (variantId, warehouseId) pár, amit valaha `ADJUSTMENT`
mozgás érintett, `INVALID_LEDGER_DATA` - a ledger összege ott sosem
állítható elméleti készletnek, még akkor sem, ha véletlenül egyezne az
`onHand`-del.

**b) Nem-ledgerelt történeti baseline.** A leltár "csak baseline" sora
(`inventory-count.repository.ts`, `baselineOnlyLines` ág) közvetlenül,
`setStockItemQuantity`-n keresztül állítja be az `onHand`-et, mozgás
LÉTREHOZÁSA NÉLKÜL (ez a checkpoint 3-ban elfogadott, dokumentált kivétel).
Ugyanez igaz minden, ezt a checkpointot megelőző, közvetlen `StockItem`-írásra
is. Egy ilyen variáns/raktár párnál a ledger összege triviálisan 0 (nincs
mozgás), miközben az `onHand` bármi lehet - ez `HISTORICAL_BASELINE_UNKNOWN`,
és **sosem** kezelendő úgy, mintha "a ledger szerint 0 lenne a készlet".

Csak az a (variantId, warehouseId) pár tekinthető ledger-bizonyítottnak,
ahol van legalább egy mozgás ÉS egyik sem `ADJUSTMENT`/fel nem ismert
típusú - ekkor `ledgerExpectedOnHand` = a mozgások előjeles összege, és
ez összehasonlítható `StockItem.onHand`-del.

### Reconciliation-státuszok (`ReconciliationStatus`)

Futásidőben számított TypeScript union, NEM Prisma-enum (nincs migráció
hozzá - felesleges lenne). Eldöntési sorrend (`stock-reconciliation-
status.util.ts` `computeReconciliationStatus`): `MISSING_STOCK_ITEM` (nincs
`StockItem` sor) → `HISTORICAL_BASELINE_UNKNOWN` (nincs semmilyen mozgás) →
`INVALID_LEDGER_DATA` (van mozgás, de előjel-kétértelmű) →
`LOCAL_LEDGER_MISMATCH` (a bizonyítható ledger-összeg eltér `onHand`-től) →
`SYNC_FAILED` (legutóbbi outbox-sor `DEAD_LETTER`) →
`PROCESSING_LEASE_EXPIRED` (legutóbbi sor `PROCESSING`, lejárt lease-szel)
→ `MISSING_UNAS_LINK` (nincs UNAS-termékadat) → `UNAS_BEHIND_PENDING_SYNC`
/ `UNAS_MISMATCH_NO_PENDING_SYNC` (UNAS és helyi eltér, attól függően, van-e
már várakozó korrekció) → `CONSISTENT`. A helyi integritás (ledger/onHand)
mindig megelőzi a UNAS-összevetést - egy hibás helyi szám mellett a UNAS-
eltérés vizsgálata értelmetlen lenne.

**PENDING vs FAILED vs DEAD_LETTER**: egy még próbálkozási kerettel
rendelkező `FAILED` sor ugyanabba a "van már várakozó korrekció" kategóriába
esik, mint `PENDING` (`UNAS_BEHIND_PENDING_SYNC`) - csak a véglegesen
feladott `DEAD_LETTER` kap külön, `SYNC_FAILED` státuszt. Ez szándékos
egyszerűsítés: a kért 10 státusz nem tartalmaz külön "retry-ra vár, de már
egyszer elbukott" kategóriát, és a `FAILED`/`DEAD_LETTER` megkülönböztetés
maga az `OutboxDiagnosis.latestStatus` mezőben végig látható marad.

### UNAS-összevetés: miért csak variánsonként, nem raktáranként

A `UnasProductSnapshot.reportedStock` TERMÉK-szintű (`UnasProductSnapshot.
productId` egyedi), sosem variáns- vagy raktár-szintű - a UNAS nem ismeri
az Acropora OS belső raktárait. Ugyanazt a leegyszerűsítést követi, amit a
korábbi (checkpoint 3 előtti) `findStockDiscrepancies` már bevezetett:
egy több-variánsú termék csak az ELSŐ variánsával (`createdAt asc, id asc`
sorrend szerint) van összevetve, a többi variáns `unasOnHand=null`,
`MISSING_UNAS_LINK` státusszal. `unasVsLocalDelta` az érintett variáns
ÖSSZES raktárban lévő `onHand`-jét összegzi (nem csak az adott sor
raktáráét), mert a UNAS is csak egyetlen, raktár-agnosztikus számot ismer.

### Outbox-diagnosztika (`OutboxDiagnosis`)

Minden (variantId, warehouseId) párra: `latestStatus`, `hasPendingCorrection`
(van-e még nem szuperszedeált `PENDING`/`FAILED` sor), `processingLeaseExpired`
(csak `PROCESSING`-nál értelmezett), `onlySupersededRows`,
`latestRecordedTargetOnHand`, `latestSuccessMatchesCurrentLocal` (az utolsó
VALÓDI - nem szuperszedeált - publikálás `targetOnHand`-je egyezik-e a
jelenlegi `onHand`-del), `competingOpenRowCount`, `lastSuccessfulPublishAt`,
`lastFailureAt`.

### `GET /inventory/reconciliation` (admin, `INVENTORY_VIEW`)

Lapozott (`page`/`pageSize`, max 200), `variantId`/`warehouseId` szerint
szűrhető. `GET /inventory/reconciliation/missing-stock-item` - a
"kellene legyen `StockItem` sor, de nincs" eset (UNAS-linkelt, riportolt
készletű variáns a fő raktárban). `GET /inventory/reconciliation/summary`
- korlátozott batch-mérettel (`batchSize`, alapértelmezett 200) minden
lapon végigmegy, és csak a státuszonkénti darabszámot adja vissza - nem
tölt be mindent egyszerre a memóriába.

Minden lekérdezés batchelt: egy oldalnyi (variantId, warehouseId) párhoz
EGY lekérdezés megy a ledgerre, EGY a UNAS-termékadatra, EGY az outboxra -
sosem soronkénti (N+1) hívás.

### UNAS-rendelések historikus auditja (checkpoint 4 aktiválási feltétele)

`apps/api/src/orders/unas-order-sync/unas-order-stock-audit.*`. A
checkpoint 4 delta-motorja csak akkor tekinthető biztonságosan
aktiválhatónak MINDEN már importált rendelésre, ha ez az audit tiszta.

**Kockázati jelzők soronként** (`UnasOrderAuditRiskFlag`):
`MISSING_EXTERNAL_REFERENCE`, `DUPLICATE_UNAS_KEY`,
`ACTIVE_ORDER_ZERO_BOOKED` (élő rendelésnek van pozitív cél-mennyisége, de
a ledger szerint semmi nincs elkönyvelve rá - resync szükséges),
`CANCELLED_ORDER_POSITIVE_BOOKED` (sztornózott rendelésnek a ledger szerint
még van kint levő készlete), `NEGATIVE_BOOKED_QUANTITY` (szerkezetileg
lehetetlen állapot - több `RETURN_IN`, mint `SALE`).

**`targetOut` az auditban SOSEM élő UNAS-lekérdezésből származik** - a
jelenleg perzisztált `SalesOrderLine` sorokból (`variantId IS NOT NULL`
szerint összegezve). Ez pontosan ugyanazt adja, amit az élő delta-motor
`resolveEffectiveVariantId`/`aggregateTargetOut`-ja számolna, mert egy
feloldatlan/technikai sor már perzisztálva is `variantId=null`-lal
szerepel (l. `buildLineInputs`) - nincs szükség második, élesen kockázatos
UNAS-hívásra egy pusztán olvasó audithoz.

**Globális anomáliák** (nem soronkénti): `findDuplicateUnasKeys` (ugyanaz
a UNAS-kulcs több `SalesOrder`-hez), `findOrphanStockMovementReferences`
(egy `SalesOrder`-re hivatkozó `StockMovement`, ami már nem létező
rendelésre mutat).

`GET /orders/unas/stock-audit` (lapozott soronkénti audit), `GET .../
anomalies` (globális anomáliák), `GET .../summary` (a tényleges igen/nem
válasz: `safeToActivateWithoutBackfill` + `blockingReasons`).

### Meglévő UNAS-rendelések aktiválási terve

**Nincs szükség backfillre vagy migrációra**, mert a booked-mennyiség
modell (checkpoint 4) magából a ledgerből származik - minden már importált
rendelés `StockMovement`-jei pontosan azt tükrözik, amit a RÉGI kód
ténylegesen lekönyvelt, és ugyanezt a ledgert olvassa az új
`computeBookedOutAndGeneration` is. A helyes aktiválási sorrend:

1. Futtasd le `GET /orders/unas/stock-audit/summary`-t.
2. Ha `safeToActivateWithoutBackfill: false` - a `blockingReasons`/
   `auditPage` alapján derítsd ki, mely rendeléseknél mi a probléma
   (leggyakoribb várható eset: `ACTIVE_ORDER_ZERO_BOOKED` egy régi,
   checkpoint 4 előtt importált, de azóta nem resync-elt rendelésnél -
   ennek a megoldása egy egyszerű `refreshOrder`/soron következő batch-
   sync, NEM egy speciális migrációs szkript).
3. Csak ha az audit tiszta (vagy minden jelzett sor kézzel átvizsgálva és
   ártalmatlannak ítélve), tekintsd a delta-motort élesben megbízhatónak
   MINDEN meglévő rendelésre.
4. Az első resync minden érintett rendelésnél helyesen fog nulla deltát
   számolni, ha a state változatlan - nincs kockázata annak, hogy az
   éles bevezetés "újra levonná" a már meglévő rendeléseket.

### Biztonságos javítási terv (ebben a checkpointban NEM implementált mutáció)

A checkpoint kifejezetten megengedi, hogy a mutáló repair-mechanizmust
csak TERVEZZÜK, ha a jelenlegi auth/audit modell nem elég egyértelmű hozzá
- ez a döntés itt élt: a jelenlegi jogosultsági modell csak `INVENTORY_VIEW`/
`INVENTORY_MANAGE`-et ismer (utóbbi a `WAREHOUSE` szerepkörnek is jár), és
NINCS olyan Prisma-modell, ami egy repair-művelet reason/actor/előtte-utána
értékét auditálhatóan rögzítené. Emiatt ebben a checkpointban KIZÁRÓLAG a
read-only diagnosztika készült el; az alábbi terv a jövőbeli, mutáló
repair API-hoz:

**A. `StockItem` helyreállítása a bizonyított ledgerből** - csak
`ledgerProvable: true` párra engedhető meg; tranzakcióban, a writer saját
`lockVariantWarehouse`-ával; kötelező `reason`+`actorUserId`; előtte/utána
`onHand` rögzítve; ha a helyi abszolút készlet változik, egy `outbox` sor
is létrejön (a normál `postInventoryMovement`-en át egy dedikált
`RECONCILIATION` `sourceProcess`-szel - ez a `type` már létezik az enumban,
csak eddig senki nem használta); idempotenciakulcs
`RECONCILIATION_REPAIR:<variantId>:<warehouseId>:<expectedCurrentValue>`.

**B. UNAS újrapublikálása** - sosem közvetlen `setStock`; egy új, önálló
outbox-sor a jelenlegi helyes `onHand`-del, csak ha nincs már nála frissebb
várakozó sor (`isSuperseded`-hez hasonló ellenőrzéssel).

**C. Historikus baseline létrehozása** - csak kontrollált leltárból (a
meglévő `InventoryCount` folyamaton keresztül, nem egy külön "admin gomb"),
vagy explicit admin döntésből, világosan dokumentálva, hogy ez NEM
hétköznapi mozgás.

**Javasolt minimális Prisma-modell** (ha/amikor a fenti valóban
implementálásra kerül): egy `StockReconciliationRepair` tábla
(`id`, `variantId`, `warehouseId`, `reason`, `actorUserId`, `beforeOnHand`,
`afterOnHand`, `expectedCurrentValue`, `idempotencyKey` egyedi,
`createdAt`) - kizárólag audit-célra, nem egy általános workflow-motor.

**Repair API biztonsági követelmények** (a jövőbeli implementációhoz):
admin jogosultság (a jelenleginél szigorúbb, mint puszta
`INVENTORY_MANAGE` - ezt még meg kell tervezni), explicit `dryRun`,
kötelező `expectedCurrentValue` (optimista konkurencia - elutasítás, ha
időközben megváltozott), kötelező `reason`, `actorUserId` naplózása,
idempotenciakulcs, advisory tranzakciós lock, teljes tranzakció,
változás előtti újraellenőrzés, részletes eredmény visszaadása, tömeges
("minden eltérést egyszerre javíts") művelet alapértelmezetten tiltva.

## Konfiguráció

`.env.example` (production secret/config NEM módosult):

```
UNAS_STOCK_SYNC_WORKER_ENABLED=false
UNAS_STOCK_SYNC_WORKER_INTERVAL_SECONDS=15
UNAS_STOCK_SYNC_WORKER_STARTUP_DELAY_SECONDS=30
UNAS_STOCK_SYNC_WORKER_BATCH_SIZE=20
UNAS_STOCK_SYNC_WORKER_LEASE_SECONDS=120
UNAS_STOCK_SYNC_WORKER_MAX_ATTEMPTS=8
UNAS_STOCK_SYNC_WORKER_BASE_BACKOFF_SECONDS=30
UNAS_STOCK_SYNC_WORKER_MAX_BACKOFF_SECONDS=1800
```

## Ismert korlátok (folyamatosan frissül)

- Leltár, beszerzés, POS és UNAS webshoprendelés (import/módosítás/
  sztornó) **mind** a `postInventoryMovement`-en keresztül könyvelnek
  (checkpoint 3-4 lezárva) - közvetlen `StockItem`/`StockMovement` írás
  ezekben a folyamatokban nincs.
- A `StockItem` egyedi kulcsának NULL-`locationId`/`lotId` problémája
  (két duplikált sor keletkezhetne, ha valaki megkerülné az advisory
  lock-ot) máig nincs adatbázis-szinten (partial unique index)
  kikényszerítve - dokumentált, szándékos döntés a jelenlegi checkpoint
  kockázat/haszon mérlegelése alapján.
- A worker konkurencia- és lease-helyreállítási garanciáit igazoló
  integrációs teszt (`unas-stock-sync-outbox.repository.integration.spec.ts`)
  valódi Postgres-t igényel - ebben a sandboxban nem futtatható (lásd a
  projekt "sandbox limitations" jegyzetét), a usernek helyben kell
  lefuttatnia (`pnpm --filter @acropora/api test:integration`) a
  checkpoint végleges lezárásához.
- Ugyanez igaz a UNAS rendelés-delta motor `lockUnasOrder`/
  `lockVariantWarehouse` konkurenciavédelmére: a "két egyidejű import nem
  könyvel duplán" garancia valódi Postgres advisory lock-ot igényel.
  Checkpoint 5-ben elkészült ehhez a valódi Postgres integrációs teszt
  (`unas-order-sync.repository.integration.spec.ts` - két egyidejű 2->3
  resync ugyanarra a rendelésre, két különböző rendelés párhuzamos
  feldolgozása, több-variánsú rendelések ütközésmentessége), de a sandbox
  Prisma-generálási hiánya miatt itt még NEM futott le - a usernek helyben
  kell lefuttatnia (`pnpm --filter @acropora/api test:integration`) a
  checkpoint végleges lezárásához, ugyanúgy, mint az outbox worker saját
  integrációs tesztjét.
- A checkpoint 5 reconciliation/audit modulja szándékosan KIZÁRÓLAG
  read-only - nincs benne mutáló repair endpoint (lásd a "Biztonságos
  javítási terv" szakaszt a tervért) és nem hív élő UNAS API-t (a UNAS-
  összevetés a már meglévő, rendszeresen frissített
  `UnasProductSnapshot.reportedStock` mezőt használja, nem egy friss
  lekérdezést) - emiatt a "UNAS hiba ne tegye használhatatlanná a helyi
  auditot" követelmény jelenleg TRIVIÁLISAN teljesül (nincs élő UNAS-hívás,
  aminek egyáltalán el kellene tudnia hasalnia), nem egy külön
  hibakezelési logika miatt. Ha egy jövőbeli checkpoint élő UNAS-
  lekérdezést vezet be egy explicit "audit mode"-hoz, azt kötelező úgy
  megírni, hogy egy UNAS-oldali hiba a helyi ledger-vizsgálat eredményét
  ne érintse.
- A POS-eladás idempotenciájának ismert hiánya (nincs stabil kliensoldali
  checkout-azonosító) a checkpoint 3-ban elfogadott, még nyitott
  architekturális rés - ezt a UNAS-delta munka nem érinti.
