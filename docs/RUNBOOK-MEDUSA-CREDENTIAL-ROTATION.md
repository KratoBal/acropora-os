# Runbook: Medusa kulcscsere és a DB-only működés bizonyítása

Ez a lap **parancsokat** ad, nem leírást. Minden parancs a **hostról** fut (nem a
konténerből), másolható, és titok egyikben sem szerepel argumentumként.

Minden lépésnél ott áll, **mit kell látni**, és **mi cáfolná** — egy parancs,
aminek minden kimenete jónak látszik, nem bizonyíték.

**A sorrend nem cserélhető fel.** A régi kulcs visszavonása az egyetlen
visszafordíthatatlan lépés, és csak akkor következik, ha addig minden zöld.

---

## 0. A konténer neve

```bash
docker ps --format '{{.Names}}' | grep acropora-api
```

**Amit látni kell:** pontosan egy név. A továbbiakban ez a `<API>` helyén áll.
**Ami cáfol:** üres kimenet (nem fut a konténer), vagy több név (nem tudni,
melyikről beszélünk — akkor a Coolify oldalán kell megnézni, melyik a stage).

---

## 1. Kiinduló állapot, titok nélkül

```bash
docker exec <API> sh -lc 'echo "commit=${RELEASE_COMMIT_SHA:-nincs beallitva}"; echo "medusa_url=${MEDUSA_ADMIN_URL:-nincs beallitva}"'
```

**Amit látni kell:** a futó build commit SHA-ja és a Medusa cím. Egyik sem titok.
**Ami cáfol:** `nincs beallitva` a commitnál — akkor a futó build nem tudja
magáról, melyik kódból készült, és a jelentésben ezt kell írni, nem tippet.

Az env-kulcs **jelenléte** (az értéke nélkül):

```bash
docker exec <API> sh -lc 'if [ -z "${MEDUSA_ADMIN_API_KEY+x}" ]; then echo "NINCS BEALLITVA"; elif [ -z "$MEDUSA_ADMIN_API_KEY" ]; then echo "URES"; else echo "JELEN VAN, hossz: ${#MEDUSA_ADMIN_API_KEY}"; fi'
```

**Amit látni kell:** a három szó egyike. A kulcs értéke sehol nem jelenik meg; a
hossz azért van benne, mert enélkül a „jelen van" és az „üres" eset nem
különböztethető meg.
**Ami cáfol:** ha bármi más jelenik meg — például maga a kulcs —, azonnal állj meg,
és a kulcsot cseréltnek kell tekinteni.

A Beállítások oldalon (böngésző) ugyanekkor jegyezd fel: **credential source**,
**integration state**, **utolsó ellenőrzés**. A kulcs ott maszkolva látszik.

---

## 2. DB-only bizonyítás

Előfeltétel: a DB-ben érvényes kulcs van, a Beállítások szerint `source =
database`, és a próba zöld.

Az env fallback eltávolítása a stage deploymentből a Coolify felületén történik,
utána újraindítás. **A Coolify felület visszaolvasása nem bizonyíték** — a futó
folyamatot kell mérni, az 1. pont env-parancsával:

**Amit látni kell:** `NINCS BEALLITVA`.
**Ami cáfol:** `JELEN VAN` — akkor a régi konténer fut még, vagy a változás nem
került ki; ilyenkor a DB-only bizonyítás NEM indulhat el.

### Vetítés a tárolt kulccsal

```bash
docker exec <API> sh -lc 'node dist/integrations/medusa/medusa-projection.cli.js <TERMEKAZONOSITO>'
```

**Amit látni kell:**

- egy sor arról, hogy a tárolt hitelesítő adatot használja (`A tárolt hitelesítő
adatot használom (db:N)`);
- és egy eredmény-sor: `<termékazonosító>: created|updated|relinked -> <medusa id>`.

**Ami cáfol:**

- `TARTALÉK ÚT:` kezdetű sor — akkor a kulcs a környezetből jött, tehát a DB-only
  állítás nem áll, és az env eltávolítása nem sikerült;
- `A Medusa hitelesítő adat nincs beállítva.` — nincs tárolt kulcs;
- bármilyen sor, ami magát a kulcsot tartalmazza.

### Idempotencia

Futtasd le **ugyanazt** a parancsot még egyszer.

**Amit látni kell:** `updated -> <ugyanaz a medusa id>`.
**Ami cáfol:** `created ->` egy MÁSIK azonosítóval — az duplikálás, és azonnal
jelentendő.

### Relink

```bash
docker exec <API> sh -lc 'node dist/integrations/medusa/medusa-projection.cli.js --forget-link <TERMEKAZONOSITO>'
docker exec <API> sh -lc 'node dist/integrations/medusa/medusa-projection.cli.js <TERMEKAZONOSITO>'
```

**Amit látni kell:** az első parancs `leképezés törölve (1 sor)`, a második
`relinked -> <ugyanaz a medusa id>`.
**Ami cáfol:** `created ->` új azonosítóval — akkor a külső azonosító alapján nem
találta meg a meglévő terméket, és a Medusában két termék áll ugyanarról.

---

