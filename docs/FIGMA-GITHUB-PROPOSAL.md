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
| AI backend | `KratoBal/acropora-ai` | jelenleg nincs Figma ownership |

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

## Dashboard

```text
Figma:
10 · OS / Dashboard

Repo:
acropora-os

App:
apps/web
```

A mapping tartalmazza a dashboard route-ot és a dashboard komponensmappát.

## Products

```text
Figma:
20 · OS / Products

Repo:
acropora-os

App:
apps/web

Route:
products/**
```

Ide tartozik a JEV Product Intelligence is.

## Purchasing

```text
Figma:
30 · OS / Purchasing

Route:
beszerzes/**
```

## Invoicing

```text
Figma:
40 · OS / Invoicing
```

Elsődleges code területek:

```text
penzugy/szamlazas/**
penzugy/hianyzo-szamlak/**
```

Az invoice email editor is ehhez a domainhez tartozik.

## Webshop Operations

```text
Figma:
50 · OS / Webshop Operations

Route:
webshop/**
webshop/rendelesek/**
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
```

## Service

```text
Figma:
70 · OS / Service

Route:
szerviz/**
```

Ide tartoznak többek között:

```text
hibajegyek/**
munkalapok/**
anyagigenyek/**
eszkozok/**
karbantartas/**
piszkozatok/**
```

A mapping ezen belül screen/section szinten legyen részletes.

## Livestock & Aquariums

```text
Figma:
75 · OS / Livestock & Aquariums
```

Jelenleg már létező code terület:

```text
akvariumok/**
```

Ide került a most elkészült **Elhullási napló** is.

Az Elhullási napló mappingjénél a konkrét code path addig legyen:

```text
nincs
```

amíg a fejlesztés ténylegesen ki nem alakítja.

## Internal Tools

```text
Figma:
80 · OS / Internal Tools
```

Jelenlegi első terület:

```text
uzenetek/**
```

## Settings

```text
Figma:
90 · OS / Settings
```

Kapcsolódó code:

```text
beallitasok/**
admin/integrations/**
```

Például:

```text
beallitasok/levelsablonok
```

közvetlenül kapcsolható a Figma levélsablon-tervekhez.

---

# 6. Mobile mapping

A mobil továbbra is az `acropora-os` része.

```text
apps/mobile
```

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
```

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

Itt már több konkrét route is létezik, ezért különösen jó jelölt részletes Figma–code mappingre.

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

A webshop tranzakciós levelei **az OS-ben élnek**, és a Commerce az OS mail renderert használja.

Javaslat:

```text
Commerce / Edge States
→ acropora-commerce

Transactional Email
→ acropora-os
→ Settings
→ beallitasok/levelsablonok
```

A Figmában ezt később ennek megfelelően átrendezzük.

---

# 11. A Figma-map minden létező UI területet tartalmazzon

Ne csak azokat a modulokat írjuk bele, amelyekhez már van Figma terv.

Minden meglévő fő UI-terület kapjon mapping sort.

Ha nincs hozzá Figma:

```text
Figma:
nincs
```

Például külön is fel kell venni:

```text
partnerek
vevok
raktar
keszlet-egyeztetes
keszlet-kimenosor
tartalom
kalkulatorok
ai-teszt
```

Így az AI agent nem következtet tévesen arra, hogy egy funkció nem létezik csak azért, mert a design mapben nincs sora.

---

# 12. PR workflow

Az `acropora-os` meglévő PR-template-je maradjon.

Csak egyetlen sort adnánk hozzá:

```md
**Figma node:** `<link vagy node-id>` / `nincs UI-változás`
```

Nem kell checkbox-rendszer.

A Commerce repo esetén külön el kell dönteni, hogy létrehozunk-e minimális PR-template-et.

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

A `figma-kor` skill konkrét módosítását az AI csapat kezelje.

---

# 14. Automatikus ellenőrzés

Első körben csak egy egyszerű lokális validator készüljön.

Feladata:

a `FIGMA-MAP.md`-ben szereplő code reference-ek létezésének ellenőrzése.

Például:

```text
route directory exists?
component directory exists?
design-system file exists?
```

Nem szükséges hozzá Figma API.

Első körben kézzel futtatható.

Ha beválik, később CI-ba tehető.

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

Ha ezt a tervet jóváhagyjuk, az első változtatás csak a következő lenne:

```text
1. acropora-os/docs/FIGMA-MAP.md

2. acropora-commerce/docs/FIGMA-MAP.md

3. acropora-os/docs/DESIGN-SYSTEM.md
   ↔ FIGMA-MAP.md kereszthivatkozás

4. acropora-os/.github/pull_request_template.md
   + egy soros Figma node mező

5. egyszerű FIGMA-MAP reference validator script
```

A Commerce PR-template kérdését külön lehet eldönteni.

Az agent skill módosítását az AI csapat végezné.

---

# 17. Kérés a csapathoz

Kérlek ezt tekintsétek **végleges implementáció előtti tervnek**, és elsősorban az alábbiakat ellenőrizzétek:

- van-e technikai tévedés a repo/app ownershipban;
- jó-e a `FIGMA-MAP.md` struktúrája;
- megfelelő-e a `route pattern + component area` granularitás;
- van-e olyan UI domain, amit kihagytunk;
- megfelelő-e az „utoljára egyeztetve: dátum + commit” modell;
- helyes-e a transactional email ownership;
- jó helyre kerül-e a validator;
- van-e olyan meglévő agent workflow vagy tooling, amivel ez ütközik;
- kell-e bármit módosítani, **mielőtt tényleges GitHub PR készül**.

**Ezen a ponton még ne implementáljatok semmit.**

Kérek:
- critique-ot,
- hibákat / hiányzó részeket,
- konkrét módosítási javaslatokat,
- és egy `APPROVE / APPROVE WITH CHANGES / REJECT` ajánlást.
