# Acropora OS – ütemterv

> Állapot 2026-07-23-án. Részletes, aktuális modul-szintű állapotért lásd
> [docs/CURRENT_STATUS.md](docs/CURRENT_STATUS.md).

## #0001 – Repository Foundation — elkészült

- pnpm/Turborepo monorepo
- Next.js webalkalmazás és NestJS API
- megosztott UI-, adatbázis-, konfiguráció- és típuscsomagok
- helyi PostgreSQL és Redis infrastruktúra

## #0002 – Identity & Access — elkészült

- felhasználók, szerepkörök és munkamenetek
- naplózható bejelentkezés és jogosultságkezelés (jelenleg development mock
  login, lásd [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md))
- admin felhasználókezelés (`/admin/users`)

## #0003 – Product & Inventory Core — részben elkészült

- terméktörzs (UNAS mirror + Product Extension) ✅
- raktárak és Leltár/készlet-egyeztetés modul ✅
- Beszerzés – EU-s és belföldi (kézi + NAV-lekérdezéses) beérkezett számla
  rögzítése (`/beszerzes`) ✅ (részletek lent, #0003b)

## #0003b – Beszerzés / EU-s és belföldi (NAV) számla rögzítés — elkészült

- `Supplier` törzs bővítve adószám/ország/elérhetőség mezőkkel ✅, valamint
  bankszámla-adatokkal (EU-s beszállítónál IBAN + SWIFT, belföldinél
  bankszámlaszám), ügyintéző (név/telefon/e-mail) és cím (irányítószám,
  város, utca/házszám, cím kiegészítés, irányítószám → város automatikus
  kitöltéssel) mezőkkel ✅; az ország az adószámból automatikusan
  meghatározott, EU-s adószám a hivatalos VIES REST szolgáltatással
  ellenőrizhető ✅
- Partnerek menüpont (`/partnerek`): kereshető/szűrhető beszállítói lista,
  létrehozás és szerkesztés (optimista konkurrenciakezeléssel) ✅
- `PurchaseInvoice`/`PurchaseInvoiceLine` séma: a valós üzleti folyamatot
  követi (nincs külön előzetes rendelés-jóváhagyás, a beérkezett számla maga
  a bevételezés) ✅
- MNB hivatalos árfolyam automatikus lekérdezése a számla kelte alapján ✅
  (a kliens implementálva, de az MNB oldalának bot-védelme élesben jelenleg
  blokkolja - lásd CURRENT_STATUS.md; addig kézi árfolyam megadása az elsődleges út)
- EU-s beszállítói számla kézi rögzítése tételes bevételezéssel, `StockItem`
  és UNAS `setStock` frissítéssel ✅
- terméktörzsben nem szereplő tétel is felvehető a számlára (kézi
  megnevezéssel), UNAS/készlet-szinkron nélkül ✅
- Belföldi számlarögzítés: kézi (HUF + ÁFA-kulcs) és NAV Online Számla
  lekérdezés-alapú bevételezés ("NAV számla lekérés" menüpont, digest +
  teljes adat lekérdezés, kézi és időszakos szinkron) ✅ - a NAV-tételek
  soronkénti terméktörzs-egyeztetése (formális variant-hozzárendelés,
  nem csak átnevezés) még nem indult el

## #0004 – External Integrations — részben elkészült

- UNAS termékszinkron ✅ (M2.1)
- UNAS connection settings ✅ (M2.2)
- UNAS webshop rendelésszinkron ✅
- UNAS vevő-szinkron ✅
- NAV Online Számla adószám-lekérdezés ✅ (nem számlázás, cégadat-lookup)
- Számlázz.hu számlázási folyamat — nem indult el

## #0004b – Vevők / CRM — alap elkészült

- Vevő és Vevő cím modul, UNAS-forrás vs. kézi felvitel megkülönböztetés ✅
- kapcsolattartó, jegyzet, címke, timeline — nincs elkészítve (lásd
  [backlog/domain-follow-ups.md](backlog/domain-follow-ups.md))

## #0005 – Operations — nem indult el

- megfigyelhetőség, mentés-visszaállítás és élesítési folyamat

## Egyéb, ütemtervben eredetileg nem szerepelt, elkészült modulok

- POS (Point of Sale) (`/pos`)
