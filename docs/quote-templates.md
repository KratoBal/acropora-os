# Ajánlatsablonok

Balázs 2026-10-08: „Sablon semmi” (a stage-en nem volt sablon, és nem volt hol
felvenni). Figma: 35 · OS / Offers / Templates (`579:2243`) és Template Editor
(`579:2562`).

## Végpontok

| Végpont                             | Jogosultság                                    |
| ----------------------------------- | ---------------------------------------------- |
| `GET /quote-templates`              | `quotes.manage` vagy `quotes.templates.manage` |
| `POST /quote-templates`             | `quotes.templates.manage`                      |
| `PATCH /quote-templates/:id`        | `quotes.templates.manage`                      |
| `POST /quote-templates/:id/archive` | `quotes.templates.manage`                      |

A `GET` a teljes sablont adja (blokkok, ütemezés), `?includeArchived=true`
mellett az archiváltakat is; az új ajánlat választója ugyanezt olvassa. A
blokkok és az ütemezés JSON a `QuoteTemplate` során (C3: nincs külön
sablonblokk-tábla), és a szerkesztő szabályaival ellenőrzött
(`templateInput`): szöveges blokk szöveg nélkül, kép, és 100%-tól eltérő
ütemezés 400. Archivált sablon nem módosítható (409), és nem törlődik.

## Az alapsablonok

A Figma Templates keretének négy sablonja (`quote-template-defaults.ts`):
Komplett akvárium kivitelezés, Technikai rendszer ajánlat, Szerviz /
fejlesztési ajánlat, English complete aquarium. A betöltés név szerint
idempotens: ami megvan (archiválva is), azt nem bántja.

```bash
# az api konténerben, az apps/api könyvtárból (ugyanígy fut, mint a unas-kezdo-ar-sorok.cli)
node dist/quotes/quote-templates-seed.cli.js           # terv, nem ír
node dist/quotes/quote-templates-seed.cli.js --apply   # felveszi a hiányzókat
```
