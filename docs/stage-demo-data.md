# Demo sorok a teszt szerveren (T6.3)

Kitalált, jelölt sorok, hogy a teszt szerveren három folyamatot ki lehessen próbálni: ügyfél-ajánlat (szerkesztő, publikálás, küldés) és a Bejövő számlák lista (fizetett, fizetetlen, lejárt, külföldi pénznemű, ismeretlen fizetésű). Minden név, szám és összeg kitalált.

**Ez nem a stage alapadata.** Az alapadat az anonimizálási láncból jön (kártya 07b56a1f), és éles olvasást kér. Ez egyiket sem igényli, és nem keveredik vele: a sorok a `DEMO-` előtagjukról ismerhetők fel.

## Futtatás

A stage API konténerben, a `apps/api` könyvtárból:

```bash
node dist/demo-data/demo-data.cli.js                             # a terv, nem ír semmit
node dist/demo-data/demo-data.cli.js --apply  --db-host <gépnév> # a hiányzó sorok betöltése
node dist/demo-data/demo-data.cli.js --remove --db-host <gépnév> # minden DEMO- sor törlése
```

- Az `--apply` újrafuttatható: ami megvan, ahhoz nem nyúl, és kiírja, hogy nem írt semmit.
- A `--remove` csak a `DEMO-` előtagú ügyfél-, ajánlat- és számlasorokat törli.
- A dátumok a futás napjához képest számolódnak, tehát az ajánlatok érvényesek, a számlák frissnek látszanak.

## Az őrző, és a határa

Íráshoz (`--apply`, `--remove`) két dolog kell, és az első az, ami a stage-et az éles környezettől elválasztja:

1. A környezetben `DEMO_DATA_ALLOWED=stage`. Ezt csak a stage állítja be (`.env.staging.example`); a `.env.example` és a `.env.production.example` üresen tartja, és egy spec ezt rögzíti. Jel nélkül a parancs akkor sem ír, ha a második feltétel teljesül.
2. A `--db-host <gépnév>` az adatbázis gépneve a `DATABASE_URL`-ből. Egy konténeres telepítésben a gépnév gyakran a szolgáltatás neve (`postgres`, `db`), ami a stage-en és élesen azonos lehet, ezért ez nem érzékelő, hanem szándékos lépés: az üzemeltető kiírja, melyik adatbázisra fut.

**A jel gyengesége:** a `.env` másolható, tehát ha a STAGE `.env`-je kerül át az élesre (vagy valaki a jelet kézzel beállítja ott), a jel az éles környezetben is megvan, és a második feltétel, a begépelt gépnév marad az egyetlen akadály. Erősebb jel lenne az anonimizálási lánc (kártya 07b56a1f) nyoma az adatbázisban (futás-sor, jelző tábla), de ma ilyen nincs; ha lesz, az őrző arra cserélhető. Éles adatbázison ezt nem futtatjuk.

## A `--remove` mindent vagy semmit

A törlés egy tranzakció, és csak `DEMO-` előtagú sorokat érint. Ha egy DEMO ügyfélre közben valaki valódi sort kötött (munkalap, nem DEMO-s ajánlat), az ügyfél törlése idegenkulcs-hibával elhasal, és az egész tranzakció visszagördül: **ilyenkor a `--remove` semmit nem töröl.** Ez szándékos és biztonságos: egy félig törölt demo-készlet (ajánlat ügyfél nélkül, számla az ügyfelek maradtával) rosszabb, mint egy érintetlen. Megoldás: a hozzákötött sort előbb le kell választani vagy törölni, aztán a parancs újrafuttatható.

## Mi van benne

3 ügyfél, 3 ajánlat (piszkozat, egy részletfizetéssel), 4 POS eladás (mind a négy fizetési mód, egy ügyfeles, egy kedvezményes), 5 bejövő számla.

A POS eladások csak KÉZI tételekből állnak, ahogy a valódi szolgáltatás (`PosSaleService.createSale`) is írja az ilyen eladást: csatorna POS, kész, `KÉZI` cikkszám, termék nélkül. Ezért nincs mögöttük készletmozgás és nincs UNAS készlet-szinkron sor. A termékes sor mindkettőt írná, és a stage-ről UNAS felé induló írást nem indítunk. A demo eladások tehát a POS listát és az adatlapot próbálják ki, a készletet nem.

**Szándékos eltérés a frissen rögzített valódi eladás alakjától:** a valódi szolgáltatás a kézi tétel sorának szinkron-állapotát `PENDING`-re állítja, a demo sorok `OK`-n állnak. Kézi sornál nincs változat, tehát nincs mit UNAS-ba tolni, és a `PENDING` sort egy későbbi szinkron-folyamat felvehetné, ami a stage-en fölösleges mozgás volna. A végállapot a valódi folyamatban is `OK` lesz, csak egy szinkron-kör után.
