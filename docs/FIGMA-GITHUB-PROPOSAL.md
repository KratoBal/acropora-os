# Végleges javaslat véleményezésre
## Figma ↔ GitHub design-to-code kapcsolat az Acropora rendszereknél

**Állapot:** javaslat, még semmilyen végleges GitHub-módosítást nem kérünk.  
**Cél:** a Figma-tervek és a tényleges implementáció között legyen egy egyszerű, AI-agentek számára is megbízható kapcsolat, automatikus Figma-export vagy kétirányú szinkron nélkül.

## Alapelv

**Figma = vizuális és UX source of truth**  
**GitHub = implementációs source of truth**

A kettő között rövid, kézzel karbantartott mapping legyen.

---

# 1. Repository ownership

A design ownershipot a tényleges alkalmazás alapján kezeljük.

| Figma-terület | Repo | App / code owner |
|---|---|---|
| Acropora OS web | `KratoBal/acropora-os` | `apps/web` |
| Acropora Mobile | `KratoBal/acropora-os` | `apps/mobile` |
| Partner Portal | `KratoBal/acropora-os` | `apps/partner` |
| OS Design System komponensek | `KratoBal/acropora-os` | `packages/ui` |
| Webshop / storefront | `KratoBal/acropora-commerce` | `apps/storefront` |
| AI-szolgáltatás | — | nincs felülete, nincs Figma-sora |

Az OS, mobil és partner egy repo alatt marad; a vásárló által látott webshop a Commerce repo tulajdona.

Fontos különbség:

**customer-facing shipping → acropora-commerce**

például:
- GLS pont választása checkoutban
- FOXPOST automata választása
- checkout shipping UX

**internal fulfillment → acropora-os**

például:
- rendeléskezelés
- címkenyomtatás
- csomagfeladás
- GLS/FOXPOST operáció az OS-ben

---

# 2. A mapping dokumentum helye

Nem hozunk létre új `docs/design/` struktúrát.

Javasolt fájlok:

```text
acropora-os/
  docs/
    DESIGN-SYSTEM.md
    FIGMA-MAP.md
```

és:

```text
acropora-commerce/
  docs/
    FIGMA-MAP.md
```

Az OS-ben a `FIGMA-MAP.md` a meglévő `DESIGN-SYSTEM.md` mellett legyen, és a két dokumentum hivatkozzon egymásra.

A Commerce saját `FIGMA-MAP.md`-et kap.

A két repo Figma-mapje az elején hivatkozzon egymásra, mert az agentek általában csak az aktuálisan klónozott repót látják.

---

# 3. Mit tartalmazzon egy mapping sor?

A mapping **ne csak route-ot mutasson**.

Az OS-ben sok `page.tsx` csak vékony belépési pont, a valódi UI a domain-specifikus komponensmappákban él. Ezért minden releváns Figma screenhez két kódbeli hivatkozás kell:

**route pattern + component directory**

A konkrét egyedi fájlig általában ne menjünk le, mert az túl könnyen elavul.

Javasolt szerkezet:

| Figma Page / Section | Node | App | Route pattern | Component area | Utoljára egyeztetve | Megjegyzés |
|---|---|---|---|---|---|---|
| `70 · OS / Service / Hibajegyek` | Figma node | `apps/web` | `szerviz/hibajegyek/**` | kapcsolódó service komponensmappa | `2026-10-06 · <commit>` | — |
| `75 · OS / Livestock & Aquariums / Elhullási napló` | Figma node | `apps/web` | nincs | nincs | `2026-10-06 · <commit>` | még nincs implementálva |

Ha valami még nincs implementálva:

```text
route: nincs
component area: nincs
```

Ne találjunk ki előre olyan code pathot, ami még nem létezik.

---

# 4. Nem használunk kézzel karbantartott implementation státuszokat

Nem javasolt ilyen oszlopokat fenntartani:

```text
implemented
partial
design-ready
approved
```

Ezek idővel nagyon könnyen elavulnak.

Helyettük minden mappinghez legyen:

```text
Utoljára egyeztetve:
2026-10-06 · <Git commit SHA>
```

Ez megmutatja az agentnek, hogy a Figma–code kapcsolatot melyik kódállapotnál ellenőriztük utoljára.

A design aktuális státusza maradjon a Figmában.

