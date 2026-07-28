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

### Biztonságos javítási terv (checkpoint 5: még csak terv - checkpoint 6-ban A és B megvalósult, lásd lentebb)

A checkpoint 5 kifejezetten megengedte, hogy a mutáló repair-mechanizmust
csak TERVEZZÜK, ha a jelenlegi auth/audit modell nem elég egyértelmű hozzá
- ez a döntés itt élt: a jelenlegi jogosultsági modell csak `INVENTORY_VIEW`/
`INVENTORY_MANAGE`-et ismer (utóbbi a `WAREHOUSE` szerepkörnek is jár), és
NINCS olyan Prisma-modell, ami egy repair-művelet reason/actor/előtte-utána
értékét auditálhatóan rögzítené. Emiatt checkpoint 5-ben KIZÁRÓLAG a
read-only diagnosztika készült el; az alábbi terv volt a jövőbeli, mutáló
repair API-hoz - **checkpoint 6 ezt a tervet valósította meg A és B
típusra, lásd a "Checkpoint 6" szakaszt lentebb a tényleges
implementációért (a részletek némileg eltérnek az itteni eredeti
vázlattól, pl. az idempotenciakulcs pontos formátuma és a `StockItem`
saját üzleti kulcson - nem surrogate id-n - történő újraolvasása).**

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

## Checkpoint 6: auditálható repair, hiteles baseline és health/diagnosztika

A checkpoint 5 read-only reconciliation/diagnosztika eredményére építve ez
a checkpoint egy admin-only, EGYEDI rekordokra korlátozott, teljes
audittal rendelkező javítási mechanizmust ad hozzá, plusz egy health/
diagnosztika felületet - mindkettő szigorúan a checkpoint 5-ben már
felállított biztonsági elvek mentén (soha nem találgat, soha nem javít
tömegesen, soha nem hív élő UNAS API-t egy javításhoz).

### A legfontosabb biztonsági szabály

`LOCAL_FROM_PROVEN_LEDGER` repair KIZÁRÓLAG bizonyított abszolút
ledger-baseline esetén futhat. A `HISTORICAL_BASELINE_UNKNOWN` (és az
`INVALID_LEDGER_DATA`) állapot NEM "javítandó eltérés", hanem olyan
blokkoló bizonytalanság, amelyet csak kontrollált fizikai leltár és
explicit baseline létrehozása oldhat fel - ezt a repair-mechanizmus
(`evaluateLocalFromProvenLedgerPreconditions`,
`stock-reconciliation-repair.util.ts`) kódszinten kényszeríti ki: ha a
reconciliation `ledgerProvable: false`-t jelez, a repair `REJECTED`
státusszal (`LEDGER_NOT_PROVABLE`) áll meg, mielőtt bármit módosítana.

### Auth/audit-modell feltérképezése (a mutáció megépítése ELŐTT)

- Az aktuális felhasználó forrása mindig `@CurrentUser()`
  (`auth/decorators/current-user.decorator.ts`), ami az `AuthGuard` által
  már ellenőrzött Bearer-token vagy httpOnly session-cookie+CSRF alapján
  feloldott, szerveroldali `AuthenticatedUser`-t adja vissza - SOSEM egy
  kliens által küldött mező. A repair-kérés body-ja emiatt szándékosan NEM
  fogad el `actorUserId`-t.
- Jogosultság: bevezetve egy ÚJ, szűk `INVENTORY_RECONCILIATION_REPAIR`
  permission (`packages/types/src/auth.ts`), amit KIZÁRÓLAG `OWNER`/`ADMIN`
  kap meg - a sima `INVENTORY_MANAGE` (amit a `WAREHOUSE` szerepkör is bír
  a napi leltár/beszerzés/POS munkához) nem volt elég szűk egy olyan
  művelethez, ami közvetlenül felülírja a készlet "igazságát". A `MANAGER`
  szerepkör kifejezetten ki van zárva ez alól is (`ROLE_PERMISSIONS.MANAGER`
  szűrője).
