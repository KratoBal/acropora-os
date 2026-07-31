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
könyvelni kell - de a _könyvelt mennyiséget_ onnantól az Acropora OS
tekinti hitelesnek).

### UNAS készletpillanatkép és csomagtermékek

A terméktörzs `getProduct` inkrementális ablaka a termék `LastModTime`
értékét követi, ezért önmagában nem alkalmas készletváltozások biztos
észlelésére. Minden kézi és időzített termékszinkron ugyanabban a futásban
lekéri a dedikált `getStock` streamet is, és abból frissíti a
`UnasProductSnapshot.reportedStock` / `reportedStockSyncedAt` mezőket. A
termék- és készletváltozások közös cursorral, közös tranzakcióban lépnek
előre; sikertelen futás nem hagy előreléptetett cursort.

Az UNAS `PackageProduct` terméke nem rendelkezik önálló fizikai készlettel:
az eladható mennyiségét a `PackageComponents` összetevőkből számítja. Az
Acropora OS ezért eltárolja a normalizált `{sku, qty}` komponenseket, és a
csomagterméket kizárja az önálló leltárból, bevételezésből,
készlet-egyeztetésből és közvetlen `setStock` publikálásból. POS- vagy
UNAS-rendeléskor a csomagsor megmarad értékesítési tételnek, de a fizikai
készletmozgás és az outbox az összetevő-variánsokra, a komponensszorzókkal
kerül. Ha bármely komponens nem oldható fel egyértelműen, részleges
könyvelés helyett a sor kontrollált hibát kap.

## Egységes készletmódosító primitív

`apps/api/src/common/inventory-movement-writer.ts` - `postInventoryMovement`.

Minden készletet érintő folyamat (leltár, beszerzés, POS, UNAS
webshoprendelés import/módosítás/sztornó, később reconciliation-javítás)
ezen a függvényen keresztül, a saját tranzakcióján _belülről_ hívva
módosítja a készletet. Egy hívás:

1. ellenőrzi az `idempotencyKey`-t a `StockMovement` táblán - ismételt
   hívás ugyanazzal a kulccsal (retry, duplikált poll) nem könyvel
   kétszer;
2. létrehoz egy `StockMovement`-et és soronként egy `StockMovementLine`-t;
3. minden sor előjeles `quantityDelta`-ját atomian alkalmazza a
   `StockItem.onHand`-re, (variantId, warehouseId) kulcsonként
   sorosítva egy Postgres tranzakció-szintű **advisory lock**-kal;
4. ugyanabban a tranzakcióban az UNAS-szinkronra jogosult sorokhoz egy
   `UnasStockSyncOutbox` sort ír, ami az imént kiszámított ABSZOLÚT eredő
   készletet hordozza. A hívó minden soron explicit `syncToUnas` értéket ad;
   ez csak `catalogAuthority=UNAS` terméknél lehet igaz. A
   `catalogAuthority=ACROPORA` helyi termék készlete ugyanitt könyvelődik,
   de outbox nélkül.

### Miért advisory lock, és nem `Serializable`/`SELECT ... FOR UPDATE`

A `StockItem` egyedi kulcsa `(variantId, warehouseId, locationId, lotId)` -
Postgres a NULL `locationId`/`lotId` értékeket nem tekinti egyenlőnek/
ütközőnek, így `SELECT ... FOR UPDATE` nem tud zárolni egy még nem létező
sort, és két egyidejű _első_ mozgás akár `Serializable` alatt is
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

Csomagtermékhez tartozó történeti vagy véletlenül létrehozott outbox sor
szintén UNAS-hívás nélkül zárul `SUCCEEDED` állapotba,
`resolutionNote=package_product_not_stock_managed` megjegyzéssel. A
bevezető migráció a már létező package `PENDING`/`PROCESSING`/`FAILED`/
`DEAD_LETTER` sorokat ugyanígy, törlés nélkül lezárja, így az auditnyom
megmarad.

**Miért garantált, hogy a legfrissebb állapot végül tényleg kiküldésre
kerül**: minden sikeresen könyvelt készletmozgás létrehoz egy saját outbox
sort. Ha egy sor (A) feldolgozás közben (PROCESSING) van, amikor egy újabb
mozgás egy másik sort (B) hoz létre, A nem szuperszedeálódik íráskor - de A
feldolgozásakor a worker az AKTUÁLIS
`StockItem.onHand - StockItem.reserved` értéket olvassa újra
(nem a beírt `targetOnHand`-et), tehát A vagy a B előtti, vagy a B utáni
(véletlenül helyes) értéket küldi ki - mindegy, mert B saját, önálló sorként
biztosan feldolgozásra kerül egy következő worker-tick-ben, és ekkor is
frissen olvassa újra a készletet. B nem szuperszedeálódhat (nincs nála
frissebb sor még), tehát B mindenképp lefut és a ténylegesen legfrissebb
állapotot publikálja.

### Mit publikálunk ténylegesen: outboxban tárolt érték vs friss újraolvasás

A worker a UNAS-hívás előtt **újraolvassa** a
`StockItem.onHand - StockItem.reserved` értéket (nem az outbox sorban
rögzített `targetOnHand`-et küldi). Az `onHand` a fizikailag jelen lévő
mennyiség, a `reserved` az aktív projektfoglalás; az UNAS kizárólag a szabad,
eladható készletet kaphatja. A bevételezés a fizikai mozgást, a foglalást és
az outbox végleges célértékét egy tranzakcióban írja, ezért a worker már csak
konzisztens állapotot láthat. A friss újraolvasás védekező rétegként is
megmarad: az UNAS nem kaphat elavult pillanatképet.

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

