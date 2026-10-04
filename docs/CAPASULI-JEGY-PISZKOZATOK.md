# Cápasuli napi jelentő → jegypiszkozat

A Gmailből behúzott műszaki kérések a külön `ServiceTicketDraft` táblába kerülnek. A `ServiceJob` csak egy belső OWNER/ADMIN **Elfogadom** döntése után jön létre; elvetéskor nincs jegyszám. A piszkozatok nem jelennek meg a partnerportálon vagy a mobil jegylistában.

## Használat

Szerviz / Piszkozatok: eredeti problémaszöveg, teljes napi jelentő, kapcsolódó fotók, korábbi előfordulások, választható Cápasuli helyszín és szerkeszthető szerzőnév. Elfogadás után a meglévő jegyrészletlap nyílik meg, ott lehet delegálni. A jegy REPAIR / NEW; ügyfele a választott helyszín ügyfele, nyitója a beállított aktív PARTNER_SERVICE felhasználó. Az eredeti jegynyitási push és levélút is lefut.

A szerző neve kizárólag a levél `From` megjelenített neve. Csupasz címnél üres marad. Elfogadáskor a javított név a piszkozatba és a jegy nullable `reporterPersonName` mezőjébe kerül. A közös `serviceJobReporterName` formázó példája: `Cápasuli (Szilveszter Roland)`. A szerver ezt a címkét adja a webnek, mobilnak és partnerportálnak; a levélsablon `{{bejelento}}` változója ugyanezt használja. A régi, null értékű jegyek felirata változatlan.

## Feldolgozás

Helyi, szabályalapú sablonfeldolgozó; sem személynév, sem jelentőszöveg nem kerül külső döntési modellhez (PD-001). A hibák szakasz külön problémákat ad, az „És”, „Illetve”, „Sürgős” folytatás az előzőhöz kapcsolódik. A munkák szakaszból berendezést és javítási/csereigényt tartalmazó mondat kerül be; a közvetlen következő sorra tördelt igényt is kezeli. Az állat-egészségügyi és rutinrészek kimaradnak. Az „ez a mi feladatunk?” döntés a bírálóé.

A Gmail-azonosító forrásonként és postafiókonként egyedi. Az azonos napi, azonos normalizált problémaszövegű idézett/Re másolat újrafuttatáskor nem készít új piszkozatot. A normalizálás az írásjeleket, ékezeteket és zárójeles megjegyzéseket hagyja el; lényegesen átírt szöveg kézi ellenőrzést igényelhet. Az ismétlődés jelölése első körben a felnyomó motor, lehabzó venturi és korallos LCD egyértelmű esetét kezeli, külön dátumsorokkal.

Csak a problémához tartozó fájlnevek alapján másol fotókat; a többi jelentőfotó nem kerül a jegyre. A videó a piszkozatból letölthető, jegyre csak fotó másolódik. Korlát: 15 MiB/fájl, 30 MiB/levél, legfeljebb 10 000 találat egy pullban. Egy hibás vagy túl nagy levél későbbi jelentőket nem blokkol, a következő futás újra próbálja, a státuszban személyadat nélküli hibakód látszik.

Egy új piszkozatokat tartalmazó levél egy összesített push-t indít a beállított bírálónak, nem problémánként külön. Az értesítési kísérlet a meglévő DomainEvent naplóba kerül. Hiányzó címzett vagy sikertelen push esetén a piszkozatok megmaradnak; a push nem garantált kézbesítés, a Piszkozatok lista az elsődleges ellenőrzési felület.

## Élesítés utáni beállítás

A migrációkat a szokásos deployment út alkalmazza. Éles postafiók, környezeti változó és deploy nem része ennek a változtatásnak. A kapcsoló alapból kikapcsolt, ismeretlen értéknél is kikapcsolt és az okot kiírja.

```dotenv
GMAIL_CAPASULI_SYNC_ENABLED=false
GMAIL_CAPASULI_CLIENT_ID=
GMAIL_CAPASULI_CLIENT_SECRET=
GMAIL_CAPASULI_REFRESH_TOKEN=
GMAIL_CAPASULI_USER=balazs@acropora.hu
GMAIL_CAPASULI_QUERY=from:zoobudapest.com subject:"napi jelentő"
GMAIL_CAPASULI_SYNC_INTERVAL_MINUTES=60
CAPASULI_OPENED_BY_USER_ID=
CAPASULI_DEPARTMENT_ID=
CAPASULI_REVIEWER_USER_ID=
```

Külön OAuth-kulcsok szükségesek, más postafiók hitelesítő adatait nem veszi át. A tokenhez kizárólag `https://www.googleapis.com/auth/gmail.readonly` hatókört engedélyezz. A kliens Gmailben csak GET hívásokat végez; POST kizárólag OAuth-tokenfrissítés. Nincs címkézés, olvasottra állítás vagy válaszlevél. Indulás után 90 másodperccel kezd, majd az intervallum szerint fut (5–1440 perc). Belső admin státusz: `GET /service/drafts/sync-status`.

A nyitó legyen aktív PARTNER_SERVICE, a gyökérhelyszín ügyfeléhez kötve. A helyszín legyen aktív Cápasuli gyökéregység: csak aktív, azonos ügyfelű leszármazottai választhatók. A bíráló legyen aktív belső OWNER/ADMIN. Ezek konkrét éles azonosítóit Balázs adja meg.

## Ellenőrző példa

A `capasuli-2026-10-03.txt` fixture eredménye két piszkozat:

1. A nagy lehabzó hátsó venturi szivattyújának takarítása + a felette levő csövek rendbetétele. Együtt marad a két mondat; `IMG_0843.jpeg`, `IMG_0844.jpeg`, `IMG_0846.jpeg` kapcsolódik.
2. A korallos feletti LCD kijelző cseréje/javítása. Külön piszkozat, csatolmány nélkül.

Állategészségügyi fotó, etetés és vegyszeradagolás nem keletkeztet piszkozatot.

## Terv

[Figma – Szerviz / Piszkozatok](https://www.figma.com/design/ji64fTFss0jqm5Uifd0zhE/Acropora?node-id=459-638). Natív szerkeszthető képernyő az OS shell, tokenek és mező-/gombkomponensek alapján; az implementáció a meglévő Pilot komponenseket használja.
