# Acropora OS Design System

## Cél

Az Acropora OS felülete gyorsan áttekinthető, visszafogott és sűrű információt is kényelmesen kezel. A vizuális nyelv a Shopify Admin, a Linear és a Stripe Dashboard termékszemléletét követi, kész admin sablon átvétele nélkül.

## Alapelvek

1. **A tartalom az első.** A dekoráció nem versenyezhet az üzleti adatokkal.
2. **Következetes hierarchia.** Egy oldalon egy elsődleges cím és legfeljebb egy elsődleges művelet legyen.
3. **Nyugodt felület.** Semleges paletta, finom keretek és csak funkcionális árnyékok használhatók.
4. **Állapot színnel és szöveggel.** A szín önmagában nem közvetíthet jelentést.
5. **Billentyűzet és képernyőolvasó.** Minden interaktív elemnek látható fókuszállapota és érthető neve van.

## Vizuális tokenek

### Színek

- Alapfelület: Slate 50
- Kártya és lebegő felület: fehér
- Elsődleges szöveg: Slate 950
- Másodlagos szöveg: Slate 500–600
- Márka és fókusz: Teal 700 / Teal 500
- Siker: Emerald
- Figyelmeztetés: Amber
- Hiba vagy sürgős állapot: Rose
- Információ: Sky

### Térköz és forma

- Alaprács: 4 px
- Mező- és gombmagasság: 36 px; nagy méretben 44 px
- Kártya belső térköz: 20 px
- Alap lekerekítés: 8 px; kártyán 12 px
- Oldalsáv szélessége: 256 px
- Felső sáv magassága: 64 px

### Tipográfia

- Betűcsalád: Inter, rendszer-betűtípus tartalékkal
- Oldalcím: 24 px, félkövér
- Szekciócím: 14–16 px, félkövér
- Törzsszöveg: 14 px
- Metaadat és címke: 10–12 px
- Számadatokhoz tabuláris számjegyek használata ajánlott.

## Komponensek

A támogatott alapkomponensek a `packages/ui` csomagból importálhatók:

- `Button`: elsődleges, másodlagos, szellemgomb és veszélyes változat
- `Card`, `CardHeader`, `CardContent`: csoportosított információk
- `Badge`: rövid, szöveges állapotjelző
- `Input`: egysoros adatbevitel opcionális vezető ikonnal
- `Avatar`: személy vagy rendszer identitása
- `PageHeader`: oldalcím, leírás és műveletek
- `StatCard`: kiemelt mérőszám és változás
- `EmptyState`: még üres vagy előkészített tartalmi terület
- `Sidebar`, `NavItem`: elsődleges alkalmazásnavigáció
- `Topbar`: globális keresés és felhasználói műveletek
- `Icon`: egységes, vonalas ikonrendszer

Minden komponens támogatja a `className` tulajdonságot. Az alkalmazások a komponensek publikus tulajdonságain keresztül alakíthatják az elrendezést; belső implementációt nem importálhatnak.

## Használati szabályok

- Új, újrafelhasználható UI-elem először a `packages/ui` csomagban készüljön el.
- Üzleti adat, útvonalkezelés és jogosultságvizsgálat nem kerülhet a UI-csomagba.
- Alkalmazásszinten Tailwind használható oldalelrendezéshez és üzleti tartalom kompozíciójához.
- Egyedi színérték helyett a dokumentált szemantikus palettát kell használni.
- Üres modulhoz `PageHeader` és `EmptyState` használandó.

## Reszponzív viselkedés

- `lg` törésponttól az oldalsáv állandóan látható.
- Kisebb képernyőn az oldalsáv rétegként nyílik meg.
- A statisztikák egy, két, majd négy oszlopba rendeződnek.
- Táblázatos vagy hosszú tartalom saját vízszintes görgetési területet kap.
