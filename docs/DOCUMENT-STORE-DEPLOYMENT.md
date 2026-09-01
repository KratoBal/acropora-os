# A dokumentum-tároló bekapcsolása: telepítési recept

Ez a lap **nem terv, hanem lépéssor**: azt írja le, mit csinál végig valaki azon
a napon, amikor a kötet megérkezik. A kód készen áll és mérve van; ami hiányzik,
az a kötet, a jelölő fájl és a jogosultság.

**A tároló ma KI van kapcsolva.** A `DOCUMENT_STORE_ROOT` sehol nincs beállítva,
tehát a futó alkalmazás minden dokumentum bájtjait a PostgreSQL-be írja,
pontosan úgy, mint eddig.

---

## 0. Amit előre tudni kell

|                                     |                                                        |
| ----------------------------------- | ------------------------------------------------------ |
| a Coolify alkalmazás                | `acropora-api`, azonosító `t9gxx94ecwekwruxngps5i6v`   |
| a kötet neve (nevesített kötet)     | `t9gxx94ecwekwruxngps5i6v-acropora-api-document-store` |
| a kötet útvonala a konténeren belül | `/data/document-store`                                 |
| a jelölő fájl neve                  | `.acropora-document-store`                             |
| a konténer felhasználója            | `nestjs`, uid **1001**, csoport `nodejs`               |
| a kapcsoló változó                  | `DOCUMENT_STORE_ROOT`                                  |
| a keret változója (nem kötelező)    | `DOCUMENT_STORE_LIMIT_BYTES`                           |

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
   (`nestjs`) számára. **Az útvonalat ne találd ki, kérdezd meg a Dockert:**

   ```
   docker volume inspect -f '{{ .Mountpoint }}' t9gxx94ecwekwruxngps5i6v-acropora-api-document-store
   chown -R 1001:1001 <a fenti parancs kimenete>
   ```

   **Miért nem áll itt kész útvonal:** ez NEVESÍTETT kötet (a Coolify felületén
   a `host_path` mező üres), tehát a hoszt oldali helyét a Docker adja meg. A
   szokásos elrendezés `/var/lib/docker/volumes/<név>/_data`, de az a Docker
   belső ügye, nem a miénk: egy ide beírt útvonal egy nap csendben elavulna, és
   akkor a `chown` egy nem létező könyvtárra futna, sikeresnek látszó
   eredménnyel.

3. **A jelölő fájl letétele a köteten BELÜL:**
   `touch /data/document-store/.acropora-document-store`
   Ha ez a kötet csatolása ELŐTT történne, a fájl a konténer saját rétegére
   kerülne, és a csatolás elfedné — a tároló `not-configured` maradna, miközben
   a jelölő „ott van".
4. **A mentés lássa a kötetet.** Ez a blokkoló feltétel, és nem technikai
   formaság: amíg a kötet nincs a mentésben, egy lemezre írt fájl KIKERÜL a
   mentésből, és a munka késznek LÁTSZANA.
5. **Csak ezután:** `DOCUMENT_STORE_ROOT=/data/document-store` beállítása a
   Coolify alkalmazás környezeti változói közt, **majd újratelepítés**.

**Melyik lépés után kell újratelepítés, és melyik után nem:** az 1-4. lépés a
kötetet és a tartalmát érinti, azokhoz nem kell — a futó alkalmazás akkor sem
ír rá, mert a változó még nincs beállítva. **Egyedül az 5. lépés kíván
újratelepítést**, mert a környezeti változót az alkalmazás induláskor olvassa.

**Ha a 2-3. lépést az 5. UTÁN pótolják**, az szintén újratelepítést kíván?
**Nem.** A jelölőt és a jogosultságot a `describe()` minden híváskor újra
megnézi, tehát a pótlás azonnal érvényes. Amit viszont pótlás előtt feltöltöttek,
az már az adatbázisba ment (lásd a következő szakaszt), és ott is marad.

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

### (a2) Mi történik, ha a jelölő lemarad

**Ez a legvalószínűbb hiba azon a napon**, mert a jelölő az egyetlen lépés, ami
nem magától értetődő: a kötet létrejön, a jogosultság beáll, minden „kész"-nek
látszik.

**A feltöltés ilyenkor NEM hasal el, és nem is megy a rossz helyre.** Az írási út
minden feltöltés előtt megkérdezi a tároló állapotát, és ha az nem `ready`,
**visszaesik az adatbázisra** — oda, ahol ma is minden sor áll. A rendszer megy
tovább, adat nem vész el.

