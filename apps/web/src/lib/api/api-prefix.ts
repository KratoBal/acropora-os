/**
 * A böngészőből induló hívások előtagja, EGY helyen.
 *
 * MÉRVE 2026-08-28: ez a szó tizenkét helyen állt kiírva a webes forrásban --
 * a wrapperben, tizenegy hívási helyen, és a `next.config.ts` átirányításában,
 * ami egyáltalán jelentést ad neki. A tizenegyből hat nem is `fetch` hívás
 * volt, ezért az első számolásom kilencet talált: két `XMLHttpRequest` hívás
 * kimaradt belőle.
 *
 * AMI SZÁNDÉKOSAN NEM VÁLTOZIK, és ezért itt áll kiírva, nem a PR-ben: a
 * hívások egy része KIKERÜLI az `apiRequest` wrappert, és ez mind indokolt.
 *
 * - `lib/auth/production-auth.ts` és `lib/auth/development-auth.ts`: a
 *   hitelesítési út saját hibakezelést és sütikezelést kíván, és nem a
 *   wrapper JSON-válasz feltevését.
 * - `assets.ts`, `foxpost-settlements.ts`, `inventory.ts` letöltései: BINÁRIS
 *   választ kapnak (xlsx, pdf), a wrapper viszont JSON-t vár.
 * - `imports.ts` és `inventory.ts` feltöltései: `XMLHttpRequest`, mert
 *   feltöltés-haladást jeleznek, amire a `fetch` nem ad eseményt.
 *
 * Ez a konstans tehát NEM azt készíti elő, hogy ezek behúzhatók legyenek a
 * wrapperbe. Ha valaki „konszolidálás" jegyében mégis behúzza őket, egy
 * hitelesítési út, egy bináris letöltés vagy egy haladásjelző romlik el.
 *
 * ÉS AMIT EZ NEM OLD MEG: az útvonal-előtagokat (`/brands`, `/service/...`),
 * amiket a kliensek szintén kiírnak. Az másik kérdés, másik nagyságrend
 * (113 híváspont, 18 fájl), és az őrző webre terjesztése AZON múlik, nem ezen.
 */
export const API_PREFIX = "/api";