Csomagterméknél a `targetOut` nem a csomag variánsára, hanem az összetevőkre
épül (`rendelt csomagmennyiség × komponens qty`). Ugyanezt a feloldást
használja a read-only történeti rendelésszinkron-audit is, ezért a csomag
sora és a komponensek ledger-mozgásai nem okoznak hamis eltérést.

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

1. **`StockMovement`/`StockMovementLine` ledger** - mit _könyveltünk el_.
2. **`StockItem.onHand`** - a jelenlegi, gyorsítótárazott abszolút készlet.
3. **`UnasProductSnapshot.reportedStock`** - amit a UNAS _jelent_ (termék-
   szinten, nem variánsonként - lásd alább).
4. **`UnasStockSyncOutbox`** - mi van _folyamatban_ a kettő összehangolására.

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

`catalogAuthority=ACROPORA` helyi terméknél az UNAS-link és
`UnasProductSnapshot` hiánya szándékos, ezért önmagában nem eredményez
`MISSING_UNAS_LINK` státuszt. A ledger és a `StockItem.onHand` egyezésekor
az ilyen sor `CONSISTENT`, `unasOnHand=null` értékkel és „UNAS-szinkron nem
alkalmazandó” megjegyzéssel. Hiányzó termékkapcsolat vagy ismeretlen
authority továbbra is fail-closed módon `MISSING_UNAS_LINK`.

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
outbox-sor a jelenlegi helyes `onHand - reserved` értékkel, csak ha nincs már nála frissebb
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
  `StockItem.onHand` frissül a bizonyított ledger-értékre; explicit
  `catalogAuthority=UNAS` terméknél EGY outbox-sor is létrejön a megosztott
  `enqueueStockSyncOutboxEntry` helperen át (ugyanaz, amit
  `postInventoryMovement` is használ), helyi ACROPORA terméknél viszont
  nincs outbox. Egy `APPLIED` audit-sor zárja a tranzakciót. SOHA nem hoz
  létre `StockMovement`-et - ez egy adatintegritás-helyreállítás a ledger
  már bizonyított állapotára, nem egy új fizikai készletmozgás.

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

## Checkpoint 7: release evidence, valódi futási ellenőrzés

### Legfontosabb szabály (a checkpoint saját megfogalmazása)

Sem a tesztkód létezése, sem egy kézzel beállított flag nem bizonyítja a
PostgreSQL-konkurenciabiztonságot. Az activation-readiness csak a
vizsgált release commitra ténylegesen lefutott, hiteles és gépileg
ellenőrizhető PostgreSQL-teszteredményt fogadhat el.

### Valódi, izolált PostgreSQL-környezet: új felfedezés

