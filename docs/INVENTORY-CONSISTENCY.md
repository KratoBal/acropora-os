# Készletkonzisztencia: Acropora OS mint a készlet hiteles forrása

Státusz: folyamatban (checkpoint 1-2 elkészült - lásd `ROADMAP.md`/audit
jegyzőkönyv). Ez a dokumentum a **leltár, beszerzés és POS folyamatok
tényleges átvezetése**, a **UNAS rendelésimport delta-logikája**, a
**reconciliation** és a **health/diagnosztika** részletes leírásával bővül a
következő checkpointokban. Ami itt szerepel, a ténylegesen elkészült kódot
írja le.

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

- A leltár/beszerzés/POS jelenlegi implementációja **még nem** hívja az
  új `postInventoryMovement`-et (ez a következő checkpoint) - ezért az
  outbox ma még nem kap valódi forgalmat ezekből a folyamatokból, csak a
  writer-t közvetlenül hívó jövőbeli kódból.
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