### Ki és mikor frissíti?

Ha egy PR egy feltérképezett UI-területet módosít, akkor **ugyanabban a PR-ben** frissíteni kell az érintett Figma-map sor `Utoljára egyeztetve` mezőjét (dátum + commit).

A PR-sablon egy soros Figma-mezője erre emlékeztet. Így az egyeztetési dátum nem válik ugyanolyan könnyen elavult metaadattá, mint egy kézzel karbantartott státusz.

### Szándékos eltérés kezelése

A `differs-from-design` jellegű eltérést a **Megjegyzés** oszlopban dokumentáljuk.

Például:

```text
Szándékos eltérés:
az alkalmazás a domainben használt állapotneveket használja
a Figma mock szövege helyett.
```

Így az agent tudja, hogy nem feltétlenül bugról van szó.

---

# 5. Acropora OS mapping

A végleges `FIGMA-MAP.md` minden OS-területnél **route-mintát és komponens-területet is** tartalmazzon. A route önmagában nem elég, mert a `page.tsx` fájlok többnyire vékony belépési pontok; a tényleges UI a `apps/web/src/components/...` alatti domain-mappákban él.

| Figma | Route | Komponens-terület |
|---|---|---|
| `10 · OS / Dashboard` | `(shell)/page.tsx` | `dashboard/` |
| `20 · OS / Products` | `products/**` | `products/`, `jev-product-intelligence/`, `brands/` |
| `30 · OS / Purchasing` | `beszerzes/**` | `purchasing/`, `suppliers/` |
| `40 · OS / Invoicing` | `penzugy/szamlazas/**`, `penzugy/hianyzo-szamlak/**` | `billing/`, `finance/` |
| `50 · OS / Webshop Operations` | `webshop/**` | `webshop/`, `webshop-orders/` |
| `60 · OS / POS` | `pos/**` | `pos/` |
| `70 · OS / Service` | `szerviz/**` | `service/`, `service-jobs/`, `worksheets/`, `service-assets/`, `service-drafts/`, `material-requests/`, `contracts/` |
| `75 · OS / Livestock & Aquariums` | `akvariumok/**` | `aquariums/` |
| `80 · OS / Internal Tools` | `uzenetek/**` | `messages/`, `assistant/` (Sutyerák) |
| `90 · OS / Settings` | `beallitasok/**`, `admin/**` | `settings/`, `integrations/`, `users/`, `imports/` |

## Közös OS felületi elemek

A map külön közös sort / blokkot kapjon azoknak az elemeknek, amelyek nem egyetlen domainhez tartoznak:

```text
app-shell.tsx
navigation.ts
global-search.tsx
pilot/
```

Ezek több képernyőn közösen használt shell-, navigációs és UI-építőelemek, ezért az agentnek UI-munka előtt ezeket is ellenőriznie kell.

## Dashboard

```text
Figma:
10 · OS / Dashboard

Repo:
acropora-os

App:
apps/web

Route:
(shell)/page.tsx

Component area:
dashboard/
```

## Products

```text
Figma:
20 · OS / Products

Route:
products/**

Component area:
products/
jev-product-intelligence/
brands/
```

Ide tartozik a JEV Product Intelligence is.

## Purchasing

```text
Figma:
30 · OS / Purchasing

Route:
beszerzes/**

Component area:
purchasing/
suppliers/
```

## Invoicing

```text
Figma:
40 · OS / Invoicing

Route:
penzugy/szamlazas/**
penzugy/hianyzo-szamlak/**

Component area:
billing/
finance/
```

Az invoice email editor is ehhez a domainhez tartozik.

## Webshop Operations

```text
Figma:
50 · OS / Webshop Operations

Route:
webshop/**

Component area:
webshop/
webshop-orders/
```

Ide tartozik az **internal fulfillment** is:
- FOXPOST
- GLS
- címkék
- rendeléskezelési workflow

## POS

```text
Figma:
60 · OS / POS

Route:
pos/**

Component area:
pos/
```

## Service

```text
Figma:
70 · OS / Service

Route:
szerviz/**

Component area:
service/
service-jobs/
worksheets/
service-assets/
service-drafts/
material-requests/
contracts/
```

A mapping ezen belül screen/section szinten legyen részletes.

## Livestock & Aquariums