- Audit-modell: nem volt megfelelő, általános előtte/utána+actor+reason
  napló a repóban - ezért egy célzott, KIZÁRÓLAG erre a célra szolgáló
  `StockReconciliationRepair` Prisma-modell készült (lásd lentebb), nem egy
  általános workflow-motor.
- Tranzakció/lock minta: ugyanaz az `pg_advisory_xact_lock`-alapú,
  tranzakció-scope-olt advisory lock (`lockVariantWarehouse`,
  `common/inventory-movement-writer.ts`), amit a writer és a UNAS
  rendelés-szinkron is használ - nincs új lock-mechanizmus bevezetve.

### `StockReconciliationRepair` Prisma-modell

Új migráció: `packages/database/prisma/migrations/20260728090000_add_stock_reconciliation_repair/`
(kézzel írt, mert a `prisma generate`/`migrate dev` ebben a sandboxban nem
fut - lásd "Ismert korlátok"). Csak ÚJ tábla/enum jön létre, semmilyen
meglévő adatot nem módosít. Mezők: `id`, `repairType`
(`LOCAL_FROM_PROVEN_LEDGER` | `REPUBLISH_LOCAL_TO_UNAS` - a "C" típus
szándékosan NINCS az enumban, lásd lentebb), `status` (`APPLIED` | `NOOP` |
`REJECTED` - szándékosan NINCS `FAILED`, mert egy valódi tranzakció-hiba
esetén a TELJES tranzakció visszagördül, beleértve magát az audit-sor
beszúrását is - soha nem maradhat "SUCCESS audit részleges módosítással"
állapot), `stockItemId` (nullable - egy jövőbeli baseline-típus miatt),
`variantId`, `warehouseId`, `actorUserId` (kötelező FK `User`-re),
`reason` (kötelező), `idempotencyKey` (egyedi), `expectedCurrentOnHand`,
`beforeOnHand`/`afterOnHand`/`ledgerExpectedOnHand` (mind nullable a
fenti szabályok szerint), `movementId` (fenntartva, ma mindig null - A/B
típus sosem hoz létre `StockMovement`-et), `outboxId`, `requestDetail`/
`resultDetail` (JSON, csak technikai, sosem rendelési/vevői adat),
`createdAt`/`completedAt`.

### Megvalósított repair-típusok

**A. `LOCAL_FROM_PROVEN_LEDGER`** (`stock-reconciliation-repair.repository.ts`
- `applyLocalFromProvenLedger`) - EGY tranzakción belül: advisory lock a
(variantId, warehouseId) párra -> `StockItem` friss újraolvasása a valódi
üzleti kulcsán (`variantId`+`warehouseId`+`locationId: null`+`lotId: null`
- NEM egy esetlegesen elavult surrogate id-n) -> a ledger-bizonyíthatóság
ÚJRA-számítása egy, a TRANZAKCIÓS kliens köré épített
`StockReconciliationRepository`-példánnyal (kritikus: ha ez a másik,
külső `prisma`-hoz kötött repository-példányt használná, a "zárolás
utáni friss újraolvasás ugyanabban a tranzakcióban" garancia csendben
sérülne - ezt a végleges kódba kerülés előtt saját review során vettem
észre és javítottam) -> ugyanaz a `evaluateLocalFromProvenLedgerPreconditions`
függvény fut le, mint a dry-run előnézetnél -> elutasítás esetén egy
`REJECTED` audit-sor (StockItem érintetlen); ha a ledger már egyezik az
`onHand`-del, egy `NOOP` sor (szintén auditálva, de nincs írás); egyébként
`StockItem.onHand` frissül a bizonyított ledger-értékre, EGY outbox-sor
jön létre a megosztott `enqueueStockSyncOutboxEntry` helperen át (ugyanaz,
amit `postInventoryMovement` is használ), és egy `APPLIED` audit-sor
zárja a tranzakciót. SOHA nem hoz létre `StockMovement`-et - ez egy
adatintegritás-helyreállítás a ledger már bizonyított állapotára, nem egy
új fizikai készletmozgás.

