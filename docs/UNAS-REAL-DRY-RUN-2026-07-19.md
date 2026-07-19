# Valós UNAS katalógus dry run – 2026-07-19

## Forrás és futtatási környezet

A futtatás kizárólag a termék- és kategóriaexportot használta. A vásárlói exportot nem olvastuk be és nem dolgoztuk fel. Az eredeti fájlok a repositoryn kívül maradtak, tartalmuk nem változott.

| Forrás                                                    | SHA-256                                                            | Adatsor |
| --------------------------------------------------------- | ------------------------------------------------------------------ | ------: |
| `UnasShop_acropora-unas-hu_20260719-143058.xlsx`          | `6c0895ccad94674cdddfe36531448b50ce79c3b34066d5a32714775a7ebefe64` |   1 884 |
| `UnasShop_acropora-unas-hu_category_20260719-143145.xlsx` | `868f87f492bf5d7c47416abb34a94b5a2b92a61a4fd994e2250232c906fb36fc` |     219 |

A két egy munkalapos exportból az `apps/api/scripts/merge-unas-catalog.mjs` egy ideiglenes, repositoryn kívüli `Products` + `Categories` munkafüzetet készített. A sorok és sorszámok változatlanok maradtak. Az ideiglenes fájl SHA-256 értéke `1738ee7db08ee259e2460ea230153234a856dd40d1805fb61ddb3c77d8649d4d` volt. Feldolgozás: `2026-07-19T14:25:33.572Z`, a #0006.6 nem commitolt munkafájljain.

Az API-t development auth `OWNER` felhasználóval, a `POST /imports/unas/catalog/dry-run` végponton hívtuk. A helyi PostgreSQL és Redis Docker szolgáltatások egészségesek voltak.

## Eredmény

Batch: `cmrrw1dwe000079vmyuu69mmz`.

| Művelet                | Darab |
| ---------------------- | ----: |
| Létrehozandó termék    | 1 884 |
| Frissítendő termék     |     0 |
| Változatlan termék     |     0 |
| Létrehozandó kategória |   219 |
| Frissítendő kategória  |     0 |
| Validációs hiba        |     0 |
| Figyelmeztetés         | 1 204 |

A jelenlegi riport nem számol külön változatlan kategóriát. Mivel az adatbázisban a dry run előtt nem volt Product/Variant és UNAS kategória external reference, minden katalógusrekord létrehozandóként jelent meg; ezért diff-mező szerinti UPDATE bontás (cím, kategória, brand, kép, aktív állapot, channel listing) mind 0.

## Adatminőségi megállapítások

Az összes 1 204 issue `WARNING / MISSING_BRAND / PRODUCT`. Hiba nem volt. 1 204 terméknél üres a brand, 680 terméknél 49 különböző brandnév található. Brands munkalap nem állt rendelkezésre, ezért a 49 név törzsadathoz illesztése még review-t igényel; a leggyakoribb forrásértékek többek között Fauna Marin (118), Aquaforest (87), Triton (67), D-D (29) és ATI (26).

- hiányzó SKU: 0;
- duplikált SKU: 0;
- hiányzó vagy feloldatlan elsődleges kategória: 0;
- alternatív kategóriával rendelkező termék: 5;
- érvénytelen kép URL: 0;
- kép nélküli termék: 84; képpel rendelkező: 1 800; maximum 10 kép/termék;
- parser-anomália: nem maradt ismert feloldatlan fejléc vagy kategóriaútvonal.

A nyers UNAS státuszértékek: `0`: 311, `1`: 1 515, `2`: 54, `3`: 4. Ezek üzleti jelentése nincs igazolva; a parser kizárólag `externalStatus` értékként őrzi őket, és nem képez belőlük `isActive` állapotot.

## Perzisztencia és idempotencia

Az adatbázisban 1 `VALIDATED` batch és 2 103 staging sor található: 1 884 Product és 219 Category, mind `VALID` státuszban, raw és parsed payloaddal. Az issue-k a terméksorokon és a batch riportban is megmaradtak. A riport végpontról visszaolvasható.

Az azonos összevont fájl második feltöltése ugyanazt a batch ID-t és tartalmilag azonos összesítést adta; a batch- és sorszám nem nőtt. Az idempotencia a provider + validált SHA-256 alapján működik. Dry run előtt és után: Product 0, ProductVariant 0, StockMovement 0.

## Importálhatósági következtetés

- Apply Import technikai blokkoló: az approval/apply állapotgép és executor még szándékosan nem létezik.
- Elfogadható első import figyelmeztetés: kép nélküli rekordok; a hiányzó brand csak jóváhagyott fallback szabállyal.
- Üzleti megerősítés szükséges: UNAS 0/1/2/3 státuszok jelentése, a 49 brandnév törzsadathoz illesztése és hiányzó brand policy.
- Javasolt technikai fejlesztés: kategória unchanged mérőszám, brand reference sheet vagy review mapping, apply előtti stale-batch ellenőrzés.

Az exportok, a teljes dry-run JSON és az ideiglenes munkafüzet nem kerülnek Gitbe.

## #0006.7 Brand Resolution újraellenőrzés

A teljes 1 884 termékes katalógus újra lefutott a `brand-resolution-engine-v2`,
`brand-resolution-config-v2`, `brand-resolution-report-v2` verziókkal. A korábbi
1 204 `MISSING_BRAND` warning megmaradt, és külön resolution outcome készült:

| Hiányzó explicit brand eredménye | Darab |
| -------------------------------- | ----: |
| RESOLVED                         |   333 |
| REVIEW_REQUIRED                  |   309 |
| UNRESOLVED                       |   562 |

Confidence: high 333, medium 309, low 0, none 562. Forrástalálatok: terméknév
637, elsődleges kategória 338, SKU-prefix 7, gyártói cikkszám-prefix 3,
alternatív kategória 1. A forrástalálatok nem kizárólagosak, egy termék több
evidence-et adhat.

Review okok: `NO_CANDIDATE` 562, `LOW_CONFIDENCE` 309,
`CLOSE_CANDIDATES` 2, `MULTIPLE_BRANDS_IN_NAME` 2, `SOURCE_CONFLICT` 2.
A leggyakoribb javaslatok: Maxspect 70, Modern Reef 62, Grotech 56,
Microbe-Lift 34, Ocean Nutrition 30, Jebao/Jecod 27, Arka 26, AquaMedic 25,
Fauna Marin 25 és Ecotech 24.

Az összes 1 884 terméket számítva 1 003 `RESOLVED`, 319 `REVIEW_REQUIRED` és
562 `UNRESOLVED`; ezért 881 egyedi `PENDING` review sor készült. Az explicit
branddel rendelkező termékek közül 10 konfliktusos/review eset magyarázza a
hiányzó-brand részhalmaz 871 és a teljes queue 881 darabja közötti különbséget.

A végleges batch: `cmrrx41c2000079wo92lr9clz`. Az azonos fájl ismételt futtatása
ugyanezt a batch-et és mélyen azonos summary/product resolution eredményt adta,
review duplikáció nélkül. Product 0, ProductVariant 0, Brand 5 és StockMovement 0
maradt a futtatás előtt és után.
