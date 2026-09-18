import type { PartnerScope } from "../auth/partner-scope.util.js";

/**
 * A REJTETT SOROK SZŰRŐJE -- EGY HELYEN, MIND A KÉT MODELLRE.
 *
 * Balázs kérése, 2026-09-18 08:01 UTC, szó szerint: "tunjenek el". A
 * próba-munkalapok és próba-hibajegyek kikerülnek a listákból, de megmaradnak.
 *
 * === MIÉRT KÖZÖS FÜGGVÉNY, HOLOTT KÉT TÁBLÁRÓL VAN SZÓ ===
 *
 * Nem a táblát írja le, hanem a DÖNTÉST: ki láthat rejtett sort. Az a döntés a
 * munkalapon és a hibajegyen ugyanaz, és két másolatban pontosan ott csúszna
 * szét, ahol a legdrágább -- a partner oldalán. A visszatérés alakja
 * szándékosan szerkezeti (`{ hiddenAt: null }`), így mind a két Prisma
 * `where`-be beköthető anélkül, hogy a modult bármelyik modellhez kötnénk.
 *
 * === A KAPCSOLÓ A HATÓKÖRÖN MÚLIK, NEM A HÍVÓN ===
 *
 * Az `includeHidden` kérés-paraméter, tehát a partner portálján is megadható.
 * Ha a hívó döntené el, a kapcsoló a partner-úton is hatna, és a próbasorok
 * pont ott jelennének meg, ahol a legrosszabb. Ezért a hatókör ELŐBB dönt: a
 * partner-ág a kapcsolót egyszerűen NEM veszi figyelembe -- nem hibázik, mert
 * nincs is mit közölnie, a rejtett sor a portálon soha nem értelmezett.
 *
 * Ugyanaz a szerkezet, amiért a `scopeWhereForAndBranch` is `AND` ágként megy
 * be: a jogosultsági döntés nem keveredhet egy szintre a felhasználóival.
 *
 * === AMIT SZÁNDÉKOSAN NEM FED ===
 *
 * NEM az EGYEDI lekérésre szól. Egy rejtett lap nem "nem létezik", csak nincs a
 * listában: a részletlap azonosítóval továbbra is elérhető, különben egy már
 * kiküldött hivatkozás 404-re futna attól, hogy valaki elrejtette a listában.
 */

/** A rejtettek kihagyása: a Prisma `where` egy ága. */
export const NOT_HIDDEN = { hiddenAt: null } as const;

/**
 * A SZŰRŐ ALAKJA `hiddenAt: null`, ÉS NEM TAGADÁS -- EZ NEM STÍLUS.
 *
 * A `NOT: { hiddenAt: { not: null } }` alak ugyanazt ígéri, és a Prisma a `NOT`
 * ágon az `IS NULL` sorokat elejtheti: a rejtés helyett MINDENT elrejtenénk, és
 * a hiba néma lenne (üres lista, nem hibaüzenet).
 */
export function hiddenRowsWhere(
  scope: PartnerScope,
  includeHidden: boolean | undefined,
): { hiddenAt?: null } {
  if (scope.kind !== "internal") return { ...NOT_HIDDEN };
  return includeHidden === true ? {} : { ...NOT_HIDDEN };
}

/**
 * KI REJTHET EL EGY SORT: CSAK A BELSŐ HATÓKÖR.
 *
 * KÜLÖN FÜGGVÉNY, HOLOTT UGYANAZT A MEZŐT NÉZI, MINT A SZŰRŐ. A kettő két
 * különböző kérdés, és a jövőben szétválhatnak: az OLVASÁSNÁL a partner
 * egyszerűen nem lát rejtett sort, az ÍRÁSNÁL a kérést el kell UTASÍTANI. Egy
 * közös függvény a két oldalt egy döntésbe kötné, és egy későbbi finomítás
 * (például: a partner lássa a sajátját) csendben átvinné az írásra is.
 *
 * A JOG (`SERVICE_MANAGE`) EZEN FELÜL KELL, nem helyette: az a kérdés, hogy
 * szabad-e szerkeszteni, ez pedig az, hogy melyik oldalról jött a kérés.
 */
export function mayHideRows(scope: PartnerScope): boolean {
  return scope.kind === "internal";
}
