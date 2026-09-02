# Runbook: a kategóriafa első betöltése a Medusába

Ez a lap **menetet** ad, nem tervet. Minden parancs a **hostról** fut, másolható,
és titok egyikben sem szerepel argumentumként.

Minden lépésnél ott áll, **mit kell látni** és **mi cáfolná**. A végén a három
értelmezés áll: ha valami nem stimmel, a kimenet önmagában **nem** mondja meg,
melyik hiba történt.

**A sorrend nem cserélhető fel.** Az `--apply` az egyetlen lépés, ami ír. Előtte
minden olvas.

---

## 0. A konténer neve

```bash
docker ps --format '{{.Names}}' | grep acropora-api
```

**Amit látni kell:** pontosan egy név. A továbbiakban ez a `<API>` helyén áll.
**Ami cáfol:** üres kimenet (nem fut), vagy több név (nem tudni, melyik a stage).

---

## 1. A futó build tartalmazza-e az aktív jelölő javítását

Ez nem formaság. A javítás előtti build mind a 219 kategóriát **inaktívan** hozná
létre, és a futás közben **semmi nem szólna**: a katalógus létrejön, a számok
helyesek, csak senki nem látja.

```bash
docker exec <API> sh -lc 'echo "commit=${RELEASE_COMMIT_SHA:-nincs beallitva}"'
```

