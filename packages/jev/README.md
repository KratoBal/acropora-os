# @acropora/jev: Jev V0 offline kiértékelő

Szerződés: KratoBal/acropora-os #1199 (ACD-001–005). Balázs jóváhagyása: PD-002 ACCEPT, 2026-09-28 10:17 UTC.

**Offline. Nincs éles hívási út:** az API nem importálja ezt a csomagot. Nincs séma-migráció, nincs felület, nincs `DecisionRun`. A futtató az adatbázist csak olvassa.

## Tartalom

| Modul                             | Mit csinál                                                                                                 |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `cph1.ts`                         | Canonical Projection Hash v1: normalizálás, majd JCS (RFC 8785), UTF-8, SHA-256, végül `cph1:sha256:<hex>` |
| `cph1-vectors.json`               | a közös tesztvektorok (22 eset). A várt értéket Python `json` + `hashlib` állította elő, nem ez a kód      |
| `asset-category-projection.ts`    | a P-004 vetület (`service-assets.asset-category@1`)                                                        |
| `jev-client.ts`                   | a Jev choice-hívás, befecskendezhető `fetch`-csel                                                          |
| `evaluation.ts`                   | az arany készlet beolvasása és a G pont mérőszámai                                                         |
| `run.ts`                          | a futtatás és a riport                                                                                     |
| `scripts/eval-asset-category.mjs` | a futtató: adatbázisból olvas, `--dry-run` módban nem hív                                                  |

## Döntések

1. **A vetület kulcsai snake_case-ek** (`performance_unit`, `power_consumption`, `parent_category`). A cph1 szabálya `[a-z0-9_]` kulcsot kér, és más kulcsra dob. A P-004 példájában camelCase kulcsok álltak; a szabály a szerződés, nem a példa. acrobot 2026-09-28 12:21-kor egyetértett.
2. **A levágott whitespace halmaza ki van mondva** (ECMAScript WhiteSpace + LineTerminator), mert a JS `trim()` és a Python `strip()` nem ugyanazt vágja (pl. az U+FEFF-et). A vektorfájl tartalmaz rá esetet.
3. **A vektorfájl jelölői:** a halmazt, a decimálist és az időpontot `$cph1_set`, `$cph1_decimal` és `$cph1_datetime` jelöli. A JSON ezeket nem tudja megkülönböztetni; minden nyelv betöltője a saját típusára fordítja őket.
4. **Az előtag levágása:** az eszköz saját részleg-útvonalának (`WorksheetDepartment.code`, a gyökértől) leghosszabb végszelete, pontos egyezéssel és szóhatáron. Ha nem egyezik, egy tartalék minta jön (több szegmens, illetve a `CAP`). Az `UV` és a `GHL` marad. acrobot mérte az éles adaton, hogy az előtag a részleg-útvonal. A riport kiírja, melyik szabály hányszor vágott.
5. **A `performance_unit` a mértékegység neve** (`UnitOfMeasure.name`), nem a kódja, ahogy a címkéző tábla is mutatja.
6. **A modell rögzített** (`jev-1.13.0`). Ha eltűnik, a futás megáll (`MODEL_UNAVAILABLE`, kilépési kód 2), és nem vált `jev-latest`-re (Q-004 H).
7. **A modell a vetület adatrészét kapja**, kanonikus JSON-szövegként (`state`). Ez a mért, működő alak; a JSON-objektum alakot a Jev dokumentálja, de nem mértük.

## Futtatás

Előtte `pnpm --filter @acropora/jev build`.

```bash
# ellenőrzés, kulcs és hívás nélkül: az előtag-szabályok száma és az első 20 vetület
DATABASE_URL=... node packages/jev/scripts/eval-asset-category.mjs --golden arany.csv --dry-run

# a kiértékelés; a kulcs csak környezeti változóban
DATABASE_URL=... TYPESAFE_API_KEY=... node packages/jev/scripts/eval-asset-category.mjs --golden arany.csv --out <mappa>
```

Az arany készlet a címkéző tábla alakja: pontosvessző vagy vessző, BOM megengedett. A kötelező oszlopok:

- `asset_id`;
- `HELYES_KATEGORIA` (név, kód vagy azonosító);
- `ELDONTHETO…` (`igen`/`nem`) vagy `unresolvable`.

Az `ELFOGADHATO_MEG` oszlop elhagyható; több kategória `|`-vel választható el. Az ismeretlen kategória megnevezett hiba, ilyenkor a Jev nem hívódik.

## Ami emberi munka, és ez a kód nem végzi el

- **Az arany készlet címkézése** (PD-003: a címkézőt Balázs jelöli ki). Minden sorhoz meg kell adni a helyes kategóriát és azt, hogy eldönthető-e a vetületből.
- **A második átnézés** a bizonytalan, ritka, több-helyes és eldönthetetlen elemekre (P-007).
- **A futtatás** (a kulcs acrobotnál van) és a riport alapján hozott döntés.
