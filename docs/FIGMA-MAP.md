# Figma ↔ kód térkép

Ez a dokumentum az Acropora OS, Mobile és Partner Portal Figma-terveit köti a tényleges implementációhoz.

- **Figma = vizuális / UX source of truth**
- **GitHub = implementációs source of truth**
- Figma file: [Acropora design](https://www.figma.com/design/ji64fTFss0jqm5Uifd0zhE)
- Commerce counterpart: [KratoBal/acropora-commerce · docs/FIGMA-MAP.md](https://github.com/KratoBal/acropora-commerce/blob/main/docs/FIGMA-MAP.md)
- Kapcsolódó design-system dokumentum: [DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md)

## Útvonal-alapok

A táblákban szereplő route-ok és component-area értékek az alábbi base pathokhoz képest értendők.

| App | Route base | Component base |
|---|---|---|
| `apps/web` | `apps/web/src/app/(shell)/` | `apps/web/src/components/` |
| `apps/mobile` | `apps/mobile/src/app/` | `apps/mobile/src/components/` |
| `apps/partner` | `apps/partner/src/app/(portal)/` | `apps/partner/src/components/` |
| `packages/ui` | — | `packages/ui/src/` |

Jelölések:

- `nincs`: a design vagy az implementáció még nem létezik; ne találjunk ki hozzá útvonalat.
- `—`: nincs külön stabil route- vagy component-area mapping.
- `**`: a könyvtár alatti teljes route-terület.
- Több hivatkozás egy cellában `<br>` jellel van elválasztva; a validator mindet külön ellenőrzi.

## Karbantartási szabály

Ha egy PR egy itt feltérképezett UI-területet módosít, ugyanabban a PR-ben frissítse az érintett sor **Utoljára egyeztetve** mezőjét dátummal és azzal a commit SHA-val, amely ellen a Figma ↔ kód megfelelést ellenőrizték.

Szándékos design-eltérést a **Megjegyzés** mezőben kell dokumentálni. Kézzel karbantartott `implemented / partial / approved` státuszokat nem használunk.

## OS web

| Figma Page / Section | Node | App | Route pattern | Component area | Utoljára egyeztetve | Megjegyzés |
|---|---|---|---|---|---|---|
| Dashboard | [382:2](https://www.figma.com/design/ji64fTFss0jqm5Uifd0zhE?node-id=382-2) | `apps/web` | `page.tsx` | `dashboard/` | 2026-10-06 · 22bda49 | — |
| Products | [273:32](https://www.figma.com/design/ji64fTFss0jqm5Uifd0zhE?node-id=273-32) | `apps/web` | `products/**` | `products/`<br>`jev-product-intelligence/`<br>`brands/` | 2026-10-06 · 22bda49 | A JEV Product Intelligence is ehhez a domainhez tartozik. |
| Purchasing | [302:2](https://www.figma.com/design/ji64fTFss0jqm5Uifd0zhE?node-id=302-2) | `apps/web` | `beszerzes/**` | `purchasing/`<br>`suppliers/` | 2026-10-06 · 22bda49 | — |
| Invoicing | [316:1394](https://www.figma.com/design/ji64fTFss0jqm5Uifd0zhE?node-id=316-1394) | `apps/web` | `penzugy/szamlazas/**`<br>`penzugy/hianyzo-szamlak/**` | `billing/`<br>`finance/` | 2026-10-06 · 22bda49 | Az invoice email editor is itt él. |
| Webshop Operations | [493:2](https://www.figma.com/design/ji64fTFss0jqm5Uifd0zhE?node-id=493-2) | `apps/web` | `webshop/**` | `webshop/`<br>`webshop-orders/` | 2026-10-06 · 22bda49 | Internal fulfillment: rendelések, FOXPOST/GLS, címke, csomagkezelés. |
| POS | [434:2](https://www.figma.com/design/ji64fTFss0jqm5Uifd0zhE?node-id=434-2) | `apps/web` | `pos/**` | `pos/` | 2026-10-06 · 22bda49 | — |
| Service / Hibajegyek | [423:20](https://www.figma.com/design/ji64fTFss0jqm5Uifd0zhE?node-id=423-20) | `apps/web` | `szerviz/hibajegyek/**` | `service/` | 2026-10-06 · 22bda49 | Lista és részlet. |
| Service / Munkalapok | [423:448](https://www.figma.com/design/ji64fTFss0jqm5Uifd0zhE?node-id=423-448) | `apps/web` | `szerviz/munkalapok/**` | `service-jobs/`<br>`worksheets/` | 2026-10-06 · 22bda49 | — |
| Service / Anyagigény | [423:2](https://www.figma.com/design/ji64fTFss0jqm5Uifd0zhE?node-id=423-2) | `apps/web` | `szerviz/anyagigenyek/**` | `material-requests/` | 2026-10-06 · 22bda49 | A korábbi Anyagigény V2 a Service Page-be került. |
| Service / Eszközök | nincs | `apps/web` | `szerviz/eszkozok/**` | `service-assets/` | 2026-10-06 · 22bda49 | Jelenleg nincs külön aktuális Figma screen mapping. |
| Service / Karbantartás | nincs | `apps/web` | `szerviz/karbantartas/**` | `service/` | 2026-10-06 · 22bda49 | — |
| Service / Piszkozatok | [459:638](https://www.figma.com/design/ji64fTFss0jqm5Uifd0zhE?node-id=459-638) | `apps/web` | `szerviz/piszkozatok/**` | `service-drafts/` | 2026-10-06 · 22bda49 | — |
| Service / Szerződések | nincs | `apps/web` | `partnerek/szerzodesek/**` | `contracts/` | 2026-10-06 · 22bda49 | A Service domainhez kapcsolódó szerződéses UI. |
| Akváriumok | nincs | `apps/web` | `akvariumok/**` | `aquariums/` | 2026-10-06 · 22bda49 | A kód létezik, de nincs külön aktuális Figma screen mapping. |
| Elhullási napló | [535:2](https://www.figma.com/design/ji64fTFss0jqm5Uifd0zhE?node-id=535-2) | `apps/web` | `nincs` | `nincs` | 2026-10-06 · 22bda49 | Fejlesztés alatt: a review idején #1549 szerver-rész elkészült, web PR utána; a route és component area a web PR beolvadásakor kerül ide. |
| Messaging / Üzenetek | [441:2](https://www.figma.com/design/ji64fTFss0jqm5Uifd0zhE?node-id=441-2) | `apps/web` | `uzenetek/**` | `messages/` | 2026-10-06 · 22bda49 | — |
| Sutyerák | nincs | `apps/web` | `—` | `assistant/` | 2026-10-06 · 22bda49 | Közös assistant UI; külön képernyőmapping jelenleg nincs. |
| Settings | [527:414](https://www.figma.com/design/ji64fTFss0jqm5Uifd0zhE?node-id=527-414) | `apps/web` | `beallitasok/**`<br>`admin/integrations/**` | `settings/`<br>`integrations/` | 2026-10-06 · 22bda49 | A levélsablonok is itt vannak. |
| Admin / Brands | nincs | `apps/web` | `admin/brands/**` | `brands/` | 2026-10-06 · 22bda49 | — |
| Admin / Imports | nincs | `apps/web` | `admin/imports/**` | `imports/` | 2026-10-06 · 22bda49 | — |
| Admin / Users | nincs | `apps/web` | `admin/users/**` | `users/` | 2026-10-06 · 22bda49 | — |
| Feladataim | nincs | `apps/web` | `feladataim/page.tsx` | `—` | 2026-10-06 · 22bda49 | Létező UI-terület, jelenleg nincs Figma mapping. |
| Partnerek | nincs | `apps/web` | `partnerek/**` | `—` | 2026-10-06 · 22bda49 | — |
| Vevők | nincs | `apps/web` | `vevok/**` | `—` | 2026-10-06 · 22bda49 | — |
| Raktár | nincs | `apps/web` | `raktar/**` | `—` | 2026-10-06 · 22bda49 | — |
| Készletegyeztetés | nincs | `apps/web` | `keszlet-egyeztetes/page.tsx` | `—` | 2026-10-06 · 22bda49 | — |
| Készlet kimenősor | nincs | `apps/web` | `keszlet-kimenosor/page.tsx` | `—` | 2026-10-06 · 22bda49 | — |
| Tartalom | nincs | `apps/web` | `tartalom/**` | `—` | 2026-10-06 · 22bda49 | — |
| Kalkulátorok | nincs | `apps/web` | `kalkulatorok/page.tsx` | `—` | 2026-10-06 · 22bda49 | — |
| AI teszt | nincs | `apps/web` | `ai-teszt/page.tsx` | `—` | 2026-10-06 · 22bda49 | — |
| Pénzügy / Elszámolások | nincs | `apps/web` | `penzugy/elszamolasok/page.tsx`<br>`penzugy/(elszamolasok)/**` | `finance/` | 2026-10-06 · 22bda49 | FOXPOST/GLS/SimplePay elszámolások. |
| Gyűjtő route | nincs | `apps/web` | `[section]/page.tsx` | `—` | 2026-10-06 · 22bda49 | Generikus szekció-belépő. |

### Közös OS felületi elemek

| Figma Page / Section | Node | App | Route pattern | Component area | Utoljára egyeztetve | Megjegyzés |
|---|---|---|---|---|---|---|
| OS shared shell / building blocks | [273:31](https://www.figma.com/design/ji64fTFss0jqm5Uifd0zhE?node-id=273-31) | `apps/web` | `—` | `app-shell.tsx`<br>`navigation.ts`<br>`global-search.tsx`<br>`pilot/` | 2026-10-06 · 22bda49 | Több képernyő közös shell-, navigációs és UI-építőelemei. |

## Mobile

| Figma Page / Section | Node | App | Route pattern | Component area | Utoljára egyeztetve | Megjegyzés |
|---|---|---|---|---|---|---|
| Mobile / Home | [412:2](https://www.figma.com/design/ji64fTFss0jqm5Uifd0zhE?node-id=412-2) | `apps/mobile` | `index.tsx`<br>`modulok.tsx` | `—` | 2026-10-06 · 22bda49 | Role preset nyitóképernyők. |
| Mobile / Service | [560:6097](https://www.figma.com/design/ji64fTFss0jqm5Uifd0zhE?node-id=560-6097) | `apps/mobile` | `service-jobs/**`<br>`worksheets/**`<br>`service-drafts.tsx`<br>`assets/**` | `—` | 2026-10-06 · 22bda49 | Az assets a Mobile / Service domain része. |
| Mobile / Material Requests | [560:6106](https://www.figma.com/design/ji64fTFss0jqm5Uifd0zhE?node-id=560-6106) | `apps/mobile` | `material-requests/**` | `—` | 2026-10-06 · 22bda49 | — |
| Mobile / Messaging | [560:6108](https://www.figma.com/design/ji64fTFss0jqm5Uifd0zhE?node-id=560-6108) | `apps/mobile` | `uzenetek/**` | `—` | 2026-10-06 · 22bda49 | — |
| Mobile / Aquariums | nincs | `apps/mobile` | `aquariums/**` | `—` | 2026-10-06 · 22bda49 | Kód létezik, Figma-terv nincs feltérképezve. |
| Mobile / Orders | nincs | `apps/mobile` | `orders/**` | `—` | 2026-10-06 · 22bda49 | — |
| Mobile / Partners | nincs | `apps/mobile` | `partners/**` | `—` | 2026-10-06 · 22bda49 | — |
| Mobile / Settings | nincs | `apps/mobile` | `settings.tsx` | `—` | 2026-10-06 · 22bda49 | — |
| Mobile / Queue | nincs | `apps/mobile` | `queue.tsx`<br>`queue-fix/**`<br>`queue-resolve/**` | `—` | 2026-10-06 · 22bda49 | — |
| Mobile / Login | nincs | `apps/mobile` | `login.tsx` | `—` | 2026-10-06 · 22bda49 | — |

## Partner Portal

A Partner Portalhoz jelenleg nincs külön aktuális Figma képernyőkészlet. Ettől a funkciók léteznek, ezért explicit sorokat kapnak.

| Figma Page / Section | Node | App | Route pattern | Component area | Utoljára egyeztetve | Megjegyzés |
|---|---|---|---|---|---|---|
| Partner / Akváriumok | nincs | `apps/partner` | `akvariumok/**` | `—` | 2026-10-06 · 22bda49 | — |
| Partner / Eszközök | nincs | `apps/partner` | `eszkozok/**` | `—` | 2026-10-06 · 22bda49 | — |
| Partner / Hibajegyek | nincs | `apps/partner` | `hibajegyek/**` | `—` | 2026-10-06 · 22bda49 | — |
| Partner / Munkalapok | nincs | `apps/partner` | `munkalapok/**` | `—` | 2026-10-06 · 22bda49 | — |
| Partner / Megrendelések | nincs | `apps/partner` | `megrendelesek/**` | `—` | 2026-10-06 · 22bda49 | — |
| Partner / Teljesítési igazolások | nincs | `apps/partner` | `teljesitesi-igazolasok/**` | `—` | 2026-10-06 · 22bda49 | — |
| Partner / Beállítások | nincs | `apps/partner` | `beallitasok/page.tsx` | `—` | 2026-10-06 · 22bda49 | — |
| Partner / Kalkulátorok | nincs | `apps/partner` | `kalkulatorok/page.tsx` | `—` | 2026-10-06 · 22bda49 | — |

## Design System

A Design System kivétel: itt a konkrét komponensfájl stabil és hasznos mapping.

| Figma Page / Section | Node | App | Route pattern | Component area | Utoljára egyeztetve | Megjegyzés |
|---|---|---|---|---|---|---|
| Foundations / theme | [4:58](https://www.figma.com/design/ji64fTFss0jqm5Uifd0zhE?node-id=4-58) | `packages/ui` | `—` | `figma-theme.css`<br>`theme.css` | 2026-10-06 · 22bda49 | OS theme és Figma token bridge. |
| Button | [273:31](https://www.figma.com/design/ji64fTFss0jqm5Uifd0zhE?node-id=273-31) | `packages/ui` | `—` | `button.tsx` | 2026-10-06 · 22bda49 | — |
| Badge | [273:31](https://www.figma.com/design/ji64fTFss0jqm5Uifd0zhE?node-id=273-31) | `packages/ui` | `—` | `badge.tsx` | 2026-10-06 · 22bda49 | — |
| Card | [273:31](https://www.figma.com/design/ji64fTFss0jqm5Uifd0zhE?node-id=273-31) | `packages/ui` | `—` | `card.tsx` | 2026-10-06 · 22bda49 | — |
| Input | [273:31](https://www.figma.com/design/ji64fTFss0jqm5Uifd0zhE?node-id=273-31) | `packages/ui` | `—` | `input.tsx` | 2026-10-06 · 22bda49 | — |
| Select | [273:31](https://www.figma.com/design/ji64fTFss0jqm5Uifd0zhE?node-id=273-31) | `packages/ui` | `—` | `select.tsx` | 2026-10-06 · 22bda49 | — |
| Textarea | [273:31](https://www.figma.com/design/ji64fTFss0jqm5Uifd0zhE?node-id=273-31) | `packages/ui` | `—` | `textarea.tsx` | 2026-10-06 · 22bda49 | — |
| Alert | [273:31](https://www.figma.com/design/ji64fTFss0jqm5Uifd0zhE?node-id=273-31) | `packages/ui` | `—` | `alert.tsx` | 2026-10-06 · 22bda49 | — |
| Nav Item | [273:31](https://www.figma.com/design/ji64fTFss0jqm5Uifd0zhE?node-id=273-31) | `packages/ui` | `—` | `nav-item.tsx` | 2026-10-06 · 22bda49 | — |
| Page Header | [273:31](https://www.figma.com/design/ji64fTFss0jqm5Uifd0zhE?node-id=273-31) | `packages/ui` | `—` | `page-header.tsx` | 2026-10-06 · 22bda49 | — |
| Pagination | [273:31](https://www.figma.com/design/ji64fTFss0jqm5Uifd0zhE?node-id=273-31) | `packages/ui` | `—` | `pagination.tsx` | 2026-10-06 · 22bda49 | — |
| Sidebar | [273:31](https://www.figma.com/design/ji64fTFss0jqm5Uifd0zhE?node-id=273-31) | `packages/ui` | `—` | `sidebar.tsx` | 2026-10-06 · 22bda49 | — |
| Empty State | [273:31](https://www.figma.com/design/ji64fTFss0jqm5Uifd0zhE?node-id=273-31) | `packages/ui` | `—` | `empty-state.tsx` | 2026-10-06 · 22bda49 | — |
| Stat Card | [273:31](https://www.figma.com/design/ji64fTFss0jqm5Uifd0zhE?node-id=273-31) | `packages/ui` | `—` | `stat-card.tsx` | 2026-10-06 · 22bda49 | — |

## Tranzakciós webshop-levelek

A **célállapotban** a webshop levélsablonjainak design- és template-ownere az OS:

`acropora-os → beallitasok/levelsablonok`.

A Commerce csak akkor rendereltet az OS-sel, ha `ACROPORA_WEBSHOP_MAIL_RENDERER=os`. Amíg ez nincs bekapcsolva, a Commerce-ben átmenetileg saját fallback szöveg is él (például `apps/backend/src/subscribers/order-placed-mail.ts`).

Ezért:
- a tranzakciós email **design ownership** az OS-é;
- a Commerce fallback implementáció átmeneti technikai állapot;
- a Figma email frame-eket később az OS / Settings területhez kell rendezni.

## Ellenőrzés

A mapping lokális ellenőrzése:

```bash
node scripts/figma-map-check.mjs
```

A validator csak azt ellenőrzi, hogy a dokumentált route-, component- és design-system hivatkozások léteznek-e a repóban. Figma API-t nem használ.
