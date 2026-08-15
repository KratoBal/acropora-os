# Foxpost Gmail elszámolás

## Cél

Az `info@acropora.hu` Gmail-fiókba érkező heti Foxpost-levél két mellékletét
automatikusan dolgozza fel:

- a `FOXPOST_...xlsx` fájl `utánvétek` munkalapját;
- az ugyanabban a levélben érkező `FX....pdf` Foxpost-számlát.

A folyamat a `Referencia kód` alapján megkeresi az UNAS-rendelést és a hozzá
tartozó kimenő számlaszámot, majd a számla kelte szerinti hónap könyvelési
XLSX-ébe teszi a heti blokkot. Sem a Gmailben, sem az UNAS-ban nem módosít
adatot.

## Feldolgozási szabályok

1. A Gmail keresés csak olyan levelet ad át, amelyben XLSX és PDF melléklet is
   van. A feldolgozó pontosan egy XLSX + egy PDF párt fogad el levélenként.
2. A két dokumentum összetartozását a partnerkód, elszámolási kód és időszak
   egyezése igazolja.
3. A PDF fizetendő végösszegének egyeznie kell az XLSX összesítőjének bruttó
   számlaösszegével.
4. Az `Utalt` összeg ellenőrzése `Beszedett - Számla` alapján történik; nem az
   utánvétes sorok egyenként kerekített `Utalandó` értékeiből.
5. A rendelési számla feloldása először a helyi
   `ExternalReference.externalKey -> SalesOrder -> Invoice` láncon történik.
   Ha a helyi tükörből hiányzik a rendelés vagy a számla, a rendszer célzott,
   read-only UNAS `getOrderByKey` hívást végez.
6. Hiányzó rendelés vagy még ki nem állított számla esetén az elszámolás
   `NEEDS_REVIEW` állapotú. Ez nem blokkolja a havi fájlt: az automatikusan
   feloldott számlák a `FOXPOST`, a hibás sorok az `Ellenőrzendő tételek`
   munkalapon jelennek meg, Gmail- és sorazonosítókkal együtt.
7. A kezelő az eredeti referenciát közvetlen számlaszámként elfogadhatja, vagy
   más számlaszámot adhat meg. A kézi döntés ideje és felhasználója megmarad,
   és egy későbbi újrafeldolgozás sem írja felül.
8. Kézi jóváhagyás és újrafeldolgozás után a havi riport automatikusan
   újragenerálódik; csak a továbbra is feloldatlan sorok maradnak az
   ellenőrzési munkalapon.

## Idempotencia és fájlmegőrzés

A feldolgozás duplikáció ellen védett a Gmail message ID, az XLSX és PDF
SHA-256 hash, a `partnerCode + settlementCode`, valamint a Foxpost-számlaszám
alapján. A forrásmellékletek és a generált havi XLSX PostgreSQL `bytea`
mezőkben maradnak meg; a fájlok legnagyobb engedélyezett mérete külön-külön
15 MiB.

## Gmail OAuth beállítás

A Google Cloud projektben engedélyezni kell a Gmail API-t, és olyan OAuth 2.0
klienshez kell refresh tokent létrehozni, amely az alábbi egyetlen scope-ot
kapja:

`https://www.googleapis.com/auth/gmail.readonly`

A Coolify API service secretjei:

```text
GMAIL_FOXPOST_CLIENT_ID=...
GMAIL_FOXPOST_CLIENT_SECRET=...
GMAIL_FOXPOST_REFRESH_TOKEN=...
GMAIL_FOXPOST_USER=info@acropora.hu
GMAIL_FOXPOST_SYNC_ENABLED=true
```

A javasolt alapértelmezett lekérdezés:

```text
has:attachment filename:xlsx filename:pdf newer_than:90d
```

A 90 napos átfedés szándékos: az adatbázis-idempotencia miatt ugyanaz a levél
bármennyiszer biztonságosan újra látható. Az automatikus poller alapértelmezett
gyakorisága 60 perc. A többi in-process schedulerhez hasonlóan bekapcsolva egy
API-replika mellett használható.

## Kezelőfelület

`Pénzügy -> Foxpost elszámolás`

- `finance.view`: elszámolások, sorhibák és havi riportok megtekintése,
  riportletöltés;
- `finance.manage`: kézi Gmail-ellenőrzés és egy elszámolás
  újrafeldolgozása, valamint az ellenőrzendő sorok számlaszámának kézi
  jóváhagyása vagy felülírása.
