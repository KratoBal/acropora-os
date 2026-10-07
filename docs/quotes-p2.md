# Árajánlat P2 – PDF és publikálás

Jóváhagyott terv: [#1582](https://github.com/KratoBal/acropora-os/issues/1582#issuecomment-6036894392), „P2 PDF”.

## Végpontok

| Végpont                                | Jogosultság                      |
| -------------------------------------- | -------------------------------- |
| `POST /quotes/:id/versions/:v/publish` | `quotes.view` + `quotes.publish` |
| `GET /quotes/:id/versions/:v/pdf`      | `quotes.view`                    |

A `GET …/pdf` piszkozatnál élő előnézetet rajzol, és nem tárolja; publikált
vagy felülírt verziónál a tárolt bájtokat adja, újrarajzolás nélkül.

## Publikálás (idempotens)

1. Zár alatt: a piszkozat ellenőrzése (legalább egy nem opcionális tétel,
   nem lejárt érvényesség), az ügyfél pillanatképe a verzióra, és az ELSŐ
   kérés ideje (`publishRequestedAt`, új oszlop, migráció
   `20261008000000_quotes_p2_publish_requested_at`).
2. Tranzakción kívül: a PDF rajzolása, a kérés idejével mint létrehozási
   dátummal. Azonos tartalom így azonos bájtokat ad, tehát a dupla kattintás
   ugyanazt a fájlt írja (`quotes/<ajánlat>/v<N>-<sha256 első 16>`).
3. Zár alatt: ha a tartalom közben módosult, 409; különben a verzió
   PUBLISHED lesz a PDF adataival, az előző PUBLISHED felülírt, és PUBLISHED
   esemény íródik. A másik kattintás a már publikált verziót kapja.

Dokumentumtár nélkül (`DOCUMENT_STORE_ROOT`) a publikálás 503: a kiküldött
PDF-nek túl kell élnie egy újraindítást. A publikálás nem küld semmit az
ügyfélnek (az a P3).

## A PDF

A Figma 35 „Final PDF Design” (`579:2898`) szerint, a közös PDF-kerettel
(`createBrandedPdf`, opcionális rögzített létrehozási dátummal; a meglévő
hívók változatlanok). Minden magasság rajzolás előtt mérve; a szabályok:
fejezetcím az első tételével, tétel neve és ára együtt (a leírása
bekezdésenként átfolyhat), opcionális blokk egyben ha elfér, összesítő nem
törik, `startOnNewPage` blokk új oldalon, minden oldalon oldalszám, ajánlatszám
és verzió. Az ár a verzió megjelenítése szerint nettó, bruttó vagy mindkettő;
a fizetési ütemezés a mérföldkő-sorokból.

## Web

`/ajanlatok/:id/pdf` (`569:363`): előnézet, letöltés, és a „Verzió
publikálása” megerősítéssel. Belépés a szerkesztő „PDF előnézet” gombjáról
és az adatlap verziótáblájának PDF-oszlopából.