```text
Figma:
75 · OS / Livestock & Aquariums

Route:
akvariumok/**

Component area:
aquariums/
```

Az **Elhullási napló fejlesztés alatt van**: a szerver-rész a review mérés szerint a #1549-ben elkészült, de még nem volt beolvasztva; a webes rész ezután készül. A konkrét route- és component-area mező **a web PR beolvadásakor** kerüljön be a Figma-mapbe. Addig ne találjunk ki hozzá előre kódútvonalat.

## Internal Tools

```text
Figma:
80 · OS / Internal Tools

Route:
uzenetek/**

Component area:
messages/
assistant/   # Sutyerák
```

## Settings

```text
Figma:
90 · OS / Settings

Route:
beallitasok/**
admin/**

Component area:
settings/
integrations/
users/
imports/
```

A `beallitasok/levelsablonok` közvetlenül kapcsolható a Figma levélsablon-tervekhez.

---

# 6. Mobile mapping

A mobil továbbra is az `acropora-os` része:

```text
apps/mobile
```

A Figma-map ne csak a jelenleg megtervezett négy mobil területet sorolja, hanem **minden létező fő mobil route-területet**. Ha nincs hozzá Figma-terv, a Figma mező értéke legyen `nincs`.

## Mobile Home

```text
Figma:
10 · Mobile / Home

Code:
apps/mobile/src/app/index.tsx
apps/mobile/src/app/modulok.tsx
```

## Mobile Service

```text
Figma:
20 · Mobile / Service

Code területek:
service-jobs/**
worksheets/**
service-drafts
assets/**
```

Az `assets` a Mobile / Service domainhez tartozik.

## Material Requests

```text
Figma:
30 · Mobile / Material Requests

Code:
material-requests/**
```

## Messaging

```text
Figma:
40 · Mobile / Messaging

Code:
uzenetek/**
```

## További meglévő mobil területek

Ezek mind kapjanak sort a mapben; ahol nincs hozzájuk Figma-terv, `Figma: nincs` jelöléssel:

```text
aquariums/**
orders/**
partners/**
settings
queue
queue-fix/**
queue-resolve/**
```

Az agent így meg tudja különböztetni azt, hogy egy terület létezik, de még nincs hozzá Figma-terv, attól, hogy a terület egyszerűen kimaradt a mapből.

---

# 7. Partner Portal

A Partner Portal nem a mobil app része.

Owner:

```text
acropora-os/apps/partner
```

Ide tartozhatnak majd:
- Partner Service
- Partner Aquarist
- partner hibajegyek
- munkalapok
- akváriumok
- eszközök
- teljesítési igazolások

Ha ezekhez elkészül a Figma design, mindig `apps/partner` legyen az elsődleges code owner.

---

# 8. Design System mapping

Ez kiemelt terület.

A Figma:

```text
20 · Design System / OS Components
```

elsődleges kódbeli párja:

```text
acropora-os/packages/ui
```

A Design System kivétel az általános szabály alól: itt érdemes **konkrét komponensfájl-szintig** menni, mert ezek stabil elemek.

Például:

```text
Figma Button
↔ packages/ui/src/button.tsx

Figma Badge
↔ packages/ui/src/badge.tsx

Figma Card
↔ packages/ui/src/card.tsx

Figma Input
↔ packages/ui/src/input.tsx

Figma Select
↔ packages/ui/src/select.tsx

Figma Textarea
↔ packages/ui/src/textarea.tsx

Figma Nav Item
↔ packages/ui/src/nav-item.tsx

Figma Page Header
↔ packages/ui/src/page-header.tsx

Figma Pagination
↔ packages/ui/src/pagination.tsx
```

Később innen lehet továbbmenni Figma Code Connect felé, de **első körben nem vezetünk be Code Connectet**.

---

# 9. Commerce mapping

Owner:

```text
KratoBal/acropora-commerce
apps/storefront
```

## Home & Discovery

```text
Figma:
10 · Commerce / Home & Discovery

Code:
app/[countryCode]/(main)/page.tsx
modules/home/**
modules/kezdolap/**
```

A search/discovery részt külön kell pontosítani a végleges map elkészítésekor.

## Categories

```text
Figma:
20 · Commerce / Categories

Code:
app/[countryCode]/(main)/categories/[...category]/**
modules/categories/**
```

