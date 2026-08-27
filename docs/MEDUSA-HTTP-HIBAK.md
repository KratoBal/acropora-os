# A Medusa HTTP-hibák megnevezése és a titok-felület

**Állapot:** megvan, mindkét fele. A lap először tervként készült; a döntés
2026-08-27-én megszületett (acrobot), és a kód ugyanabban a körben elkészült.
A terv szövege azért maradt itt, mert a MIÉRT nem avul el a kóddal.

**A döntés, szó szerint:** mind a négy hívásnál megnevezzük, EGY körben, nem
kettőben; és a megállás-szövegből a törzs kikerül, a státusz marad.

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

## 6. A konvenció, ahogy megvalósult

**Egy függvény, egy szabály:** `describeMedusaFailure` (a kliens modulban, a
hibaosztály mellett). HTTP-hibánál a STÁTUSZT adja vissza, mást nem. Nem HTTP
eredetű hibánál az üzenet megmarad - az a szöveg a futtatókörnyezetből jön
(időtúllépés, névfeloldás), nem a Medusa válaszából, tehát nem visszhangozhat
semmit, amit mi küldtünk.

**Két megállási ok, nem négy.** A termék-vetítés `medusa-read-failed` és
`medusa-write-failed` okot ad, a hívás KINDJE szerint, nem hívásonként. A
különbség, ami a jelentést olvasó első kérdése: egy olvasás bukásánál BIZTOSAN
nem változott semmi odaát, egy írásénál nem tudjuk. A készlet-vetítés már így
nevezte a két írását; ez a kör csak kiterjesztette a konvenciót.

**Az írás bukásánál a leképezést sem írjuk.** Egy leképezés azt állítaná, hogy
a termék odaát a mi azonosítónkon áll - épp az, ami bizonytalan.

**Mérve, hogy a szabály EGY helyen áll:** ha a leíró megint az `error.message`
értékből épül, öt teszt vált pirosra KÉT vetítésben. Ha egy elkapási hely
kimarad, csak az az egy, ami megnevezi.

## 7. Ami nyitva marad, és kinek

A fenti három nyitott pont MIND lezárult, a döntéssel együtt. Ami tovább él:

- A készlet-vetítés három OLVASÓ hívása (161, 202, 221) továbbra is védtelen.
  A mostani kör a termék-vetítést és a titok-felületet rendezte; ugyanez a
  konvenció ráhúzható, de az külön változtatás.
- Az `updateInventoryLevel` / `createInventoryLevel` ág megnevezése már megvolt,
  csak a szövege vitte a törzset - az most rendben van.
