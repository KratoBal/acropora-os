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

Íráshoz meg kell adni az adatbázis gépnevét (`--db-host`), és az egyeznie kell a `DATABASE_URL` gépével. A repóban nincs környezet-jelölő (a stage és az éles is `NODE_ENV=production`), ezért az őrző nem érzékelő, hanem szándékos lépés: egy rossz adatbázisra mutató futást csak az állítaná meg, hogy a gépnevet ott is be kell gépelni. Éles adatbázison ezt nem futtatjuk.

## Mi van benne

3 ügyfél, 3 ajánlat (piszkozat, egy részletfizetéssel), 5 bejövő számla. A POS eladás külön szelet, mert készletmozgást és számozást érint, ezért a meglévő szolgáltatáson át megy.