## Product Detail

```text
Figma:
30 · Commerce / Product Detail

Code:
app/[countryCode]/(main)/products/[handle]/**
modules/products/**
```

## Compare

```text
Figma:
35 · Commerce / Compare
```

Ha nincs egyértelmű implementáció:

```text
route: nincs
component area: nincs
```

Nem találunk ki előre ownershipot.

## Checkout

```text
Figma:
40 · Commerce / Checkout

Code:
cart/**
checkout/**
modules/cart/**
modules/checkout/**
```

## Shipping & Fulfillment

Itt kizárólag **customer-facing** shipping design legyen:

```text
Figma:
50 · Commerce / Shipping & Fulfillment

Code:
modules/shipping/**
```

GLS és FOXPOST checkout UX ide tartozik.

## Account & Auth

```text
Figma:
60 · Commerce / Account & Auth

Code:
account/**
modules/account/**
```

---

# 10. Tranzakciós emailek ownershipja

A **célállapotban** a webshop levélsablonjainak gazdája az OS:

```text
Transactional Email
→ acropora-os
→ Settings
→ beallitasok/levelsablonok
```

A Commerce az OS mail renderert akkor használja, ha:

```text
ACROPORA_WEBSHOP_MAIL_RENDERER=os
```

be van kapcsolva.

Ezért fontos különválasztani a célállapotot a jelenlegi működéstől: amíg ez a kapcsoló nincs OS-re állítva, a Commerce-ben **átmenetileg saját levélszöveg is él** (például `subscribers/order-placed-mail.ts`). A review mérés szerint a teszt boltban 2026-10-06-án az OS renderer még nem volt bekapcsolva.

Javasolt ownership:

```text
Commerce / Edge States
→ acropora-commerce

Transactional Email design / template ownership
→ acropora-os / beallitasok/levelsablonok

Commerce fallback mail implementation
→ átmeneti, amíg az OS renderer nincs aktív
```

A Figmában az email-designokat később ennek megfelelően kell az OS / Settings területhez rendezni.

---

# 11. A Figma-map minden létező UI területet tartalmazzon

Ne csak azokat a modulokat írjuk bele, amelyekhez már van Figma terv.

Minden meglévő fő UI-terület kapjon mapping sort.

Ha nincs hozzá Figma:

```text
Figma:
nincs
```

A jelenlegi audit alapján külön is fel kell venni legalább:

### Web

```text
partnerek
vevok
raktar
keszlet-egyeztetes
keszlet-kimenosor
tartalom
kalkulatorok
ai-teszt
feladataim
admin/brands
admin/imports
admin/users
[section]   # gyűjtő-route
```

### Mobile

```text
aquariums
assets          # Mobile / Service alá tartozik
orders
partners
settings
queue
queue-fix
queue-resolve
```

A lista célja nem az, hogy mindenből Figma-tervet követeljen, hanem hogy a map teljes legyen: ami létezik a kódban, de nincs hozzá Figma-terv, az explicit `Figma: nincs` jelölést kapjon.

Így az AI agent nem következtet tévesen arra, hogy egy funkció nem létezik csak azért, mert a design mapben nincs sora.

---

# 12. PR workflow

Az `acropora-os` meglévő PR-template-je maradjon.

Csak egyetlen sort adnánk hozzá:

```md
**Figma node:** `<link vagy node-id>` / `nincs UI-változás`
```

Nem kell checkbox-rendszer.

Az `acropora-commerce` is kapjon minimális PR-template-et ugyanezzel az egy sorral:

```md
**Figma node:** `<link vagy node-id>` / `nincs UI-változás`
```

Így a két repo workflow-ja nem tér el, és az agent Commerce UI-munkánál is ugyanazt az emlékeztetőt kapja.

---

# 13. AI-agent workflow

Az agent szabályait **nem a repository dokumentációba tesszük**.

A kívánt hely a flotta meglévő `figma-kor` skillje és az agentek saját szabályrendszere.

UI feladatnál a kívánt sorrend:

1. `FIGMA-MAP.md` ellenőrzése
2. releváns Figma node megnyitása
3. route és component area ellenőrzése
4. meglévő reusable UI komponensek keresése
5. csak utána implementáció

Különösen fontos:

