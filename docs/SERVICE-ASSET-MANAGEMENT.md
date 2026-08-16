# Szerviz asset management és QR-azonosítás

## Cél

Az eszköznyilvántartás a partnereknél üzemelő rendszerek, berendezések,
részegységek és szenzorok tartós törzsadata. Minden eszköz pontosan egy
tulajdonoshoz tartozik: ez lehet `Customer` (Vevők) vagy `Supplier`
(Partnerek). Vevő esetén opcionálisan partnercímhez és akváriumhoz, mindkét
tulajdonostípusnál UNAS-ból tükrözött termékváltozathoz és szülőeszközhöz is
kapcsolható.

Példa:

- Fóka szűrőrendszer (`SYSTEM`)
  - Fóka felnyomó szivattyú (`COMPONENT`)
  - Fóka vezérlőszekrény (`COMPONENT`)
    - Vízszintérzékelő (`SENSOR`)

A `parentAssetId` önhivatkozó kapcsolat tetszőleges mélységű fát kezel. Az API
tiltja a ciklust, a másik partnerhez tartozó szülőt, az idegen partnercímet és
az idegen vagy archivált akváriumot.

## Adatmodell

Az `Asset` legfontosabb mezői:

- ember által olvasható, egyedi `assetNumber` (`ESZK-...`);
- stabil, véletlenszerű `qrToken` – a QR soha nem tartalmaz adatbázis-ID-t;
- egymást kizáró `customerId` vagy `supplierId` adatbázis-korláttal;
- vevőnél opcionális `customerAddressId` és `aquariumId`;
- opcionális `parentAssetId` és `productVariantId`;
- típus, státusz és kritikusság;
- gyártó, modell, sorozatszám, leltári szám és műszaki leírás;
- telepítés, vásárlás, garancia és karbantartási ütemezés; az intervallumból a
  következő karbantartás automatikusan számolódik;
- létrehozó/módosító felhasználó és időbélyegek.

Az `AssetEvent` append-only előzményként őrzi a létrehozást, státusz-,
elhelyezés- és hierarchiaváltást, valamint a QR-token cseréjét. A
`ServiceJobAsset` előkészíti a több eszközt érintő munkalapokat és az egy
eszközhöz tartozó teljes szerviztörténetet.

Az `AssetDocument` jogosultsággal védett, legfeljebb 10 MB-os PDF-eket tárol:
számlát, garanciajegyet, használati utasítást vagy egyéb dokumentumot. A fájl
első körben a PostgreSQL-adatbázisban marad, SHA-256 lenyomattal és feltöltési
audittal. Ez nem zárja ki a későbbi Paperless-ngx integrációt; akkor a rekord
külső dokumentumazonosítóval és szinkronállapottal bővíthető.

## QR-folyamat

1. Az API az eszköz létrehozásakor UUID QR-tokent generál.
2. `GET /service/assets/:id/qr` helyben, külső szolgáltatás nélkül készíti el az
   SVG QR-kódot.
3. A QR értéke: `${ASSET_QR_BASE_URL}/<qrToken>`.
4. A mobilapp saját QR-kamera nézete vagy a telefon gyári kamerája a megfelelő
   Acropora OS appvariáns `/assets/scan/[token]` route-ját nyitja meg.
5. A mobilapp hitelesítve hívja a `GET /service/assets/scan/:qrToken` végpontot.
6. Az API csak `service.view` jogosultsággal adja vissza az eszközadatot.

Ha egy matrica elveszett vagy illetéktelen kézbe került, a webes adatlapon a
QR-token rotálható. A régi kód azonnal érvénytelenné válik, az esemény pedig az
eszköztörténetbe kerül.

Környezeti értékek:

| Környezet       | `ASSET_QR_BASE_URL`                 |
| --------------- | ----------------------------------- |
| development     | `acropora-os-dev://assets/scan`     |
| preview/staging | `acropora-os-preview://assets/scan` |
| production      | `acropora-os://assets/scan`         |

## Felületek

Web:

- `/szerviz/eszkozok` – kereshető és szűrhető lista;
- `/szerviz/eszkozok/uj` – partner, helyszín és szülő kiválasztásával létrehozás;
- `/szerviz/eszkozok/:id` – adatlap, hierarchia, előzmények, állapot és QR.
- `/szerviz/eszkozok/:id/szerkesztes` – teljes szerkesztés OWNER, ADMIN,
  MANAGER és SERVICE szerepkörrel;
- az adatlapon PDF feltöltés, letöltés és törlés.

Mobil:

- `/assets` – SERVICE-kompatibilis aktív eszközlista;
- `/assets/scanner` – alkalmazáson belüli kameraalapú QR-keresés;
- `/assets/new` – terepi eszközfelvitel;
- `/assets/:id` – terepi adatlap és komponenshierarchia;
- az adatlapon 30×30 mm-es QR-címke natív nyomtatása vagy PDF-megosztása;
- `/assets/scan/:token` – QR-feloldás, szükség esetén bejelentkezés után.

## API-jogosultság

- olvasás, QR-feloldás és QR-letöltés: `service.view`;
- létrehozás, módosítás, dokumentumkezelés és QR-rotáció: `service.manage`.

A mobil szerepkör-mátrix csak prezentációs kapu; minden jogosultságot az API is
ellenőriz.

## Következő szerviz-inkrementum

Az asset registryre épülhet a teljes munkalap-flow: `ServiceJobAsset`
kapcsolás, checklist, munkaidő, felhasznált anyag, fotók, aláírás,
teljesítésigazolás és a munkalap lezárásából újraszámolt következő
karbantartás.
