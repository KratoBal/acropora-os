# A dokumentum-tároló bekapcsolása: telepítési recept

Ez a lap **nem terv, hanem lépéssor**: azt írja le, mit csinál végig valaki azon
a napon, amikor a kötet megérkezik. A kód készen áll és mérve van; ami hiányzik,
az a kötet, a jelölő fájl és a jogosultság.

**A tároló ma KI van kapcsolva.** A `DOCUMENT_STORE_ROOT` sehol nincs beállítva,
tehát a futó alkalmazás minden dokumentum bájtjait a PostgreSQL-be írja,
pontosan úgy, mint eddig.

---

## 0. Amit előre tudni kell

|                                     |                                          |
| ----------------------------------- | ---------------------------------------- |
| a kötet útvonala a konténeren belül | `/data/document-store`                   |
| a jelölő fájl neve                  | `.acropora-document-store`               |
| a konténer felhasználója            | `nestjs`, uid **1001**, csoport `nodejs` |
| a kapcsoló változó                  | `DOCUMENT_STORE_ROOT`                    |
| a keret változója (nem kötelező)    | `DOCUMENT_STORE_LIMIT_BYTES`             |

**A jelölő fájlt az alkalmazás SOHA nem hozza létre**, és ez nem hiányosság,
hanem a védelem maga. Egy írható könyvtár önmagában nem bizonyítja, hogy a kötet
csatolva van: a csatolási pont **üres** könyvtára ugyanolyan írható. Ha az
alkalmazás letehetné a jelölőt, az egy nem csatolt könyvtárban is létrejönne, és
az ellenőrzés soha nem tudna elbukni.

---

## 1. A sorrend, és miért pont ez

A lépések sorrendje nem kényelmi kérdés. **A `DOCUMENT_STORE_ROOT` az UTOLSÓ
lépés**, mert amíg nincs beállítva, semmi nem ír a kötetre — tehát minden
korábbi lépés hibája ártalmatlan.

1. **A kötet létrehozása és csatolása** a `/data/document-store` útvonalra.
   A `DOCUMENT_STORE_ROOT` ekkor még **nincs** beállítva.
2. **Jogosultság:** a könyvtárnak írhatónak kell lennie az uid **1001**
   (`nestjs`) számára. A legegyszerűbb alak a hoszton:
   `chown -R 1001:1001 <a kötet hoszt oldali útvonala>`
3. **A jelölő fájl letétele a köteten BELÜL:**
   `touch /data/document-store/.acropora-document-store`
   Ha ez a kötet csatolása ELŐTT történne, a fájl a konténer saját rétegére
   kerülne, és a csatolás elfedné — a tároló `not-configured` maradna, miközben
   a jelölő „ott van".
4. **A mentés lássa a kötetet.** Ez a blokkoló feltétel, és nem technikai
   formaság: amíg a kötet nincs a mentésben, egy lemezre írt fájl KIKERÜL a
   mentésből, és a munka késznek LÁTSZANA.
5. **Csak ezután:** `DOCUMENT_STORE_ROOT=/data/document-store`, majd újraindítás.

---

## 2. A két ellenőrzés, amiből látszik, hogy sikerült

### (a) Az állapot-végpont

```
GET /service/assets/document-store
```

`SERVICE_MANAGE` jog alatt áll, és **két külön mezőt** ad vissza:

```json
{ "enabled": true, "status": { "state": "ready" } }
```

- `enabled` azt mondja meg, **használjuk-e** (a változó be van-e állítva),
- `status` azt, hogy **használható-e** (a jelölő ott van-e, és a könyvtár
  írható-e).

**A kettő eltérése a telepítés legveszélyesebb pillanata**, és ezért van két
mező egy közös „működik" helyett:

| enabled | state            | mit jelent, és ki oldja fel                                                                                                          |
| ------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `false` | bármi            | a változó nincs beállítva — az 5. lépés hiányzik                                                                                     |
| `true`  | `not-configured` | **a kötet nincs csatolva, vagy a jelölő hiányzik.** Ez a rossz eset: a változó már ír, de nem oda, ahova hisszük. Telepítési kérdés. |
| `true`  | `broken`         | a könyvtár ott van, de nem írható (vagy nem is könyvtár). Jogosultsági kérdés, a 2. lépés hiányzik.                                  |
| `true`  | `ready`          | kész                                                                                                                                 |

A végpont **`broken` állapotnál is 200-zal felel**. Aki ezt hívja, épp azt akarja
megtudni, mi az állapot; egy 503 ugyanazt az információt rejtené el, amiért a
végpont készült.

### (b) Egy feltöltés, ami túléli az újraindítást

Az állapot-végpont azt mondja meg, hogy a beállítás **jó**. Azt nem, hogy a
kötet **tartós**. A kettő különbözik: egy nem csatolt, de írható és megjelölt
könyvtár `ready`-t adna — csak épp a következő újratelepítés elvinné a
tartalmát.

1. Tölts fel egy dokumentumot egy tetszőleges eszközhöz.
2. Töltsd le: a bájtoknak vissza kell jönniük.
3. **Indítsd újra a konténert**, és töltsd le újra.

Ha a harmadik lépés után is megjön a fájl, a kötet tartós. Ha a letöltés
`503`-at ad („A dokumentum tartalma a tárolóban nem érhető el"), akkor a fájl
nem élte túl — a kötet nincs a helyén, és a `DOCUMENT_STORE_ROOT`-ot **azonnal
ki kell venni**, mielőtt több feltöltés menne rá.

---

## 3. Ami a bekapcsolás után is igaz marad

- **A régi sorok a helyükön maradnak.** Minden mai dokumentum bájtjai az
  adatbázisban állnak, és ott is maradnak: az átköltöztetés külön,
  újraindítható munka, nem a bekapcsolás feltétele. A letöltési út a
  `storageKey` alapján dönt, tehát a régi sorok migráció nélkül működnek.
- **A keret alapból nincs bekapcsolva.** `DOCUMENT_STORE_LIMIT_BYTES` nélkül a
  feltöltés nem néz keretet. Ez szándékos: egy kitalált alapértelmezett határ
  egy nap csendben elutasítana egy feltöltést, amiről senki nem döntött.
- **A tábla őrzi, hogy a tartalom pontosan egy helyen áll**
  (`AssetDocument_exactly_one_content_source_check`). Egy háttérmunka vagy egy
  új végpont nem örökli az alkalmazás ellenőrzéseit, a tábláét viszont igen.

---

## 4. Amit ez a lap NEM tud, és meg kell nézni

- **Nem tudom, hogy a kötet hoszt oldali útvonala mi lesz**, tehát a 2. lépés
  `chown` parancsa útvonal nélkül áll. Azt a Coolify erőforrás-beállítása
  mondja meg.
- **Nem mértem a bekapcsolást**, mert nincs mit: a kötet nem létezik. Minden
  fenti lépés a kód olvasott viselkedéséből következik, nem egy végigcsinált
  telepítésből. **Az első valódi futás után ezt a lapot ki kell javítani** azzal,
  ami eltért.
- **Az elárvult fájlok mérése külön kártyán áll** (`9dcb16fa`), és létező
  tárolót vár. Az eszköz készen áll: a tábla `storageKey`-es sorai és a tároló
  `list()` eredménye a két bemenet.