A hiba két helyen látszik:

- az állapot-végpont `enabled: true` mellett `not-configured` állapotot ad,
- a naplóban egy figyelmeztetés áll minden ilyen feltöltésnél, a `reason`
  mezővel együtt (megnevezi a hiányzó jelölő teljes útvonalát).

**Miért visszaesés, és miért nem elutasítás:** a rendszernek mennie kell, és az
adatbázis-út ép. Egy elutasítás a felhasználót állítaná meg egy olyan hiba
miatt, amit nem ő okozott és nem is tud megoldani. **És miért nem csendes:** a
napló és a végpont is kimondja, tehát a telepítési hiba nem tűnik el — csak nem
a felhasználó fizet érte.

**Amit ez NEM old meg:** ha a jelölő ott van, de a kötet nincs csatolva (valaki
a csatolás előtt tette le, és a mount elfedte), akkor a `describe()` a csatolt,
ÜRES könyvtárat látja jelölő nélkül, tehát `not-configured` — a visszaesés
ugyanúgy véd. De ha valaki a CSATOLT kötetre teszi le a jelölőt, majd a kötetet
később leválasztják, a könyvtár a jelölő nélkül marad, és ugyanez az ág fut.
**Egyik esetben sem megy fájl olyan helyre, ahonnan eltűnhet.**

### (b) Egy feltöltés, ami túléli az újraindítást

Az állapot-végpont azt mondja meg, hogy a beállítás **jó**. Azt nem, hogy a
kötet **tartós**. A kettő különbözik: egy nem csatolt, de írható és megjelölt
könyvtár `ready`-t adna — csak épp a következő újratelepítés elvinné a
tartalmát.

1. Tölts fel egy dokumentumot egy tetszőleges eszközhöz.
2. Töltsd le: a bájtoknak vissza kell jönniük.
3. **Indítsd újra a konténert**, és töltsd le újra.

**Ez a mérés EL TUD BUKNI, és pontosan ez a lényege:** ha a kötet nincs a
helyén, a fájl az újraindítás után nincs meg, és a letöltés hibát ad. Egy
ellenőrzés, ami nem tud elbukni, díszlet — ezért nem elég az állapot-végpontot
megnézni, aminek a `ready` válasza egy nem csatolt, de megjelölt könyvtárra is
igaz lenne.

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

## 4. Hol tart a valóság: mi van MÉRVE, és mi nem

Ez a szakasz a lap állapotát mondja meg, nem a tervét. **Ami mérve van, az
időponttal áll; ami nem, az külön jelöléssel.**

### MÉRVE

| mit                         | mikor                           | mit adott                                                                                                                          |
| --------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| a kötet felvétele           | 2026-09-01 **14:42**            | felvéve, nevesített kötet, `host_path` üres                                                                                        |
| az api újratelepítése       | 2026-09-01 **14:44 - 14:45:52** | a konténer negyven másodperces, alkalmazás/adatbázis/Redis rendben, Coolify `running:healthy`                                      |
| a kivitt commit             | ugyanaz a futás                 | `6d34aeb` -- **csak** az építési javítás, a 307 szándékosan nincs beolvasztva, hogy ez az újratelepítés ne vigye ki a migrációt is |
| a konténeren belüli útvonal | ugyanaz a futás                 | `/data/document-store`, ahogy ez a lap írta -- nem kellett javítani                                                                |

### NINCS MÉRVE, ÉS EZÉRT NEM IS ÁLLÍTOM

- **A jelölő fájl letétele** (3. lépés). A konténer nevére vár.
- **A jogosultság** (2. lépés), és vele a `Mountpoint` értéke.
- **A `DOCUMENT_STORE_ROOT` beállítása** (5. lépés), és minden, ami utána jön.
- **A két ellenőrzés** a 2. szakaszból. Az elsőhöz (állapot-végpont) a 307
  beolvasztása is kell: az `origin/main` ma a `6d34aeb`-en áll, és azon a
  végpont még nem létezik.

**Az első valódi futás után ezt a szakaszt ki kell egészíteni** azzal, ami
eltért -- és a fenti táblázat épp azért van itt, hogy legyen mihez mérni.

- **Az elárvult fájlok mérése külön kártyán áll** (`9dcb16fa`), és létező
  tárolót vár. Az eszköz készen áll: a tábla `storageKey`-es sorai és a tároló
  `list()` eredménye a két bemenet.