## 3. Az env fallback kontrollja (nem végállapot)

Csak akkor, ha a fenti bizonyítás megvan. A cél nem az, hogy a fallback maradjon,
hanem hogy lássuk: létezik és látszik.

1. a Beállítások oldalon **töröld** a tárolt kulcsot (`DELETE credential`);
2. az env-kulcs kerüljön vissza a deploymentbe, újraindítás;
3. futtasd a vetítést az előző parancssal.

**Amit látni kell:** a `TARTALÉK ÚT:` kezdetű sor, ÉS az eredmény-sor.
**Ami cáfol:** ha nincs `TARTALÉK ÚT` sor — akkor a tartalék néma, és az a hiba,
nem a fallback ténye.

Ezután **állítsd vissza** a tárolt kulcsot, és vedd ki újra az env-kulcsot. A kör
végállapota a DB-only.

---

## 4. Kulcscsere

1. új secret kulcs a Medusa admin felületén;
2. a Beállítások oldalon mentsd el — **ez a titok egyetlen bevitt útja**, a
   kulcs nem megy parancssorba;
3. a Beállítások szerint `source = database`, a próba zöld;
4. vetítés a 2. pont parancsával, zöld;
5. **és csak ezután** revoke a Medusa admin felületén.

---

## 5. A régi kulcs elutasításának ellenőrzése

**KÉT mérés, ebben a sorrendben, és az első NEM hagyható ki.** Egy `401`
önmagában nem bizonyítja, hogy a kulcs vissza van vonva: ugyanezt kapjuk akkor
is, ha a hívás ALAKJA rossz (elgépelt cím, rossz végpont, elrontott basic-auth
forma). A két eset kívülről megkülönböztethetetlen, és a második egy hamis
megnyugvás: azt hinnénk, hogy a revoke hatott, holott csak rosszul kérdeztünk.

Ezért előbb az ÚJ kulccsal mérünk, ugyanazon az úton, ugyanabban a formában. Ha
az `200`-at ad, akkor a hívás alakja bizonyítottan jó, és onnantól a régi kulcs
`401`-e a KULCSRÓL szól, nem a kérdésről.

A hívás ártalmatlan (egyetlen olvasás, `limit=1`), és a kulcs **nem** kerül sem
parancssorba, sem héj-előzménybe: a `curl` konfigurációs fájlból olvassa.

### 5.1 Kontroll az ÚJ kulccsal (előbb)

```bash
install -m 600 /dev/null /tmp/medusa-key.conf
```

Nyisd meg szerkesztővel a `/tmp/medusa-key.conf` fájlt, és írd bele:

```
url = "<MEDUSA_URL>/admin/products?limit=1"
user = "<UJ_KULCS>:"
silent
output = "/dev/null"
write-out = "%{http_code}\n"
```

A mérés:

```bash
curl --config /tmp/medusa-key.conf
```

**Amit látni kell:** `200`.
**Ami cáfol:** bármi más. Ilyenkor **a mérés nem folytatható**: nem a régi kulcs
állapotát mérnénk, hanem a saját hívásunk hibáját. Előbb a cím és a forma
javítandó, és csak utána jön az 5.2.

### 5.2 A régi kulcs (csak az 5.1 után)

Ugyanabban a fájlban cseréld ki a `user` sort a RÉGI kulcsra, és futtasd újra:

```bash
curl --config /tmp/medusa-key.conf
```

**Amit látni kell:** `401` (vagy `403`).
**Ami cáfol:** `200` — akkor a régi kulcs a revoke után is működik. Ilyenkor NE
találgass: jegyezd fel az időpontot, ismételd meg a mérést öt és tizenöt perc
múlva, és a jelentésbe a mért időzítés kerüljön.

### 5.3 A fájl törlése

```bash
shred -u /tmp/medusa-key.conf
```

**Ez akkor is fusson le, ha a mérés félbeszakad** — hiba, megszakítás, vagy mert
közbejött valami. A fájlban egy éles kulcs áll: vagy az, amit épp visszavonunk,
vagy az, amit épp élesbe állítottunk. Ha bizonytalan vagy benne, megvan-e még,
egyetlen parancs eldönti:

```bash
ls -l /tmp/medusa-key.conf
```

Ha a fájl létezik, töröld a fenti `shred` paranccsal.

## 6. Végállapot-ellenőrzés

| Amit meg kell nézni          | Hol                           | Elvárt érték      |
| ---------------------------- | ----------------------------- | ----------------- |
| credential source            | Beállítások oldal             | `database`        |
| integration state            | Beállítások oldal             | működő állapot    |
| env-kulcs a futó folyamatban | az 1. pont parancsa           | `NINCS BEALLITVA` |
| új kulcs (kontroll)          | az 5.1 parancsa               | `200`             |
| régi kulcs                   | az 5.2 parancsa               | `401` vagy `403`  |
| új kulcs                     | vetítés a 2. pont parancsával | zöld              |

Ha az env-kulcs valamilyen rollback okból bent marad, azt **dokumentálni kell**:
hogy jelen van, hogy nem aktív, és hogy mikor vehető ki. Határidő nélküli néma
fallback nem maradhat.
