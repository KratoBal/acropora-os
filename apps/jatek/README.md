# @acropora/jatek

A karácsonyi nyereményjáték nyilvános oldala (jatek.acropora.hu). Külön kis Next app, saját Coolify-alkalmazás, a bolttól és az OS webjétől függetlenül. A játék adata és logikája az OS api `/jatek` alatti, bejelentkezés nélküli végpontjain van (a szerződés: `exchange/jatek/`, nautilus).

## Oldalak

- `/` a heti kérdés és a beküldő űrlap (e-mail-cím + válasz; botcsapda-mező; NINCS hírlevél-jelölőnégyzet)
- `/megerosites?token=...` a levélbeli link: a lap betöltésekor a böngésző megerősít (egy link-előnézet, ami nem fut JavaScriptet, nem erősít meg semmit)
- `/jatekszabalyzat`, `/adatkezeles`: VÁZLAT, `[KITÖLTENDŐ]` jelölésekkel (`src/lib/jogi-szovegek.ts`); a végleges szöveg a szervezőé

## Környezet (FUTÁSIDŐBEN; építéskor nem kell semmi)

| Változó                 | Mire                                                                                                                                                                                                                                                                                                       |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JATEK_API_URL`         | az OS api címe (teszten `https://api-staging.acropora.hu`). A jatek SZERVERE hívja, a böngésző nem.                                                                                                                                                                                                        |
| `JATEK_ALLOW_FAKE=true` | CSAK addig, amíg az api nincs kint: a hamis (próba) api indulhat éles módban is. `JATEK_API_URL` nélkül, ezen kapcsoló nélkül a `NODE_ENV=production` indulás hiba.                                                                                                                                        |
| `JATEK_PROXY_SECRET`    | közös titok az api-val (acrobot állítja be mindkét app env-jébe). A szerver ezzel hitelesíti a látogató IP-jét (`X-Jatek-Client-IP`, `X-Jatek-Proxy-Secret`); nélküle az api az utolsó proxy-hopra kulcsol, és minden látogató egy közös sebességkeretbe esik. Soha nem kerül a böngészőbe vagy a naplóba. |
| `JATEK_INDEXABLE=true`  | a keresők indexelhetik az oldalt. Alapból NEM (teszt).                                                                                                                                                                                                                                                     |

A megerősítő levél linkjét az api állítja össze (`JATEK_PUBLIC_URL` az api környezetében).

## Kinézet

A kinézet cserélhető: `src/app/theme.css` (változók) és `src/app/jatek.css` (osztályok). A komponensek csak a `jatek-*` osztályneveket ismerik.

## Futtatás helyben

```bash
cd apps/jatek && pnpm dev          # http://localhost:3003, JATEK_API_URL nélkül a hamis api
cd apps/jatek && pnpm test         # típusellenőrzés a teszt-fordítással + node --test
```

Hamis api tokenek: `proba-token-ervenyes`, `proba-token-mar`, `proba-token-lezart` (minden más: érvénytelen).
