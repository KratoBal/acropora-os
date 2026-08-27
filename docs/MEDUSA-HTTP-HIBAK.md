# A Medusa HTTP-hibák megnevezése és a titok-felület

**Állapot:** terv. Kód ebből a körből NEM készült, mert a megnevezés
viselkedést változtat. Ami készült: a jelen lap és egy tesztfájl, ami azt a két
állítást rögzíti, aminek a megnevezés UTÁN is igaznak kell lennie
(`apps/api/src/integrations/medusa/medusa-product-projection.http-failure.spec.ts`).

## 1. A kiindulás

Egy fejlesztői futás a készlethely-lekérdezésnél **nyers kivétellel** állt meg,
teljes veremmel és fájl-útvonalakkal, nem megnevezett megállással. Innen
indult a visszamérés, és a kép tágabb lett, mint az érintett függvény.

## 2. Mit mértem, és hol tart ma a két vetítés

| Hely            | Medusa-hívás                                                                   | `try`             | Mit fed                                              |
| --------------- | ------------------------------------------------------------------------------ | ----------------- | ---------------------------------------------------- |
| termék-vetítés  | 4 (`findSalesChannel` 191, `update` 264, `findByExternalId` 285, `create` 359) | **0**             | semmit                                               |
| készlet-vetítés | 5                                                                              | 3 (355, 384, 405) | a két ÍRÁST, plusz a mennyiség-szabály saját hibáját |

A készlet-vetítés három OLVASÓ hívása (161, 202, 221) ugyanúgy védtelen.

**Ebből következik, hogy nem egy kifelejtett `catch` a kérdés.** A Medusa
integrációnak **nincs HTTP-hiba-megnevezési konvenciója**; a készlet-vetítés az
egyetlen hely, ahol ez részlegesen elindult. A kártya hatóköre ezért nem egy
függvény, hanem egy döntés: hol nevezzük meg a HTTP-hibákat, és mit mondjunk.

## 3. A titok-felület, mérve

A `MedusaAdminHttpError` üzenete így áll össze:

```
MEDUSA_ADMIN_HTTP_${status}: ${body}
```

ahol a `body` a válasz törzsének első 500 karaktere. A készlet-vetítés
`describeError` függvénye ezt az `error.message` értéket adja tovább, és az a
`medusa-write-failed` megállás-szövegébe kerül, amit a parancs kiír.

**Vagyis a mai egyetlen megnevezett hiba a válasz TÖRZSÉT is viszi.** Ebből
következik a lap legfontosabb állítása: **minden új `catch` egyben új
titok-felület is.**

Egy mért adat a kockázat MÉRETÉHEZ, de nem szabály: a fejlesztői futás 401-énél
a Medusa válasza `{"message":"Unauthorized"}` volt, tehát titkot nem hordozott.
Ezt csak utólag lehetett megtudni, és a brief szigorúbb ennél: a titok
plaintext értéke hibakimenetben sem jelenhet meg.

## 4. A javaslat: EGY döntés, nem kettő

**A megnevezett hiba a STÁTUSZT vigye, a TÖRZSET ne.**

Két irány feszül egymásnak. A megnevezés iránya: minél több helyen fogjuk el a
hibát és adunk neki nevet, annál használhatóbb a kimenet. A titok iránya: a mai
megnevezés a törzset is beleteszi, tehát a több `catch` több felület. A kettő
együtt viszont megfér: státusz igen, törzs nem.

**Amiért egyben kell.** Ha ez két külön körként fut - előbb „nevezzük meg több
helyen", később „ne tegyük bele a törzset" -, akkor az **első kör önmagában
RONTJA a helyzetet**: több helyre kerülne be a válasz törzse, mint ma. A
sorrend tehát nem ízlés kérdése.

## 5. Amit a tesztfájl rögzít, és amit szándékosan nem

A `http-failure` spec **két állítást** rögzít, mind a négy hívási ponton:

1. egy elbukott hívás soha nem eredményez **sikert**;
2. egy elbukott **írás** soha nem hagy maga után leképezést.

Egyik sem change-detector: ma azért zöldek, mert a kivétel kiszáll, a
megnevezés után pedig azért maradnak zöldek, mert egy megnevezett megállás sem
sikert, sem leképezést nem ír. Pirosra akkor kell váltaniuk, ha valaki elkapja
a hibát és **mégis továbbmegy**.

A második a súlyosabb: a leképezés azt állítja, hogy a mi termékünk odaát
létezik ezen az azonosítón. Ha az írás el sem jutott a cél oldalig, a leképezés
hazudik, és a következő futás már nem is keresne rá.

**Amit szándékosan NEM tesz tesztbe:** azt a tényt, hogy ma nyers kivétel száll
ki. Az a mai állapot, nem követelmény - és épp az fog megváltozni. Ezért ez a
lapon áll, méréssel, nem a tesztben.

**A falszifikálás, mindkét irányban:**

| Rontás                                             | Mi lett piros                                                     |
| -------------------------------------------------- | ----------------------------------------------------------------- |
| az `update` hibáját elnyeljük és továbbmegyünk     | csak a két állítás az `update` ágon (7., 9.); a kontrollok zöldek |
| a hívás el sem ér a bukási pontig (nincs cikkszám) | csak a négy kontroll; a két állítás üresen zöld                   |

A második sor mondja meg, miért kell a kontroll: nélküle a tesztek akkor is
zöldek lennének, ha a mért hívás el sem indul.

## 6. Ami nyitva marad, és kinek

- **Hol nevezzük meg**: mind a négy termék-vetítési hívásnál, vagy csak az
  írásoknál? A lap javaslata: mind a négynél, mert az olvasó hibája ugyanúgy
  megállás, csak ma névtelen.
- **A készlet-vetítés meglévő `medusa-write-failed` szövegéből ki kell venni a
  törzset.** Ez viselkedés-változtatás, tehát a döntés része.
- A `describeError` mai alakja (`error.message`) ezzel nem marad tartható: a
  HTTP-hibánál a **státuszt** kell adnia, nem az üzenetet.
