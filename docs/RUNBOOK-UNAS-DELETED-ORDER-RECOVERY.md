# Runbook: éles UNAS-ból fizikailag törölt rendelés helyreállítása

Ez a dokumentum egy **konkrét, éles környezetben már ismert** hiba
helyreállítási lépéseit írja le: egy UNAS-rendelést valaki fizikailag
törölt a UNAS admin felületén (nem sztornózott), az Acropora OS-ben a
rendelés aktív maradt, és a hozzá tartozó, korábban levont készlet
sosem került vissza.

**Ez a dokumentum csak leírás - a benne szereplő lépéseket ez a
munkamenet nem hajtja végre.** A `fix/unas-deleted-order-reconciliation`
ágon elkészült kódváltoztatás (lásd
`docs/INVENTORY-CONSISTENCY.md` "UNAS-ból fizikailag törölt rendelések"
szakasza) ad hozzá egy biztonságos, idempotens utat ehhez - de a tényleges
végrehajtás előfeltétele, hogy ez a fix már **deploy-olva legyen
productionbe**, a runbook lépései utána, a felhasználó/üzemeltető által,
kontrollált módon futtatandók.

## Mielőtt bármit csinálnál

- **NE** futtass közvetlen SQL-t a `SalesOrder`/`StockItem`/
  `StockMovement` táblákon. A cél az, hogy a MEGLÉVŐ, auditálható,
  idempotens kódúton keresztül történjen a helyreállítás, ne egy
  egyszeri, nem-auditált, ismételhetetlen kézi beavatkozáson.
- **NE** hozz létre kézi/manuális készletkorrekciót (pl. egy leltári
  `ADJUSTMENT`-tel "kompenzálva" a hiányt) - ez elfedné a tényleges
  eseményt a ledgerben, és később összekeverhető lenne egy valódi
  leltári eltéréssel.
- **NE** kapcsold be az automatikus háttérellenőrző workert
  (`UNAS_ORDER_DELETION_RECONCILIATION_ENABLED=true`) ennek a runbooknak
  a részeként. A worker rendeltetése egy folyamatos, alacsony
  API-terhelésű védőháló minden jövőbeli esetre - egy már ISMERT,
  konkrét rendelés helyreállítására a lent leírt, célzott egyedi
  frissítés a megfelelő, kisebb hatókörű eszköz.