A checkpoint 5/6 idején dokumentált korlátozás ("nincs elérhető Postgres
ebben a sandboxban") RÉSZBEN pontosításra szorult. Az `embedded-postgres`
npm csomag (portable, felhasználói jogosultsággal futtatható Postgres-
bináris, NEM az `apt`/`dpkg`-n vagy `docker`-en keresztül) sikeresen
telepíthető és futtatható volt - egy VALÓDI, izolált PostgreSQL 18.4
szerver indult el `/tmp`-ben, sosem érintve a production
`DATABASE_URL`-t. Ezzel:

- a teljes, 30 elemű migrációs láncot (checkpoint 1-től a checkpoint 7-es
  `add_release_evidence`-ig) ténylegesen lefuttattam, sorban, tranzakciónként,
  egy üres adatbázison - mind a 30 migráció `OK` státusszal futott le,
  nulla hiba; utólagos ellenőrzés: 58 tábla, a `StockReconciliationRepair`
  és `ReleaseEvidence` táblák pontosan a várt oszlopokkal/típusokkal/
  nullable-séggel/foreign key-ekkel/indexekkel jöttek létre (enumértékek,
  unique index az idempotencyKey-en, `RESTRICT`/`SET NULL` delete rule-ok
  - mind egyezik a schema.prisma-val);
- egy ÖNÁLLÓ (nem Prisma-alapú, nyers `pg` drivert használó) teszttel
  ténylegesen bebizonyítottam a `pg_advisory_xact_lock` primitívum - amire
  `lockVariantWarehouse` és `lockUnasOrder` is épül - konkurenciasemantikáját
  egy valódi Postgres ellen: (1) ugyanarra a kulcsra induló két egyidejű
  tranzakció szerializálódik (a második ténylegesen az első COMMIT-ja UTÁN
  szerzte meg a zárolást, mérve: 808ms várakozás egy 800ms-os tartás
  mellett); (2) két KÜLÖNBÖZŐ kulcs nem blokkolja egymást (0ms); (3)
  ROLLBACK ugyanúgy felszabadítja a zárolást, mint COMMIT (508ms várakozás
  egy 500ms-os tartás mellett); (4) három egyidejű, különböző kulcsú
  zárolás holtpont nélkül, azonnal lefut.

**Fontos, pontos elhatárolás**: ez NEM a tényleges
`unas-order-sync.repository.integration.spec.ts` (76d8c80) vagy bármelyik
NestJS/Prisma-alapú repository-teszt lefutása - azok továbbra sem
futtathatók, mert a Prisma CLI (generate/format/validate mind) ebben a
sandboxban a proxy szintjén, konkrétan a `binaries.prisma.sh` hoszton
kap `403 Forbidden`-t (`curl` közvetlenül is megerősítette: "Received
HTTP code 403 from proxy after CONNECT" - ez a sandbox saját proxyjának
explicit tiltása, nem javítható innen). Emiatt a Prisma-kliens generálása
kategorikusan lehetetlen itt, ami kizár minden olyan tesztet, ami
`@acropora/database`-t importál. Ez a fenti, nyers-SQL-alapú bizonyíték
tehát az ALAPMECHANIZMUS valódi, mért, végrehajtott igazolása, nem a teljes
alkalmazáskód lefutása.

Egy további, ugyanilyen fontos technikai felfedezés: ez a sandbox minden
egyes bash-hívást saját, elkülönített PID-namespace-ben indít
(`bwrap --unshare-pid`), ami a hívás végén a NAMESPACE TELJES tartalmát
leállítja - egy `nohup ... & disown`-nal indított háttérfolyamat (pl. egy
hosszan futó Postgres szerver) NEM éli túl a hívás lezárását, függetlenül
attól, hogy a fájlrendszer (pl. `/tmp`) egyébként megmarad. Emiatt minden
valódi Postgres-műveletet EGY bash-hívásban kellett elvégezni (indítás,
használat, tiszta leállítás), 45 másodperces korláton belül.

### Prisma generate/format/validate: pontosított ok

Mindhárom parancsot újra megpróbáltam, immár azután, hogy megerősítettem:
az `npm`/`github` registry elérhető ebből a sandboxból. A hiba
MINDHÁROMNÁL azonos és pontos: `Failed to fetch ... at
https://binaries.prisma.sh/... - 403 Forbidden`. Ez nem hálózati
általános hiba, hanem KIFEJEZETTEN ennek az egy hosztnak a tiltása -
minden más külső hoszt (npm registry, github.com,
zonkyio/embedded-postgres-binaries) elérhető volt. Ez egy végleges,
innen nem megkerülhető korlátozás.

### Unit/integration tesztek: megerősített, pontosított ok

`tsc -p tsconfig.test.json` (a teszt-build, amit `node --test` előtt
mindenképp le kell futtatni) 159 hibával bukik, ebből 42 pontosan a
`@prisma/client`-ből hiányzó, generálás-függő exportok (`PrismaClient`,
`Prisma`, minden modell-típus) - tehát a build maga sem készül el, a
`node --test`-hez szükséges `test-dist/` soha nem jön létre. Egyetlen
tesztfájl sem futtatható emiatt - ez pontosan ugyanaz az ok, mint
checkpoint 5/6-ban, most a Prisma-oldali gyökérokkal pontosítva.

### ReleaseEvidence modell

Két új enum (`ReleaseEvidenceType` - ma egyetlen érték,
`INVENTORY_POSTGRES_CONCURRENCY_TEST`; `ReleaseEvidenceStatus` - `SUCCESS`/
`FAILURE`) és a `ReleaseEvidence` tábla
(`packages/database/prisma/migrations/20260729090000_add_release_evidence/`).
Mezők: `commitSha`, `workflowRunId`, `environment`, `databaseEngine`+
`databaseEngineVersion`, `testSuite`, `startedAt`/`completedAt`,
`resultDetail` (JSON, csak technikai adat), `createdAt`. Nincs egyedi
kényszer az (evidenceType, commitSha) páron - egy commit többször is
tesztelhető, az activation-readiness mindig a legújabb SUCCESS sort nézi.
Ezt a migrációt is lefuttattam a fenti valódi Postgres ellen, a teljes
lánc részeként - lásd fent.

**A tábla KIZÁRÓLAG egy hiteles CI/release-folyamat által írható**: az
egyetlen írási út a `packages/database/prisma/record-release-evidence.ts`
önálló szkript, amit `tsx`-szel kell futtatni
(`pnpm --filter @acropora/database release-evidence:record`) - ez a fájl
NINCS importálva semelyik NestJS modulból, nincs hozzá route, a futó API-
ból elérhetetlen. Minden mező kötelező, környezeti változóból olvasva
(sosem CLI-flag, hogy CI natívan tudja átadni pl. `${{ github.sha }}`-t);
egyetlen mező sincs alapértelmezve (szemben `seed.ts` fejlesztői
`DATABASE_URL`-fallback-jével) - egy csendben alapértelmezett mezőjű
bizonyíték aláásná a tábla egész célját. Nincs és nem lesz általános
admin API, amivel valaki kézzel SUCCESS-re állíthatna egy sort.

`.github/workflows/ci.yml` most már, a `test:integration` lépés után, egy
`if: always()` lépésben ténylegesen meghívja ezt a szkriptet - de FONTOS,
DOKUMENTÁLT KORLÁTTAL: ez a CI job SAJÁT, a job végén megsemmisülő
ideiglenes Postgres-je ellen ír, nem production ellen - ez bizonyítja,
hogy a szkript mechanikája valódi CI-infrastruktúrán működik, de NEM teszi
automatikusan láthatóvá ezt a bizonyítékot egy futó production-példány
saját adatbázisában. A CI -> production evidence-írás egy éles
release/deploy-lépésként valósítható meg (production `DATABASE_URL`
secret-tel, amivel a CI ma nem rendelkezik) - ez szándékosan
dokumentált TERVKÉNT marad, mert a tényleges bekötése production-deploy
jellegű módosítás lenne, ami ennek a checkpointnak kifejezetten NEM
része.

### Activation-readiness: valódi evidence-integráció

`stock-diagnostics.service.ts::activationReadiness()` mostantól:

1. beolvassa a futó build saját commit SHA-ját
   (`common/release-info.util.ts`, `RELEASE_COMMIT_SHA` env - ÚJ
   konvenció, ma még semelyik deploy-lépés nem állítja be ténylegesen,
   lásd lentebb);
2. ha ez nincs beállítva: `concurrencyTestEvidence: "NOT_CONFIGURED"`,
   blokkolva;
3. ha be van állítva, lekéri a legújabb `SUCCESS` `ReleaseEvidence` sort
   PONTOSAN erre a commitra (`findLatestConcurrencyTestEvidence`) - egy
   RÉGEBBI vagy IDEGEN commit sikere SOSEM oldja fel a blokkolást (ez a
   checkpoint saját, explicit követelménye: egy N commitban javított hiba
   könnyen visszakerülhet N+5-ben, és "valamikor egy korábbi commit
   átment" semmit nem mond N+5-ről);
4. ha nincs ilyen sor: `"NOT_DEMONSTRATED"`, blokkolva;
5. ha van, de a sor `completedAt`-je `RELEASE_EVIDENCE_MAX_AGE_DAYS`-nél
   (30 nap, `stock-diagnostics.thresholds.ts`) régebbi: szintén
   `"NOT_DEMONSTRATED"`, blokkolva;
6. egyébként `"DEMONSTRATED"`, ez a blokkoló ok megszűnik (a többi -
   migráció, UNAS-rendelés-audit - továbbra is önállóan blokkolhat).

**Ebben a sandboxban `RELEASE_COMMIT_SHA` soha nincs beállítva, és nincs
is production `ReleaseEvidence` sor** - az activation-readiness emiatt
ma is, változatlanul `NOT_CONFIGURED`/`NOT_DEMONSTRATED` és BLOCKED, ahogy
lennie kell. A `DEMONSTRATED` ág kódszinten megépült és teszteltek (5 új
teszt: NOT_CONFIGURED, NOT_DEMONSTRATED ismert commitra, idegen-commit
sikere nem elég, friss egyező commit SUCCESS = DEMONSTRATED, túl régi
egyező commit SUCCESS mégsem elég), de VALÓS production-adatbázis ellen
nem lett kipróbálva - ugyanaz a Prisma-generálási korlát miatt.

### ESTABLISH_CONTROLLED_BASELINE ("C" repair-típus) - továbbra sem implementált

A checkpoint kifejezetten csak "a futási baseline stabilizálása UTÁN"
engedélyezte ennek megépítését. Ez a feltétel ebben a checkpointban SEM
teljesült: a Prisma-kliens generálása kategorikusan lehetetlen ebben a
sandboxban (proxy-szintű tiltás, nem javítható), tehát semmilyen új,
mutáló kód (mint amilyen a C típus lenne) nem lenne itt jobban
ellenőrizhető, mint az A/B típus volt checkpoint 6-ban. Új, verifikálatlan
mutáló kód hozzáadása pontosan akkor, amikor a felhasználó kifejezetten a
"ne állíts bizonyítatlan dolgokról, hogy működnek" elvet hangsúlyozza,
fegyelmezetlen döntés lenne. A checkpoint 6-ban dokumentált konkrét terv
(`BASELINE_INCREASE`/`BASELINE_DECREASE` mozgástípusok + a reconciliation
bizonyíthatósági ablakának a legutóbbi baseline-tól számított
újraszámítása) változatlanul érvényes, következő lépésként javasolt, ha a
Prisma-generálási korlát elhárul (pl. valódi CI-ban vagy egy Prisma-
binárisokat engedélyező környezetben).

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

## Checkpoint 8: valódi alkalmazásszintű PostgreSQL-tesztek és release-evidence deploy integráció

Munkaterület-izoláció: ez a checkpoint egy KÜLÖN git worktree-ben készült
(`/tmp/acropora-os-inventory-checkpoint-8`, a `feat/inventory-consistency-hardening`
ágból, `38ea010`-ról indulva), mert a live-mounted fő munkamappa eközben
szándékosan a `feat/field-service-mobile-foundation` ágon dolgozott
(párhuzamos, független munkafolyamat). A fő munkamappát ez a checkpoint
egyáltalán nem érintette - lásd a checkpoint elején lezajlott, a
felhasználó által jóváhagyott worktree-izolációs eljárást.

### A sandbox tényleges végrehajtási korlátai (őszinte helyzetkép)

Ebben a sandboxban nincs GitHub push-hitelesítés (nincs `gh` CLI, nincs
git credential helper; `git push --dry-run origin HEAD` `fatal: could not
read Username for 'https://github.com'`-tal bukik) - ezért ez a
checkpoint NEM tudta elindítani vagy megfigyelni a valódi GitHub Actions
CI-t. A `binaries.prisma.sh` proxyszintű 403-as blokkolása (lásd
checkpoint 7) is változatlanul fennáll - ellenőrizve újra, közvetlen
`curl`-lal és egy valódi `prisma validate` kísérlettel is, mindkettő
ugyanazt a `Failed to fetch sha256 checksum ... 403 Forbidden` hibát adta.

Emiatt ez a checkpoint alapvetően KÓD-ELŐKÉSZÍTŐ jellegű volt a CI/
release-oldali részeknél (5. rész kivételével, lásd lent) - a tényleges
GitHub Actions-futtatás és a `release-evidence-handoff.yml` valódi,
jóváhagyott lefuttatása egy, a repositoryhoz valódi jogosultsággal
rendelkező embertől (vagy egy erre képes jövőbeli sandboxtól) igényel
egy manuális lépést.

### Váratlan, de értékes felismerés: a tesztek futtathatósága pontosabban jellemezhető

A checkpoint 7 azt állította, hogy "egyetlen spec fájl sem futtatható,
mert a `tsc -p tsconfig.test.json` build maga bukik". Ez a checkpoint egy
FRISS `pnpm install`-lal (lásd lent) pontosított rajta: a `tsc` build
VALÓJÁBAN lefut és JS-t emittál annak ellenére, hogy 159 (api) / 42
(database) típushiba van - a `tsc` alapértelmezetten nem állítja le az
emittálást hibák esetén (`noEmitOnError` nincs bekapcsolva). A tényleges,
pontos blokkoló ok NEM a tsc build, hanem az, hogy `@prisma/client`
(generálás - azaz `prisma generate` - nélkül) nem tartalmaz valódi
`.prisma/client` futásidejű modult, ezért bármely teszt, ami (közvetlenül
vagy közvetve, pl. `@acropora/database`-en keresztül) importálja
`@prisma/client`-et, futásidőben `SyntaxError: Named export 'PrismaClient'
not found`-dal bukik - pontosan az a hiba, amit `apps/api/Dockerfile`
saját, bőséges kommentjei is dokumentálnak.

Ennek a pontosításnak köszönhetően kiderült: egy `@acropora/database`-től
FÜGGETLEN spec fájl VALÓBAN lefuttatható ebben a sandboxban, valódi
`node --test`-tel, valódi kimenettel. Lásd az 5. részt.

### 3-4. rész: PostgreSQL 16 migrációs lánc

Valódi PostgreSQL 16.14 szerver (`embedded-postgres@16.14.0-beta.17`,
127.0.0.1:55436, teljesen egyszer használatos, sosem érintette a valós
`DATABASE_URL`-t) - a teljes 31 migrációs mappa (a checkpoint 8 saját,
új `20260730090000_harden_release_evidence_provenance` mappájával együtt)
lefutott egy üres adatbázison: **31/31 OK**, 58 tábla, minden várt enum
érték jelen van. Izoláció: külön port, külön, egyszer használatos
adatkönyvtár (`/tmp/pgtest16/data-pg16-v2`), a futtatás után törölve.
Cleanup: `pg.stop()` + `rm -rf` az adatkönyvtáron.

`prisma generate`/`format`/`validate`: újra megkísérelve, változatlanul
403 Forbidden a `binaries.prisma.sh`-n - lásd fent.

A checkpoint 7 saját PostgreSQL 18.4 eredménye TOVÁBBRA IS érvényes,
kiegészítő kompatibilitási bizonyítékként, változatlan státusszal - nem
lett törölve vagy leminősítve.

### 5. rész: valódi unit tesztek

Egy friss `npm install pnpm@10.34.5` + `pnpm install --frozen-lockfile
--store-dir /tmp/pnpm-store-checkpoint8` (a `.pnpm-store`-ba írt szimlink
ugyanabba a mount-szintű EPERM-be ütközött, mint a git lock fájlok -
külön store-dir-rel megkerülve) telepítette a workspace függőségeit ebben
a worktree-ben. `packages/types` (nincs Prisma-függősége) és
`packages/database` (van, de a `tsc` rész külön lefut a `prisma
generate`-től) mindkettő lebuildelve sima `tsc -p tsconfig.json`-nal.

A teljes, meglévő `apps/api` teszt-lista (79 spec fájl, a `package.json`
`test` szkriptjéből) ténylegesen lefuttatva `node --test`-tel:
**191 teszt, 25 suite, 129 sikeres, 62 sikertelen.** A 62 sikertelen
MINDEGYIKE ugyanarra az egyetlen, pontosan azonosított okra vezethető
vissza: `@prisma/client` hiányzó, generálás nélküli futásidejű modulja
(lásd fent) - nem logikai hiba, nem regresszió, nem lazított feltétel.
Egyetlen assert sem lett enyhítve, mert egyetlen valódi assertion-hibát
sem találtunk - minden bukás importálási/modulbetöltési hiba volt,
még a teszt kódjának lefutása előtt.

Ez alól az egyetlen kivétel a checkpoint 8 saját, új
`common/release-info.util.spec.ts` fájlja (nincs `@acropora/database`
függősége) - ez VALÓBAN, teljes egészében lefutott: **8/8 teszt sikeres**,
valódi `node --test` kimenettel.

A checkpoint eredeti listája (inventory reconciliation, historical order
audit, movement writer, repair util/repository/service/controller,
health/diagnostics, activation-readiness, ReleaseEvidence-integráció)
KIVÉTEL NÉLKÜL `@acropora/database`-től függ, ezért ezek a konkrét
suite-ok NEM futtathatók le ebben a sandboxban - pontosan ugyanazon ok
miatt, mint a checkpoint 7-ben, csak most pontosabban jellemezve.

### 6-7. rész: 76d8c80 alkalmazásszintű integrációs teszt és a repair konkurenciateszt

NEM futtatható ebben a sandboxban - mindkettő valódi, generált
`@prisma/client`-et igényel futásidőben (a repository-kód ténylegesen
`PrismaClient`-et importál és Prisma tranzakciókat/advisory lockokat
használ), ami a fent dokumentált, kategorikus blokkoló miatt ehelyütt
lehetetlen. A checkpoint 7 raw pg-driveres advisory-lock bizonyítéka
VÁLTOZATLANUL NEM helyettesíti ezt - lásd a felhasználó saját, e
checkpointhoz fűzött minősítését. Mindkét teszt VALÓDI, generált
Prisma-klienssel, GitHub Actions CI-ban vagy egy ellenőrzött fejlesztői
gépen futtatandó le - ehhez a meglévő `ci.yml` `verify` job-ja már eleve
tartalmazza a szükséges lépéseket (`pnpm --filter @acropora/api
test:integration`, ami lefuttatja a 76d8c80 tesztet valódi
`postgres:16-alpine`-on).

### 8. rész: ReleaseEvidence hitelesség-modell szigorítása

Új migráció: `20260730090000_harden_release_evidence_provenance` - négy
új, kötelező mező a `ReleaseEvidence` táblán: `repository`,
`workflowName`, `jobName`, `triggerEvent`, mindegyik GitHub Actions saját,
a job kódja által felül nem írható kontextuskifejezéséből
(`github.repository`/`github.workflow`/`github.job`/`github.event_name`)
töltve ki - lásd `ci.yml` "Record release evidence" lépését. A
`record-release-evidence.ts` mind a négyet KÖTELEZŐVÉ tette (nincs
alapértelmezett érték egyikhez sem sem).

A jelenlegi folyamat pontos leírása: a `verify` job saját, egyszer
használatos `postgres:16-alpine` service konténerében fut a teszt, majd a
"Record release evidence" lépés ugyanabba az egyszer használatos
adatbázisba ír egy sort - a job végén ez az adatbázis megsemmisül. Ez a
sor NEM érhető el a production `/health/inventory/activation-readiness`
számára (az a PRODUCTION saját adatbázisát kérdezi le, ami egy teljesen
más Postgres-példány). Ez a rés - amit a checkpoint 7 már dokumentált -
VÁLTOZATLANUL fennáll; a 10. rész `release-evidence-handoff.yml`-je egy
ELŐKÉSZÍTETT (nem lefuttatott) tervet ad a lezárására.

Új, a `ci.yml` "Record release evidence" lépésén hozzáadott védelem: a
lépés `if:`-je mostantól kihagyja magát fork-eredetű pull_requestnél
(`github.event.pull_request.head.repo.full_name != github.repository`) -
defense-in-depth, mivel ma ez a lépés amúgy is csak a CI saját, egyszer
használatos adatbázisába ír.

### 9. rész: RELEASE_COMMIT_SHA build-time integráció

`apps/api/Dockerfile`: új `RELEASE_COMMIT_SHA` build ARG (alapértelmezett
üres string - a hiánya NEM hiba, hanem NOT_CONFIGURED-ot eredményez), a
`runner` stage-ben újra deklarálva és VALÓDI environment változóként
beégetve (`ENV RELEASE_COMMIT_SHA=${RELEASE_COMMIT_SHA}`), egy build-time
formátumellenőrzéssel (`grep -Eq '^[0-9a-f]{40}$'`) - egy hibás/hamis
érték BUKTATJA a buildet, egy ÜRES érték átmegy (mert az "nincs
beállítva" jogos állapot marad). `apps/api/src/common/release-info.util.ts`
saját `currentReleaseCommitSha()`-ja is ugyanezt a mintát (40 karakteres,
kisbetűs hex) validálja futásidőben, és egy hibás értéket NULL-ként kezel
(nem különálló hibaállapotként) - ez pontosan az elvárt "hibás érték
elutasítva" viselkedés.

`.github/workflows/ci.yml`: mindhárom releváns Docker build lépés
(`docker-build-scan`/api mátrix-ág, `docker-smoke-test` mindkét
buildje) mostantól átadja `--build-arg RELEASE_COMMIT_SHA=${{ github.sha
}}`-t, plusz egy új `docker inspect`-alapú ellenőrzés a
`docker-smoke-test` jobban, ami VALÓBAN összeveti a lebuildelt image-be
sütött értéket `github.sha`-val (nem csak feltételezi, hogy működik).

### 10. rész: CI → release/deploy evidence handoff

Új fájl: `.github/workflows/release-evidence-handoff.yml` - kizárólag
`workflow_dispatch`-csel indítható (nincs `push`/`pull_request` trigger),
egyetlen jobbal, ami egy `environment: production-release-evidence`
GitHub Environment-hez van kötve (ez maga - required reviewer, branch
restriction - a GitHub repo Settings-jében állítandó be, NEM ebből a
YAML-ból). A job: (1) valódi PostgreSQL 16 service konténerrel újra
lefuttatja a 76d8c80 integrációs suite-ot a pontos vizsgált commitra;
(2) csak VALÓDI, 0-ás kilépőkóddal záruló siker esetén ír SUCCESS
evidence-t egy production-scoped `DATABASE_URL` secret-tel (a secret NEM
lett létrehozva, kérve vagy felhasználva - csak a névvel hivatkozva:
`PRODUCTION_RELEASE_EVIDENCE_DATABASE_URL`); (3) sikertelen futásnál egy
KÜLÖN, kizárólagos lépés FAILURE evidence-t ír, sosem ugyanaz a lépés,
ami SUCCESS-t is írhatna; (4) a production migrációs állapotot
`prisma migrate status`-szal ELLENŐRZI (nem alkalmazza) az evidence-írás
előtt. A fájl alján részletes, manuális beüzemelési útmutató (5 lépés) -
egyike sem lett elvégezve ebből a sandboxból.

### 11. rész: activation-readiness szigorítása

`stock-diagnostics.thresholds.ts`: új konstansok -
`REQUIRED_DATABASE_ENGINE`/`REQUIRED_DATABASE_ENGINE_MAJOR_VERSION_PREFIX`
("postgres"/"16"), `EXPECTED_RELEASE_EVIDENCE_REPOSITORY`
("KratoBal/acropora-os", env-override-olható),
`TRUSTED_RELEASE_EVIDENCE_TRIGGER_EVENTS` (`push`, `workflow_dispatch` -
`pull_request`/`pull_request_target` szándékosan kizárva).

`stock-diagnostics.service.ts::activationReadiness()`: egy pontos
commitra talált, nem túl régi SUCCESS sor MOST MÁR csak akkor elég, ha
EGYSZERRE igaz: van `workflowRunId`; `repository` egyezik az elvárttal;
`triggerEvent` megbízható; `databaseEngine`/`databaseEngineVersion`
PostgreSQL 16. Minden megsértett feltétel KÜLÖN, konkrét blokkoló okot ad
hozzá (nem egy generikus "invalid evidence" üzenetet) - lásd a
`authenticityViolations` tömböt. A raw advisory-lock primitívum
bizonyítéka (checkpoint 7) ÖNMAGÁBAN továbbra sem tudja feloldani ezt a
kaput - ehhez a fenti VALAMENNYI mezőnek pontosan egyeznie kell egy
valódi CI/release-futásból származó sorral.

A gate a checkpoint 8 végén is BLOCKED marad (nincs `RELEASE_COMMIT_SHA`
beállítva ebben a sandboxban, és nincs semmilyen valódi evidence-sor sem
egy éles adatbázisban).

### 12. rész: ESTABLISH_CONTROLLED_BASELINE

A user által megfogalmazott előfeltétel-lista (Prisma generate/format/
validate siker; PostgreSQL 16 migrációs lánc siker; valódi unit suite
siker; 76d8c80 alkalmazásszintű teszt siker; repair konkurenciateszt
siker; release-evidence útvonal demonstrálva legalább CI/release
környezetben; stabil RELEASE_COMMIT_SHA szerződés) EGYIKE sem teljesül
maradéktalanul ebben a checkpointban (a Prisma generate/format/validate
kategorikusan blokkolt; a 76d8c80 és a repair konkurenciateszt nem
futtatható; a release-evidence útvonal csak KÓDSZINTEN készült el,
ténylegesen NEM lett demonstrálva egyetlen valódi CI-futásban sem, mivel
ez a sandbox nem tud GitHub Actions-t indítani). A baseline C ezért
TOVÁBBRA IS csak dokumentált terv marad - nincs implementálva.

### Ismert, nyitott kockázatok

- A `release-evidence-handoff.yml` VALÓS lefuttatásához a felhasználónak
  saját kézzel kell beállítania a GitHub Environment-et, a required
  reviewer-t és a `PRODUCTION_RELEASE_EVIDENCE_DATABASE_URL` secretet -
  ezek egyike sincs kész.
- A 76d8c80 és a repair konkurenciateszt éles, alkalmazásszintű futtatása
  továbbra is csak a valódi GitHub Actions CI-ban vagy egy fejlesztői
  gépen történhet meg - ez a checkpoint ezt nem tudta elvégezni.
- `EXPECTED_RELEASE_EVIDENCE_REPOSITORY` alapértéke ("KratoBal/acropora-os")
  a `git remote -v` kimenetéből lett levezetve ebben a sandboxban -
  érdemes megerősíteni, hogy ez pontosan egyezik a GitHub-on tényleg
  használt repository slug-gal.

## Checkpoint 9: valódi Prisma/PostgreSQL CI bizonyíték és release-evidence handoff demonstráció (részleges)

Ugyanabban a git worktree-ben folytatva (`/tmp/acropora-os-inventory-checkpoint-8`,
mert az már a helyes ágon, a helyes commiton állt - nem volt szükség új
worktree létrehozására). A fő munkamappa (`feat/field-service-mobile-foundation`,
HEAD `70ef401`) ellenőrizve, változatlan maradt.

**Fontos strukturális felismerés:** ez a worktree ugyanazt a git object
store-t osztja a fő munkamappával (linked worktree) - ezért a
`feat/inventory-consistency-hardening` ág ÚJ commitjai a fő munkamappából
(a felhasználó valós, szinkronizált `Documents/acropora-os` mappájából)
azonnal láthatók lettek, bundle vagy fájlmásolás nélkül (ellenőrizve:
`git log feat/inventory-consistency-hardening` a fő munkamappából
azonnal mutatta a checkpoint 8 commitjait).

### A legfontosabb szabály ŐSZINTE státusza

**Ez a checkpoint NEM felel meg a kimondott legfontosabb szabálynak.** A
sandboxban továbbra sincs GitHub push-hitelesítés (`gh` CLI hiányzik, nincs
credential helper, `git push --dry-run` `could not read Username`-mel
bukik - újra ellenőrizve, változatlan), ezért:

- nem tudtam GitHub Actionst indítani;
- nem tudok run ID-t mutatni;
- a `binaries.prisma.sh` továbbra is 403-mal blokkolt (újra ellenőrizve),
  ezért `prisma generate` itt sem futtatható;
- nincs `docker` a sandboxban, ezért a 9. rész image-buildje sem
  futtatható itt.

Emiatt a 3-6., 8-9. részek "ténylegesen fusson" követelménye NEM
teljesült ebben a munkamenetben - ezeket egy valódi push + GitHub Actions
futtatás nélkül nem lehet becsületesen "sikeresnek" nyilvánítani, és ez a
jelentés nem is állítja ezt.

### Amit ehelyett ténylegesen elvégeztem: célzott, valós kódszintű javítások

A checkpoint 8 kódjának újraátvizsgálásával három konkrét, valós rést
találtam és javítottam - mindegyiket statikusan (tsc --noEmit: 159 alap-
hiba, 0 új) és ahol lehetett, valós PostgreSQL 16-tal is ellenőriztem:

1. **Géppel lekérdezett PostgreSQL-verzió.** A `databaseEngineVersion`
   eddig egy kézzel beírt `"16-alpine"` sztring volt `ci.yml`-ben és
   `release-evidence-handoff.yml`-ben - ez elvben elszakadhatna a
   ténylegesen futó konténer valódi verziójától. Mindkét workflow most
   `psql -tAc "SHOW server_version;"`-vel LEKÉRDEZI a valós szervertől.
   A pontos `SHOW server_version;` szintaxist egy valós, ebben a
   sandboxban futtatott PostgreSQL 16.14 (embedded-postgres) ellen
   ellenőriztem - a lekérdezés helyesen `"16.14"`-et ad vissza.
2. **Ellentmondó SUCCESS/FAILURE evidence felismerése.** Egy GitHub
   Actions `run_id` újrafuttatás (retry) esetén is állandó marad - ezért
   elvben ugyanahhoz a workflowRunId-hoz tartozhat egy korábbi FAILURE ÉS
   egy későbbi SUCCESS sor (vagy fordítva). Az eddigi
   `findLatestConcurrencyTestEvidence` csak a SUCCESS oldalt látta, egy
   esetleges ellentmondó FAILURE sorról nem tudott. Új
   `findContradictingFailureForWorkflowRun` repository-metódus + az
   `activationReadiness()`-ben egy külön ellenőrzés: ha UGYANAHHOZ a
   workflowRunId-hoz FAILURE sor is tartozik, a gate NOT_DEMONSTRATED
   marad, függetlenül attól, hogy a SUCCESS sor minden más feltételnek
   megfelelne.
3. **testSuite tartalom-ellenőrzés.** Eddig a `testSuite` mező tárolva
   volt, de sosem lett ellenőrizve - egy másik/hiányos suite-ra rögzített
   SUCCESS elméletileg feloldhatta volna a kaput. Új
   `EXPECTED_TEST_SUITE_SUBSTRING` küszöbérték + ellenőrzés.
4. **`workflow_dispatch` input-mentesség megerősítése.** A
   `release-evidence-handoff.yml`-nek explicit módon NINCS `inputs:`
   blokkja - dokumentálva, hogy ez szándékos: semmi nem írható felül egy
   dispatch inputtal.

Mind a négy változtatás `tsc --noEmit`-tel statikusan ellenőrizve (159
alaphiba, 0 új). A `stock-diagnostics.service.spec.ts`-hez három új teszt
készült (testSuite-eltérés, ellentmondó FAILURE, nem-ellentmondó eset) -
ÍRVA és statikusan típusellenőrizve, de FUTTATVA NEM lettek, ugyanazon,
korábban dokumentált `@prisma/client` futásidejű blokkoló miatt, ami
minden más, `@acropora/database`-től függő specet is érint ebben a
sandboxban.

### A teljes 79 spec fájlos suite és a 76d8c80/repair konkurenciateszt

Nem futott újra ebben a checkpointban (a checkpoint 8-as futtatás óta nem
változott a Prisma-generálási helyzet, és a checkpoint 8-ban dokumentált
191/129/62-es eredmény pontossága nem évült el, de újbóli, valódi
generált klienssel való futtatás - ahogy a felhasználó 2. minősítése is
mondja - továbbra sincs bizonyítva).

### Handoff demonstráció (8. rész)

NEM végezhető el ebben a sandboxban: a `record-release-evidence.ts` script
maga is `@prisma/client`-et importál a fájl tetején - már ez az import
lefagyasztja a scriptet a generálás hiánya miatt, mielőtt bármilyen
validációs logika lefutna. Emiatt MÉG egy nem-production céladatbázis
elleni helyi szimuláció sem végezhető el itt.

### Docker/RELEASE_COMMIT_SHA (9. rész)

NEM végezhető el: nincs `docker` parancs ebben a sandboxban. A checkpoint
8-ban elkészült Dockerfile/ci.yml-kód változatlanul készen áll, de a
tényleges image-build és `docker inspect` ellenőrzés egy valódi GitHub
Actions futtatást (vagy egy Dockerrel rendelkező fejlesztői gépet)
igényel.

### Pontos parancssor a felhasználónak a valódi CI-futtatáshoz

Mivel ez a worktree UGYANAZT a git object store-t osztja a felhasználó
valós, szinkronizált `Documents/acropora-os` mappájával, a checkpoint 8-9
összes commitja MÁR most is látható onnan (nincs szükség bundle-re vagy
fájlmásolásra) - csak push kell, amihez ennek a sandboxnak nincs
jogosultsága. A felhasználó saját termináljából, a valós mappából:

```
cd ~/Documents/acropora-os
git fetch origin
git log feat/inventory-consistency-hardening --oneline -12   # ellenőrzés: 0c6ab2f és az új checkpoint-9 commitok látszanak-e
git push origin feat/inventory-consistency-hardening
```

Ezután a GitHub Actions felületén (`Actions` fül) a `CI` workflow
automatikusan lefut a push-ra - ennek `run_id`-ját és eredményét kell
visszaadni ehhez a beszélgetéshez, hogy a checkpoint ténylegesen
lezárható legyen a "legfontosabb szabály" szerint. A
`release-evidence-handoff.yml` ezután kézzel indítható a GitHub Actions
"Run workflow" gombjával (csak a `production-release-evidence`
Environment beállítása - required reviewer, `PRODUCTION_RELEASE_EVIDENCE_DATABASE_URL`
secret - után, lásd a fájl saját záró kommentjeit).

### Activation-readiness záró állapota

BLOCKED marad - nincs `RELEASE_COMMIT_SHA` ebben a sandboxban, és nincs
semmilyen valódi evidence-sor egyetlen adatbázisban sem (sem CI-ban, sem
productionben).

### ESTABLISH_CONTROLLED_BASELINE

Előfeltételei továbbra sem teljesülnek - a Prisma generate, a valódi
alkalmazásszintű tesztek és a release-evidence útvonal egyike sem lett
ténylegesen demonstrálva egy valódi futtatásban. Dokumentált terv marad.
