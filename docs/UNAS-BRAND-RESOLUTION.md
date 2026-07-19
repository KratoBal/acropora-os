# UNAS Brand Resolution Engine

> A perzisztált kanonikus nevek és aliasok kezelését a [Brand master-data modul](./BRAND-MANAGEMENT.md) végzi. A szótár önmagában nem helyettesíti a Brand rekordot.

## Biztonsági határ

A motor kizárólag stagingadatot elemez és dry-run riportot készít. Nem hoz létre vagy módosít Brand, Product, ProductVariant, StockMovement vagy más domain rekordot. Nincs fuzzy/AI-alapú felismerés; ismeretlen értékből nem talál ki brandet.

## Szótár és normalizálás

A verziózott szótár a 2026-07-19-i export 49 különböző forrásnevét tartalmazza. A case-változatként előforduló `OASE` és `Oase` ugyanarra a kanonikus kulcsra kerül, ezért 48 kanonikus entry van. Egy entry kanonikus kulcsot/nevet, aliasokat, gyártói cikkszám-prefixeket és belső SKU-prefixeket tartalmaz. Az `AI`, `DD` és `KZ` kétértelmű rövid alias; önmagában nem eredményez automatikus döntést.

A normalizálás NFKD Unicode-felbontást, diakritika-eltávolítást, kisbetűsítést, írásjel/szimbólum szóközzé alakítást és whitespace-összevonást használ. Nem függ rendszerszintű locale-tól. Terméknévben csak teljes tokenfrázis vagy név eleji egyezés számít; részszó nem.

Új brand vagy szabály a `brand-dictionary.ts` központi konfigurációjába kerül, reprezentatív teszttel és új config verzióval. Szétszórt `if` ág nem megengedett.

## Resolverek és pontok

| Forrás                              | Pont |
| ----------------------------------- | ---: |
| Pontos explicit UNAS brand          |  100 |
| Gyártói cikkszám-prefix             |   82 |
| Belső SKU-prefix                    |   78 |
| Pontos elsődleges kategóriaszegmens |   58 |
| Pontos alternatív kategóriaszegmens |   42 |
| Branddel kezdődő terméknév          |   68 |
| Tokenhatáros brand a terméknévben   |   50 |

Az azonos brandet támogató evidence-ek összeadódnak, legfeljebb 100 pontig. A jelöltek csökkenő confidence, majd byte-szintű kanonikus kulcs szerint rendeződnek. Ez stabil tie-breaket ad.

## Döntés és konfliktus

- `RESOLVED`: legalább 75 pont, a második jelölthöz képest legalább 20 pontos előny és nincs blokkoló konfliktus.
- `REVIEW_REQUIRED`: 40–74 pont, szoros verseny, több forrás eltérő brandje, több brand a névben, kétértelmű alias vagy ismeretlen explicit brand.
- `UNRESOLVED`: nincs megalapozott jelölt.

Review okok: `UNKNOWN_EXPLICIT_BRAND`, `AMBIGUOUS_ALIAS`, `LOW_CONFIDENCE`, `CLOSE_CANDIDATES`, `SOURCE_CONFLICT`, `MULTIPLE_BRANDS_IN_NAME`, `NO_CANDIDATE`. Konfliktus esetén minden jelölt és evidence megmarad; a motor nem választ csendben.

## Evidence és review queue

Minden evidence tartalmazza a forrást, nyers és normalizált értéket, egyező mintát, pontot, indoklást, valamint opcionális mező- és kategóriaútvonalat. Az ismeretlen explicit brand és a fel nem ismert gyártói cikkszám is nulla pontos audit evidence-ként marad meg.

A `BrandResolutionReview` staging modell batch/sor szinten egyedi. SKU-t, terméknevet, javasolt brandet, confidence-t, review okokat, a teljes feloldási eredményt és resolver/config/schema verziót tárol. A queue státusza jelenleg csak `PENDING`; accept/reject művelet és UI nincs.

A review sorok cseréje és a riport `VALIDATED` állapotba mentése egy tranzakció. Hiba esetén a korábbi review/riport állapot változatlan marad.

## Riport és idempotencia

Az opcionális `brandResolution` mező miatt a korábbi riportmezők kompatibilisek maradnak; az új riport `unas-import-report-v2`. Tartalmazza a hiányzó explicit brandek döntési, confidence-, forrás-, konfliktus- és top-brand bontását, valamint minden termék részletes eredményét.

Az idempotencia kulcsa provider + fájl SHA-256 + config verzió. Azonos bemenet és verzió ugyanazt a batch-et/riportot adja, nem duplikál review sort. Szabályváltozáskor növelni kell a config verziót: új audit batch készül, a korábbi immutable eredmény megmarad.

Aktuális verziók: `brand-resolution-engine-v2`, `brand-resolution-config-v2`, `brand-resolution-report-v2`.

## Adatvédelem

Csak katalógusadatot dolgozunk fel. Export XLSX, teljes riport JSON és személyes adat nem kerül Gitbe. A customer export nem része ennek a pipeline-nak.
