# GLS elszámolás

## Cél

A GLS két külön levélben küldi az `info@acropora.hu`-ra, amit a Foxpost egyben:

- **utánvét-részletező** (`utanvet@gls-hungary.com`, hetente): az utalás napja,
  csomagonként az utánvét-hivatkozás és az összeg;
- **számlamelléklet** (`szamlamelleklet@gls-hungary.com`, kb. kéthetente): a GLS
  díjszámlája csomagonként, ügyfél- és utánvét-hivatkozással, kártyadíjjal.

A rendszer az utánvét-sorokat a kimenő számlához köti, és havi könyvelési
XLSX-et ad. Sem a Gmailben, sem a webshopban nem módosít semmit.

## Párosítás

Csak helyi adatból, webshop-hívás nélkül:

1. ha az utánvét-hivatkozás számlaszám (`ACRW-2026/00469`, `ACRB-…`, több is
   lehet), és ilyen kimenő számla létezik: kész;
2. különben rendeléskulcs (a hivatkozásból vagy a számlamelléklet
   ügyfélhivatkozásából) a helyi tükrön át a rendelés számlájához;
3. különben kézi ellenőrzés, javaslattal. Az előtag nélküli `2026/00123` csak
   javaslat (`ACRW-2026/00123`), soha nem kerül magától be: az ACRB sorozat is
   létezik.

A kézi döntést újrafeldolgozás sem írja felül. Egy jelentés kétszer is
megérkezhet más bájtokkal: a tartalma (nap + csomagok + összegek) is egyedi.

## A díj

A GLS a teljes utánvétet utalja, a díjat külön számlázza (a 81 számlamelléklet
bankköltség-lapja mind üres, a kártyadíj a számlán áll). A havi fájlban ezért
nincs díj-sor az utalás blokkjában; a díjszámlák külön lapon állnak.

## Gmail-behúzás

Csak olvasó (`gmail.readonly`) hozzáférés, a két GLS-feladóra szűkítve, a
levelek XLSX-mellékletei ugyanazon az úton mennek, mint a kézi feltöltés. Egy
levelet egyszer tölt le; egy nem olvasható fájl okkal együtt rögzül, és nem
próbálkozik vele óránként.

```text
GMAIL_GLS_SYNC_ENABLED=true          true / false; bármi más: KI, és ezt ki is írja
GMAIL_GLS_CLIENT_ID=...              ha a három üres, a GMAIL_FOXPOST_* kulcs megy
GMAIL_GLS_CLIENT_SECRET=...
GMAIL_GLS_REFRESH_TOKEN=...
GMAIL_GLS_SYNC_INTERVAL_MINUTES=60
```

**A kapcsoló nem hallgat.** A Foxpost-behúzás élesen hét hétig egyszer sem
futott, mert a kapcsolója csak a pontos `"true"` szót fogadta el, és
kikapcsolva semmit nem írt (mérve 2026-09-29). Ezért itt:

- az API induláskor mindkét állapotban egy sort ír ("GLS Gmail sync enabled
  (60 min, key: GMAIL_FOXPOST_*)" vagy "... disabled (...)", az okkal);
- a GLS-oldal kiírja, ha a behúzás ki van kapcsolva, és miért;
- bekapcsolva mutatja az utolsó futást, a sikertelent a hibakóddal.

## Kezelőfelület

`Pénzügy -> GLS elszámolás`

- `finance.view`: utalások, sorok, díjszámlák, havi XLSX letöltése, a
  behúzás állapota;
- `finance.manage`: fájl feltöltése kézzel, sor jóváhagyása, újrafeldolgozás,
  "Gmail ellenőrzése most" (ha van Gmail-kulcs).