- Ez a fix csak akkor old fel bármit, ha a UNAS egy célzott, `Key`
  szerinti lekérdezésre EGYÉRTELMŰ "nincs ilyen rendelés" választ ad
  (lásd `docs/INVENTORY-CONSISTENCY.md` "Miért NEM elég a
  lista-válaszból hiányzás" szakasza). Ha a rendelés valójában még
  létezik a UNAS-ban (csak épp nem került elő egy korábbi
  inkrementális ablakban), a frissítés egy normál resync-et végez,
  NEM jelöli törtlésként - ez a mechanizmus önmagában védekezik egy
  téves végrehajtás ellen.

## 1. lépés - az érintett rendelés pontos azonosítása (csak olvasás)

1.1. Azonosítsd az Acropora OS-ben az érintett rendelés helyi `id`-ját
(a webshop-rendelések listájából, vagy ha ismert a UNAS rendelésszám/Key,
`GET /integrations/unas/orders?...` szűréssel, illetve a Rendelések UI
kereséssel).

1.2. Kérdezd le a rendelés jelenlegi állapotát:

```
GET /integrations/unas/orders/:id
```

Jegyezd fel: `status`, `unasDeletedAt` (ekkor még várhatóan `null`),
`lines` (variánsok és mennyiségek).

1.3. **Erősítsd meg a UNAS admin felületén**, hogy a rendelés valóban
fizikailag törölve lett (nem csak sztornózva, nem csak egy szűrt
nézetből hiányzik). Ez a runbook nem helyettesíti ezt az emberi
ellenőrzést - a kód a maga oldalán csak azt garantálja, hogy egy
célzott UNAS-lekérdezés eredménye alapján dönt, de a "melyik konkrét
rendelést nézzük meg" döntés emberi felelősség.

1.4. (Ajánlott, ha van hozzáférés egy csak-olvasó DB-replikához vagy
adatbázis-kliens eszközhöz) Nézd meg az érintett rendeléshez tartozó
`StockMovement`/`StockMovementLine` sorokat (`referenceType='SalesOrder'
AND referenceId=:id`), és az érintett variáns(ok) aktuális
`StockItem.onHand` értékét - ez lesz a "előtte" állapot, amivel a
végrehajtás utáni eredményt összevetjük. Ez a lépés is csak olvasás,
semmilyen írást nem tartalmaz.

## 2. lépés - a fix deploy állapotának ellenőrzése

Győződj meg róla, hogy a `fix/unas-deleted-order-reconciliation` ág már
mergelve és deployolva van productionbe (ez a munkamenet ezt NEM végzi
el - lásd a PR leírását és a "Nem végrehajtott lépések" szakaszt a záró
jelentésben). Amíg ez nem igaz, az alábbi 3. lépés a régi, generikus
404-es viselkedést fogja adni, nem a reconciliation-t.

Ellenőrizd azt is, hogy a következő két env-változó változatlanul
`false` productionben (ennek a fixnek a bevezetése ezt NEM változtatja
meg, és nem is szabad):

```
UNAS_STOCK_SYNC_WORKER_ENABLED=false
UNAS_PRODUCT_SYNC_ENABLED=false
```

## 3. lépés - a célzott, egyedi helyreállítás végrehajtása

**Csak az 1. lépésben azonosított, KONKRÉT rendelés `id`-jára!**

UI-ból: nyisd meg a rendelés részletező oldalát, és kattints a
"Rendelés frissítése" gombra.

API-ból (admin, `ORDERS_MANAGE` jogosultsággal):

```
POST /integrations/unas/orders/:id/refresh
```

Ez a hívás a háttérben:

1. lekéri az adott rendelés UNAS `Key`-ét a helyi `ExternalReference`-ből;
2. egy célzott, `Key` szerinti UNAS-lekérdezést indít (`getOrderByKey`);
3. ha a UNAS egyértelmű "nincs ilyen rendelés" választ ad, elindítja a
   megosztott `reconcileDeletedOrder` logikát: egy tranzakcióban
   visszaforgatja a még kint lévő nettó mennyiséget (a meglévő
   sztornó-mechanizmussal, `RETURN_IN` mozgásként), és a rendelést
   `CANCELLED` + `unasDeletedAt=<most>` állapotba állítja - a rendelés
   és korábbi mozgásai VÁLTOZATLANUL megmaradnak;
4. a válasz a frissített rendelésdetail, `unasDeletedAt` mezővel.

Ha a UNAS ehelyett hibát ad (hálózat/timeout/hitelesítés/rate limit/5xx),
a hívás hibával tér vissza, a rendelés és a készlet ÉRINTETLEN marad -
ilyenkor várj, és próbáld újra később (a hívás idempotens, biztonságosan
ismételhető).

## 4. lépés - eredmény ellenőrzése (csak olvasás)

4.1. Kérdezd le újra a rendelést:

```
GET /integrations/unas/orders/:id
```

Várt eredmény: `status: "CANCELLED"`, `unasDeletedAt` egy nemrégi
időbélyeg, a `lines` VÁLTOZATLAN (a rendelés sorai nem törlődtek).

4.2. Ellenőrizd az érintett variáns(ok) `StockItem.onHand` értékét - a
2. lépés előtti "előtte" értékhez képest pontosan a rendelésen még kint
lévő nettó mennyiséggel kell nőnie.

4.3. Ellenőrizd, hogy PONTOSAN EGY új `RETURN_IN` mozgás jött létre erre
a rendelésre (`referenceType='SalesOrder' AND referenceId=:id`), az
idempotenciakulcs mintája `UNAS_ORDER:<key>:g<generation>:RETURN`. Ha
véletlenül kétszer futtatod ugyanerre a rendelésre a 3. lépést, a
második hívás `unasDeletedAt`-et már beállítva találja, és NEM hoz létre
újabb mozgást (`alreadyReconciled: true` - ez az API válaszában is
látszik, ha a hívó ellenőrzi).

4.4. Ha a `catalogAuthority=UNAS` termékhez tartozik az érintett
variáns, ellenőrizd, hogy a normál UNAS-készletszinkron-outbox
(`UnasStockSyncOutbox`) kapott egy új sort a frissített abszolút
készlettel - ez a meglévő workeren keresztül (ha az engedélyezve van)
magától publikálódik a UNAS felé; explicit UNAS `setStock` hívás ehhez
NEM szükséges kézzel.

## 5. lépés - ha valami nem várt módon alakul

- Ha a hívás azt jelzi, hogy a rendelés VALÓJÁBAN még létezik a
  UNAS-ban (a válasz `unasDeletedAt` nélkül, normál resync-ként tér
  vissza) - állj meg, ez azt jelenti, hogy az 1.3. lépésben tett emberi
  megerősítés téves volt, vagy a rendelés időközben újra létrejött/
  helyreállt a UNAS-ban. Ne erőltesd tovább, vizsgáld felül az
  eredeti feltételezést.
- Ha a hívás hibával tér vissza - a rendelés és a készlet érintetlen,
  biztonságos újra próbálkozni később, vagy más rendeléssel folytatni.
- Ha a 4. lépésben a `StockItem.onHand` nem a várt mértékben változott -
  NE próbálj kézzel korrigálni. Dokumentáld a pontos megfigyelt
  értékeket, és vizsgáld felül, hogy a rendelésnek volt-e korábbi,
  már részlegesen könyvelt visszaforgatása (ilyenkor a mechanizmus
  szándékosan csak a maradékot forgatja vissza - lásd
  `docs/INVENTORY-CONSISTENCY.md` "Készlet-visszaforgatás" szakasza).

## 6. lépés - lezárás

Ha a 4. lépés minden pontja megfelel a várt eredménynek, a helyreállítás
kész - nincs szükség további manuális beavatkozásra ezen a rendelésen.
Ha később további, hasonlóan érintett rendelések kerülnek elő, ismételd
meg az 1-4. lépéseket rendelésenként, egyenként - vagy, ha ez gyakorivá
válik, fontold meg az automatikus háttérellenőrző worker (lásd
`docs/INVENTORY-CONSISTENCY.md` "Automatikus háttérellenőrző worker"
szakasza) bekapcsolását egy külön, erre irányuló, tudatos döntés
keretében - ez a runbook ezt a lépést szándékosan nem javasolja
automatikusan.