**Amit látni kell:** egy commit-azonosító, ami a `86883d7` (#390) **után** áll a
főágon.
**Ami cáfol:** `nincs beallitva`, vagy egy korábbi commit. Akkor a betöltést
**nem szabad elindítani** — előbb a friss build kell.

Ha a `RELEASE_COMMIT_SHA` nincs beállítva, a kérdés attól még eldönthető:

```bash
docker exec <API> sh -lc 'grep -c "is_active: true" dist/integrations/medusa/medusa-category-import.service.js'
```

**Amit látni kell:** `1`.
**Ami cáfol:** `0` — a futó kód nem küldi ki a jelölőt.

---

## 2. Terv, írás nélkül

```bash
docker exec <API> sh -lc 'node dist/integrations/medusa/medusa-category.cli.js'
```

**Amit látni kell:**

- egy sor a tárolt hitelesítő adatról (`A tárolt hitelesítő adatot használom (db:N)`);
- `Létrehozandó: 219`, és minden más nulla;
- a záró sor: `Ez a futás semmit nem írt. A betöltéshez: --apply`

**Ami cáfol:**

- `Létrehozandó` nem 219 — a fa nem az, amire számítunk;
- `Ütközés` nem nulla — akkor **ne** menj tovább, az ütközést előbb el kell
  dönteni (lásd a 6. pontot);
- `A betöltés megállt: a Medusa kategória-listája kimerítette a limitet` — a
  lista csonkolt, a terv így nem dönthető el.

**Ez a futás után csak tudás marad.** Ha bármi meglepő, itt kell megállni: ez az
utolsó pont, ahol semmi nem történt.

---

## 3. A betöltés

```bash
docker exec <API> sh -lc 'node dist/integrations/medusa/medusa-category.cli.js --apply'
```

**Amit látni kell:**

```
Létrehozva: 219
Csak leképezés írva: 0
Elavult leképezés átírva: 0
Változatlan: 0
Ütközés, érintetlen: 0
A szülőjük miatt kimaradt: 0
Ellenőrzés (219 kategóriára): a Medusában 219 hordozza a mi azonosítónkat,
ebből 219 aktív; nálunk 219 leképezés-sor áll.
A három szám egyezik.
```

**Ami cáfol:** bármi, ami nem `A három szám egyezik.` A parancs ilyenkor
megnevezi, melyik baj áll fenn — a mondatokat a 6. pont fordítja teendőre.

**Kilépési kód:** `0` ha minden rendben, `2` ha ütközés vagy kimaradt ág van
(nem hiba, de ember dönt), `1` ha a betöltés megállt.

---

## 4. A hat mérce, és hogy melyik honnan jön

| #   | mérce                               | honnan                                                     |
| --- | ----------------------------------- | ---------------------------------------------------------- |
| 1   | 219 kategória áll a teszt Medusában | a 3. pont `Ellenőrzés` sora                                |
| 2   | mindegyiken a **mi** azonosítónk    | ugyanaz a sor: csak a mi azonosítónkat hordozókat számolja |
| 3   | a mély ágak a helyükön              | lásd lent                                                  |
| 4   | kétszeri futás után is 219, nem 438 | az 5. pont                                                 |
| 5   | a 219-ből hány **aktív**            | a `Ellenőrzés` sor középső száma                           |
| 6   | hány leképezés-sor áll **nálunk**   | a `Ellenőrzés` sor utolsó száma                            |

**A 3. mérce két őrzőn áll, és egy szemrevételezésen.** A betöltés nem tud rossz
szülő alá tenni egy ágat: a sorrend-ellenőrzés megállítja a futást, ha egy
kategória a szülője előtt állna, és a fel nem oldott szülőjű ág nem jön létre
gyökérként, hanem kimarad (`A szülőjük miatt kimaradt`). Marad egy kézi próba:
nyiss meg egy negyedik szintű kategóriát a Medusa admin felületén, és nézd meg,
hogy a harmadik szintű szülője alatt áll.

**Ha a `Ellenőrzés` sor hiányzik a kimenetből**, akkor a futó build a #393 előtti.
Akkor az 5. és a 6. mérce nem kérdezhető le a parancsból, és külön adatbázis-
lekérdezés kell hozzájuk. Ilyenkor jobb a friss buildet megvárni: e nélkül a két
néma hiba pontosan az, amit nem látnál.

---

## 5. A második futás

```bash
docker exec <API> sh -lc 'node dist/integrations/medusa/medusa-category.cli.js --apply'
```

**Amit látni kell:** `Létrehozva: 0`, `Változatlan: 219`, és ugyanaz az
`Ellenőrzés` sor, mint az elsőnél.
**Ami cáfol:** `Létrehozva` nem nulla — akkor a párosítás nem talált rá arra,
amit az első futás létrehozott, és a Medusában most 438 kategória áll.

---

## 6. A három értelmezés, ha valami nem stimmel

**Ez a lap legfontosabb pontja.** Ha a vetítés később azt írja, hogy egy
kategória leképezése hiányzik, az a mondat **három** különböző okra áll, és a
szöveg nem választja szét őket.

### a) A betöltés nem futott le

`Ellenőrzés`: `0` mindhárom szám.
**Teendő:** futtasd le (2., majd 3. pont).

### b) Lefutott, de rossz kulccsal

`Ellenőrzés`: a Medusa oldalán 219, nálunk **0**.
Ez az az eset, amit a forrás-fájl azonosítói okoznának: az export `Azonosító`
oszlopa **UNAS** azonosítót hordoz, nem a mienket, és ha az kerülne a
leképezés-sorba, a vetítés soha nem találna semmit.
**Teendő:** ne futtasd újra. A leképezés-sorok kulcsát kell megnézni, mielőtt
bármi újat írnánk.

### c) Lefutott, de inaktívan

`Ellenőrzés`: a Medusa oldalán 219, ebből **0 aktív**, nálunk 219.
A katalógus létezik, a leképezés áll, és mégsem látszik semmi.
**Teendő:** a Medusa nem tárolta el az `is_active` mezőt. Ez az a kérdés, amit
csak az első éles futás dönt el — a szerződés ismeri a mezőt, a telepített
példány viselkedése külön állítás.

**A három állapot ugyanazt a tünetet adja a vetítés oldalán.** A `Ellenőrzés`
sor három száma az egyetlen hely, ahol szétválnak.

---

## Amit ez a lap nem fed le

- **Az engedélyt.** A teszt Medusába írni Balázs esetenkénti engedélyével szabad.
  A jog megléte nem engedély.
- **Az éles boltot.** Ez a menet a **teszt** példányra szól. Éles kirakat előtt a
  láthatóságot a saját modellünkbe kell felvenni és soronként származtatni — ma
  a betöltés mind a 219 kategóriát aktívként hozza létre, holott az UNAS
  exportban 211 látszik és 8 nem.