**B. `REPUBLISH_LOCAL_TO_UNAS`** (`applyRepublishLocalToUnas`) - ugyanaz a
lock+újraolvasás minta, de a cél a JELENLEGI (zárolás alatt frissen
ellenőrzött) `localOnHand` újraküldése az outboxon át - sosem közvetlen
UNAS API hívás. Elutasít, ha nincs UNAS-link, ha az `expectedCurrentOnHand`
elavult, vagy ha már létezik `PENDING`/`PROCESSING` sor ugyanarra a párra
(`ALREADY_QUEUED`).

**C. `ESTABLISH_CONTROLLED_BASELINE` - SZÁNDÉKOSAN NEM implementálva.**
A checkpoint kifejezetten megengedte ezt, ha nem egyértelműen és
biztonságosan reprezentálható a jelenlegi modellben - ez itt a helyzet.
Konkrét, jövőbeli terv (nem homályos TBD): két új, FIX előjelű
`StockMovementType` érték (`BASELINE_INCREASE`/`BASELINE_DECREASE`, a
meglévő `RETURN_IN`/`RETURN_OUT` mintájára - lásd `stock-ledger.util.ts`),
PLUSZ a reconciliation "ledger-bizonyíthatósági ablak" fogalmának
bővítése úgy, hogy egy `ADJUSTMENT`-et megelőző korábbi bizonytalanság ne
számítson bele, ha van egy ennél KÉSŐBBI, explicit baseline-esemény (azaz
a bizonyíthatóság a legutóbbi baseline-tól számítódna, nem a ledger
elejétől). Ez két okból maradt ki ebből a checkpointból: (1) egy új
kereszt-modul függőséget vezetne be a reconciliation repository és a
repair audit-modell között, (2) a checkpoint már így is nagyon nagy
terjedelmű (A/B repair, teljes health/diagnosztika, aktiválási kapu,
Postgres-teszt-futtatási kísérlet, ~30 teszt). Egy pontatlan, közelítő
megoldás megépítése itt kifejezetten kockázatosabb lett volna, mint a
tervezett elhalasztás.

### Idempotencia és tranzakcióhatár

Formátum: `RECONCILIATION_REPAIR:<repairType>:<stockItemId>:<expectedCurrentOnHand>`
(`stock-reconciliation-repair.util.ts::buildRepairIdempotencyKey`) -
SZERVEROLDALON származtatva, SOSEM a kliens által küldve (ellentétben a
checkpoint specifikáció egy lehetséges olvasatával, ami "a kérés
tartalmazza az idempotenciakulcsot" - ez a kódbázis MINDEN MÁS
idempotenciakulcsának mintáját követi: mindig az üzleti állapotból
származtatott, sosem kliens-bemenet). Nem tartalmaz érzékeny adatot, elfér
egy szöveges oszlopban, egy ismételt hívás UGYANARRA az
`expectedCurrentOnHand`-ra ugyanaz az üzleti kísérlet (a service-réteg
`findByIdempotencyKey`-jel visszaadja a korábbi eredményt, újra sem
futtatva a tranzakciót), egy KÉSŐBBI, valóban eltérő állapotú javítás
viszont automatikusan új kulcsot kap. A tranzakción belül EGY lépésben
történik: lock megszerzése -> `StockItem` és a ledger friss újraolvasása
-> `expectedCurrentOnHand` ellenőrzése -> reconciliation újraszámítása ->
audit-sor létrehozása -> `StockItem`/outbox módosítása (ha releváns) ->
mindez egyetlen `$transaction`-ben, tehát egy váratlan hiba esetén SEMMI
(még az audit-sor sem) nem marad meg részlegesen.

### Repair API felület

`stock-reconciliation-repair.controller.ts`, ugyanazon
`/inventory/reconciliation` prefix alatt, mint a checkpoint 5 read-only
végpontjai:

- `POST /inventory/reconciliation/:stockItemId/repair-local`
- `POST /inventory/reconciliation/:stockItemId/republish-unas`
- `GET /inventory/reconciliation/repairs/:repairId`