**az agent ne hozzon létre új Button/Card/Input stb. komponenst, ha már van megfelelő elem a `packages/ui` vagy az adott storefront modul alatt.**

A `figma-kor` skill konkrét módosítását az AI csapat / Acrobot a Figma-map beolvadása után kezeli, hogy az öt lépés és a térkép helye egyszerre kerüljön be.

A skill frissítésekor külön át kell nézni a **régi, kb. 80 Page-es Figma-struktúrára mutató hivatkozásokat** is. A Figma Make-körök (zip, átültetés) ma ezen a skillen futnak, ezért régi Page-nevek nem maradhatnak benne észrevétlenül.

---

# 14. Automatikus ellenőrzés

Mindkét releváns repóban készüljön egy egyszerű lokális validator:

```text
scripts/figma-map-check.mjs
```

Feladata a `FIGMA-MAP.md`-ben szereplő code reference-ek létezésének ellenőrzése:

```text
route directory exists?
component directory exists?
design-system file exists?
```

Nem szükséges hozzá Figma API.

Két fontos szabályt kezeljen:

1. **Route group mappák:** a zárójeles csoportok tényleges könyvtárnevek a repóban, például `(shell)`, `(main)`, `(portal)`, `(checkout)`. A validator ezeket ne dobja el.
2. **`**` minta:** a glob nem azt jelenti, hogy minden fájlt külön ellenőrizni kell. Elég annak a könyvtárnak a létezését ellenőrizni, amelyre a minta mutat.

Első körben kézzel futtatható. Ha beválik, később CI-ba tehető.

---

# 15. Amit első körben NEM vezetünk be

Nem készül még:

- Figma API alapú szinkron
- automatikus design export
- kétirányú GitHub ↔ Figma update
- Figma Code Connect
- design-state CI
- screenshot comparison gate
- automatikus implementation-status
- `acropora-ai` design ownership

A rendszer első verziója szándékosan egyszerű:

**Figma node + GitHub map + meglévő kódstruktúra.**

---

# 16. Javasolt első implementációs csomag

Ha ezt a tervet jóváhagyjuk, az első változtatás csak a következő legyen:

```text
1. acropora-os/docs/FIGMA-MAP.md

2. acropora-commerce/docs/FIGMA-MAP.md

3. acropora-os/docs/DESIGN-SYSTEM.md
   ↔ FIGMA-MAP.md kereszthivatkozás

4. acropora-os/.github/pull_request_template.md
   + egy soros Figma node mező

5. acropora-commerce PR-template
   + ugyanaz az egy soros Figma node mező

6. acropora-os/scripts/figma-map-check.mjs

7. acropora-commerce/scripts/figma-map-check.mjs
```

A `figma-kor` skill módosítását az AI csapat / Acrobot a térképek beolvadása után végzi, beleértve a régi Figma Page-hivatkozások felülvizsgálatát is.

---

# 17. Kérés a csapathoz

Kérlek ezt tekintsétek **végleges implementáció előtti tervnek**, és elsősorban az alábbiakat ellenőrizzétek:

- van-e technikai tévedés a repo/app ownershipban;
- jó-e a `FIGMA-MAP.md` struktúrája;
- megfelelő-e a `route pattern + component area` granularitás;
- van-e olyan UI domain, amit kihagytunk;
- megfelelő-e az „utoljára egyeztetve: dátum + commit” modell;
- helyes-e a transactional email ownership;
- jó helyre kerül-e a `scripts/figma-map-check.mjs` validator mindkét repóban;
- helyesek-e a felsorolt komponens-területek;
- teljes-e a webes és mobil Figma nélküli területek listája;
- megfelelő-e az Elhullási napló fejlesztés-alatti megfogalmazása;
- megfelelően választjuk-e külön a levélsablon ownershipot és a Commerce fallback mail jelenlegi működését;
- van-e olyan meglévő agent workflow vagy tooling, amivel ez ütközik;
- kell-e bármit módosítani, **mielőtt tényleges GitHub PR készül**.

**Ezen a ponton még ne implementáljatok semmit.**

Kérek:
- critique-ot,
- hibákat / hiányzó részeket,
- konkrét módosítási javaslatokat,
- és egy `APPROVE / APPROVE WITH CHANGES / REJECT` ajánlást.
