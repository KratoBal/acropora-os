# NAV OPG pénztárgépes nyugták

A pénztárgépes forrás a Számlázás → Nyugták nézetben, `billing.view` jogosultsággal érhető el. A Számlázz.hu forrás és a meglévő `/billing/receipts` válasz változatlan marad. Napi magyar idő szerinti szűrés, lapozott nyugtalista, teljes napi fizetőeszköz-összesítés, hiányjelzés és legutóbbi futás látszik.

## Üzembe helyezés

1. Alkalmazd a `20261005140000_cash_register_receipts` migrációt a szokásos kiadási folyamatban.
2. A már tárolt `NavConnectionSetting` / `NavCredentialsService` technikai felhasználó szükséges, OPG naplólekérdezési jogosultsággal. Nincs új hitelesítési kulcs vagy AP-szám konfiguráció: a státuszlekérdezés felsorolja az elérhető pénztárgépeket.
3. Először száraz visszatöltési terv: `pnpm --filter @acropora/api nav:opg-backfill`. Csak státuszt kérdez és adatbázist olvas; kiírja az összes aktuálisan elérhető, még nem tárolt fájlsorszámot.
4. Jóváhagyott környezetben a `pnpm --filter @acropora/api nav:opg-backfill -- --apply` menti az összes elérhető, még hiányzó fájlt. A NAV felé mindkét mód kizárólag lekérdezést küld.
5. A napi ütemező alapból kikapcsolt. `NAV_CASH_REGISTER_SYNC_ENABLED=true`, `NAV_CASH_REGISTER_SYNC_INTERVAL_MINUTES=1440` bekapcsolja; az első futás indulás után 30 másodperc, utána az előző futás végétől számított intervallum. Ezek működési kapcsolók, nem új NAV-hitelesítési beállítások.

A fejlesztés során sem éles visszatöltést, sem ütemezőt, sem migrációt nem indítottunk a termelési környezetben.

## Fájlok és hibák

SOAP 1.2 / OPF 1.0, a közös NAV kriptográfiai segédfüggvényekkel. A helyes alapútvonal mindkét művelethez `https://api-onlinepenztargep.nav.gov.hu/queryCashRegisterFile/v1/`. A software blokk az API névterében áll. A MIME feldolgozás bináris, a kódolt CID-ket dekódolja, az elemeket névtér-URI alapján olvassa. A ZIP méretkorlátozott dekompressziót és CRC-ellenőrzést kap; a CMS BER/DER olvasó az encapsulated contentet emeli ki. **Ez nem tanúsítványos aláírás-ellenőrzés.** A NAV `fileValidationResultCode` értékét eltároljuk; `WARN` látható, `ERROR` megállítja a futást.

A fájl, valamennyi nyugta, tételsor és kurzor egy tranzakcióban íródik. Az `(AP, fájlsorszám)` és `(AP, nyugtaszám, fájl)` egyedi. Az eredeti XML gzip formában és SHA-256 lenyomattal marad meg. Azonos fájl újrafeldolgozása nem duplikál; megváltozott tartalmú azonos fájl hibát ad.

A `SIZE` válasz után a legutóbb ténylegesen visszaadott sorszám + 1 következik. Lyukas, ismétlődő, üres vagy hiányos „allFilesSent” válasz nem lépteti át a hiányt. A megőrzési időből kiesett tartomány külön `CashRegisterGap` rekorddal és kurzorfrissítéssel, együtt mentődik. A `NOT_AVAILABLE` először friss státuszt kér; csak a megerősített új minimum alatti tartomány minősül megőrzési hiánynak. A legutóbbi sikertelen futás figyelmezteti a felhasználót, hogy a lista hiányos lehet. A futások adatbázisban kizárják egymást; megszakadt futás 30 perc inaktivitás után helyreállítható, fájlonként frissített és ellenőrzött futásazonosítóval.

## Nyugták

OPGN 2.0: `NYN` eladás, `SZN` sztornó (`SBS`), `VBN` visszáru (`VBS`). A nyitó, pénzmozgás-, napi záró- és tanuló bizonylatok nem nyugták. Az `ITL` lapos ismétlődő mezőcsoportjai külön tételek. Pénzügyi értékek adatbázisban Decimal, az API-ban szövegként pontosak. A sztornó és visszáru összege az összesítésben egyszer levonódik, a törölt nyugták kimaradnak. Az összesítés a szűrt nap **összes** bizonylatára vonatkozik, nem csak az aktuális oldalra.

Fizetőeszköz: `DRC/FE1` készpénz, `FE2` kártya, `FEV/CFT` valutás készpénz forintértéke, `FEE` és `FE3/FES` egyéb. A végösszeghez képesti különbözet „Nem besorolt / kerekítés”; nyomtatott kártyaadatból nem következtetünk fizetési összegre. A `ZQQ` sorok nem kerülnek a nyugtalista válaszába.

A `GYŰJTŐ 1` név változatlanul látszik. Nincs termékazonosítás, készletmozgás, POS-eladás létrehozás vagy UNAS-módosítás. A tárolt nyers XML érzékeny forrásadat lehet; az API csak a nyugtalista mezőit adja vissza. A tesztfixture `CCN` számjegyei maszkoltak.

## Ellenőrzési minta és visszatöltési tartomány

A felhasználó 2026-10-05 08:10:48.488 UTC időbélyegű státuszmintája szerint az A01413081 pénztárgép tartománya **11542–11579**, 38 fájl. Ez a mellékelt státusz pillanatképe; éles NAV-lekérdezést nem futtattunk. A tényleges visszatöltés saját friss státuszából tervezi a tartományt.

A 11575 fájl 2026-10-03 napi mintája: 7 eladás, 469 890 Ft, ebből 458 090 Ft bankkártya és 11 800 Ft készpénz. A fixture alapján parser-, SOAP/MTOM-, CMS/ZIP-, `SIZE`/hiánykezelési, tranzakciós idempotencia- és felületi tesztek futnak.

Hivatalos protokoll és naplóséma: [NAV Online-Cash-Register-Logfile](https://github.com/nav-gov-hu/Online-Cash-Register-Logfile), `OPF/cashRegisterApi.xsd`, `OPG/V2_AEEnaplo_6.6.5.xsd`.