Minden mutáló kérés body-ja: `dryRun` (opcionális, alapértelmezett
`false`), `expectedCurrentOnHand` (kötelező), `reason` (kötelező,
nem-üres). `dryRun: true` esetén SEMMI nem íródik adatbázisba - még audit-
sor sem (a checkpoint kifejezett előírása szerint, mivel nincs olyan
meglévő konvenció a kódbázisban, ami ezt megkövetelné). Minden végpont
`INVENTORY_RECONCILIATION_REPAIR`-rel védett, tömeges (bulk) végpont
nincs - mindegyik pontosan egy `StockItem`-et céloz.

### Health és diagnosztika (`apps/api/src/health/`)

Négy státusz: `OK` / `DEGRADED` / `BLOCKED` / `UNKNOWN` (ez utóbbi
SZÁNDÉKOSAN a `DEGRADED` FÖLÖTT rangsorolva egy kombinált státusz
számításakor - "nem tudjuk eldönteni" sosem csúszhat el csendben "kicsi
gond, de rendben" felé). Küszöbértékek KÖZPONTOSÍTVA
(`stock-diagnostics.thresholds.ts`), nincs szórt "mágikus szám".

- `GET /health/inventory/live` - triviális liveness, publikus, nincs
  függőség-ellenőrzés.
- `GET /health/inventory/ready` - csak DB + a néhány kritikus tábla
  elérhetősége, publikus, NEM tartalmaz üzleti adatot vagy számot.
- `GET /health/inventory/diagnostics` - részletes, `INVENTORY_VIEW`-val
  védett riport: DB, kötelező táblák, outbox-torlódás (PENDING/FAILED/
  DEAD_LETTER/PROCESSING darabszám, legrégebbi PENDING kora, lejárt
  PROCESSING lease-ek), UNAS-pillanatkép frissessége
  (`UnasProductSnapshot.reportedStockSyncedAt` - NEM egy élő UNAS-hívás),
  reconciliation-összegzés (a checkpoint 5 `summarize()`-jának
  újrafelhasználásával), UNAS-rendelés-audit összegzés (a checkpoint 5
  `UnasOrderStockAuditService.summarize()` újrafelhasználásával),
  migrációk állapota (lásd lentebb), UNAS-konfiguráció megléte (kulcs/URL
  ÉRTÉKE SOSEM szerepel a válaszban, csak boolean). A
  `HISTORICAL_BASELINE_UNKNOWN` állapotú `StockItem`-ek megléte önmagában
  SOSEM teszi a teljes riportot `BLOCKED`-dá - csak egy `notes`
  figyelmeztetés.
- `GET /health/inventory/activation-readiness` - a UNAS delta-motor éles
  aktiválási kapuja: a checkpoint 5 UNAS-rendelés-audit
  `safeToActivateWithoutBackfill`/`blockingReasons`-ára épül, PLUSZ két
  további, kizárólag release-folyamat-szintű feltétel: a migrációk
  ténylegesen alkalmazva vannak-e (`_prisma_migrations` táblából
  ellenőrizve a lemezen található migrációs mappákkal szemben), és a
  Postgres konkurenciateszt lefutása - ez utóbbi MINDIG
  `"NOT_DEMONSTRATED"`, mert nincs a kódbázisban semmilyen hitelesített,
  release-idejű bizonyíték arra, hogy a `76d8c80` teszt lefutott és
  átment egy adott kiadásban - egy teszt-FÁJL megléte csak azt bizonyítja,
  hogy megírták, nem hogy lefutott. Ezt a végpontot úgy terveztem, hogy
  ezt SOHA ne állítsa magától - ez pontosan az a keveredés lenne
  (runtime health vs. release-bizonyíték), amit a checkpoint kifejezetten
  tiltott.

A migrációk saját, elérhetőségi ellenőrzése: a
`packages/database/prisma/migrations/` mappa tartalmát veti össze a
`_prisma_migrations` tábla `finished_at IS NOT NULL` soraival - ha
BÁRMELYIK oldal nem olvasható (pl. egy éles image nem tartalmazza a
migrációs forrásmappát), `UNKNOWN`-t ad vissza, SOSEM hamis "minden
rendben"-t.

### Valódi Postgres-konkurenciateszt: a futtatási kísérlet eredménye

Megkíséreltem ténylegesen lefuttatni a checkpoint 5-ben megírt
`unas-order-sync.repository.repository.integration.spec.ts` tesztet.
Pontos blokkoló ok: (1) a `.env`-ben szereplő `DATABASE_URL` a
`localhost:5432`-re mutat, de ebben a sandboxban semmi nem figyel ott
(`Connection refused`); (2) sem `psql`/`postgres` bináris, sem `docker`
nincs telepítve; (3) az `apt-get install postgresql` `Permission denied`-
del bukik (nincs root/dpkg-lock jogosultság), a `sudo` pedig explicit
tiltva van ("no new privileges" flag). Ez PONTOSAN ugyanaz a, a
checkpoint 5-ben is dokumentált korlátozás - nem egy új probléma.
Reprodukálható parancs (helyi gépen vagy CI-ban, ahol fut egy Postgres):

```
docker compose up -d postgres   # repo gyökerében, a docker-compose.yml szerint
cd apps/api
RUN_DB_INTEGRATION=1 npm run test:integration
```

Statikus felülvizsgálat (mivel futtatni nem lehetett): a teszt saját maga
hoz létre egy időbélyeggel egyedi raktárat/terméket/variánst (`before`
hook), és az `after` hook FK-biztos sorrendben törli mindet, majd
`$disconnect()`-el zár - tehát izolált és önmagát takarítja. Mindhárom
`it()` blokk explicit `{ timeout: 30_000 }`-t kap, tehát egy holtpont
(deadlock) a teszt BUKÁSÁT okozná (Postgres saját `deadlock_timeout`-ja
után), nem egy örökké lógó futást. A teszt emiatt strukturálisan
helyesnek ítélhető, de VALÓS lefutás és PASS még mindig nincs bizonyítva
- ezt a checkpoint 6 zárójelentése is így, félreérthetetlenül állítja.

### Ismert, ebben a checkpointban NEM megoldott kockázatok

- A "C" (`ESTABLISH_CONTROLLED_BASELINE`) repair-típus terv szinten van
  csak kész - lásd fent.
- A Postgres-konkurenciateszt (mind a checkpoint 4-es
  `unas-order-sync.repository.integration.spec.ts`, mind a régebbi outbox-
  worker-integrációs teszt) még mindig nincs ténylegesen lefuttatva ebben
  a projektben - ez blokkolja is az aktiválási kaput, szándékosan.
- A repair-repository és a hozzá tartozó tesztek ebben a sandboxban NEM
  futtathatók (lásd "Ismert korlátok") - kizárólag kézi kód-átvizsgálással
  (és teljes `tsc --noEmit` tisztasággal) ellenőrzöttek.

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
- Checkpoint 6: `prisma validate`/`prisma format` nem futtatható ebben a
  sandboxban (a `prisma` CLI a schema-engine bináris letöltésekor
  `403 Forbidden`-nel bukik - hálózati korlátozás) - a séma és a
  migráció helyette kézi átvizsgálással lett ellenőrizve (mezőnkénti
  egyeztetés a `schema.prisma` és a migráció SQL-je között).
- Checkpoint 6: a `nest build` (teljes production build) ebben a
  sandboxban `EPERM: operation not permitted, unlink`-kel bukik a meglévő
  `apps/api/dist/` könyvtár egyes fájljainál - ez egy, a projekt korábbi
  checkpointjaiban is dokumentált mount/jogosultsági sajátosság (lásd a
  `dist.discard-*` könyvtárakat), NEM a checkpoint 6 kódjából ered. A
  `tsc --noEmit` (amit ez a checkpoint minden lépés után lefuttatott) a
  TELJES típusellenőrzést elvégzi enélkül, és 0 új hibát talált a
  checkpoint 6 kódjában a már meglévő, Prisma-generálási hiányból eredő
  159 alap-hibához képest.
