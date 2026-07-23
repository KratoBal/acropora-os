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
- klasszikus beszállítói bevételezés (Purchasing/GoodsReceipt) — nem indult el

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
