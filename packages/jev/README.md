# @acropora/jev: Jev V0 offline kiértékelő

Szerződés: KratoBal/acropora-os #1199 (ACD-001–005). Balázs jóváhagyása: PD-002 ACCEPT, 2026-09-28 10:17 UTC.

**Offline. Nincs éles hívási út:** az API nem importálja ezt a csomagot. Nincs séma-migráció, nincs felület, nincs `DecisionRun`. A futtató az adatbázist csak olvassa.

## Tartalom

| Modul                              | Mit csinál                                                                                                 |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `cph1.ts`                          | Canonical Projection Hash v1: normalizálás, majd JCS (RFC 8785), UTF-8, SHA-256, végül `cph1:sha256:<hex>` |
| `cph1-vectors.json`                | a közös tesztvektorok (22 eset). A várt értéket Python `json` + `hashlib` állította elő, nem ez a kód      |
| `asset-category-projection.ts`     | a P-004 vetület (`service-assets.asset-category@1`)                                                        |
| `jev-client.ts`                    | a Jev choice-hívás, befecskendezhető `fetch`-csel                                                          |
| `evaluation.ts`                    | az arany készlet beolvasása és a G pont mérőszámai                                                         |
| `run.ts`                           | a futtatás és a riport                                                                                     |
| `scripts/eval-asset-category.mjs`  | a futtató: adatbázisból olvas, `--dry-run` módban nem hív                                                  |
| `decision-report.ts`               | a V1 pilot riportja a `DecisionRun` táblából (ACD-009): csak aggregátum                                    |
| `scripts/report-decision-runs.mjs` | a pilot riport futtatója: `READ ONLY` tranzakcióban olvas, nem hív                                         |

## Döntések

1. **A vetület kulcsai snake_case-ek** (`performance_unit`, `power_consumption`, `resze_ennek`). A cph1 szabálya `[a-z0-9_]` kulcsot kér, és más kulcsra dob. A P-004 példájában camelCase kulcsok álltak; a szabály a szerződés, nem a példa. acrobot 2026-09-28 12:21-kor egyetértett.
2. **A levágott whitespace halmaza ki van mondva** (ECMAScript WhiteSpace + LineTerminator), mert a JS `trim()` és a Python `strip()` nem ugyanazt vágja (pl. az U+FEFF-et). A vektorfájl tartalmaz rá esetet.
3. **A vektorfájl jelölői:** a halmazt, a decimálist és az időpontot `$cph1_set`, `$cph1_decimal` és `$cph1_datetime` jelöli. A JSON ezeket nem tudja megkülönböztetni; minden nyelv betöltője a saját típusára fordítja őket.
4. **Az előtag levágása:** az eszköz saját részleg-útvonalának (`WorksheetDepartment.code`, a gyökértől) leghosszabb végszelete, pontos egyezéssel és szóhatáron. Ha nem egyezik, egy tartalék minta jön (több szegmens, illetve a `CAP`). Az `UV` és a `GHL` marad. acrobot mérte az éles adaton, hogy az előtag a részleg-útvonal. A riport kiírja, melyik szabály hányszor vágott.
5. **A `performance_unit` a mértékegység neve** (`UnitOfMeasure.name`), nem a kódja, ahogy a címkéző tábla is mutatja.
6. **A modell rögzített** (`jev-1.13.0`). Ha eltűnik, a futás megáll (`MODEL_UNAVAILABLE`, kilépési kód 2), és nem vált `jev-latest`-re (Q-004 H).
7. **Policy @2 (2026-09-28), betű szerint acrobot mért A/B hívása** (`exchange/jev-v0-ab-2026-09-28.py`, B változat).
   - **A szülő:** a `parent_category` helyett a `resze_ennek` magyarázó mondat. Az @1 éles futásán a nyers szülő-kategória mellett a modell a 67 hibából 53-szor a szülő kategóriáját választotta (szülővel 6/59 jó). A B változat ugyanazon a 127 elemen 79,5%-ot adott (≥ 0,9 mellett 2 rossz).
   - **Az utasítás, a NONE leírása és a `state` alakja is a mért hívásé.** A `state` a vetület adatrésze Python `json.dumps` alakban (rendezett kulcs, `", "` és `": "`, nyers ékezet); egy teszt bájtra összeveti a Python kimenetével.
   - **Az @1-ben ezeken a pontokon tértem el**, és a szülő nélküli 68 elemen 54 jót adott a mért 61 helyett. Hogy a három eltérés közül melyik okozta a különbséget, azt nem mértük. Ezért nem választottam közülük, hanem a mért alakot vettem át egészben. Ezeknek a szövegeknek bármelyik átírása új mérés és új policy-verzió.

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

## A V1 pilot riportja (ACD-009)

A `DecisionRun` táblát olvassa, élesen és stage-en egyaránt. A lekérdezések egy `READ ONLY` tranzakcióban futnak, tehát az adatbázis maga tagadna meg bármilyen írást.

```bash
DATABASE_URL=... node packages/jev/scripts/report-decision-runs.mjs --out <mappa> --label eles
```

- **Mit riportol:** SHOWN ACCEPTED/OVERRIDDEN; HIDDEN SHADOW_MATCH/SHADOW_MISMATCH csoportonként (10%-os kontroll, ritka kategória, 0,90 alatti, NONE); a kettő különbségét (horgonyhatás); a bizonyosság-sávok találati arányát; a ritka kategóriák árnyék-eredményét; a hibaarányt és a késleltetést; a modell- és policy-driftet; a STALE és EXPIRED arányt; a review trigger (50 SHOWN + 10 HIDDEN-kontroll) állását.
- **Mit nem ír ki:** a `projectionPayload`-ot. Csak aggregátumot, és típusonként legfeljebb néhány példát (`--examples`, alap 3, legfeljebb 10). Ezeknek a vetített neve a példa-futásonként külön olvasódik ki.
- **Az EXPIRED itt számolódik**, a tábla nem írja (Council D4): az a futás, ami 14 nap után sincs eszközhöz kötve és feloldva. A `--now` a viszonyítási pont.
- **A kategória nélkül mentett eszköz** a SHOWN ágon OVERRIDDEN, a HIDDEN ágon SHADOW_MISMATCH (így oldja fel az API). A riport ezt külön számolja („kategória nélkül mentve”, „üresen”), mert a D4 (még a létrehozás utáni árnyék-futásra írva) a 14 napig kategória nélkül maradt eszközt EXPIRED-nek szánta. A V1 a mentéskor old fel, ezért itt ez az eset nem EXPIRED; hogy melyik olvasat a helyes, az a review döntése.
- **Konzisztencia:** a tárolt `exposure`-t a mai szabállyal újraszámolja. Ha eltér, egy kategória-kód megváltozott a futás óta, és a csoportosítás félrevezethet.

## Ami emberi munka, és ez a kód nem végzi el

- **Az arany készlet címkézése** (PD-003: a címkézőt Balázs jelöli ki). Minden sorhoz meg kell adni a helyes kategóriát és azt, hogy eldönthető-e a vetületből.
- **A második átnézés** a bizonytalan, ritka, több-helyes és eldönthetetlen elemekre (P-007).
- **A futtatás** (a kulcs acrobotnál van) és a riport alapján hozott döntés.
