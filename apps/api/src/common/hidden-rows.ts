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
 *
 * === A JOG 2026-09-18-AN KERULT A HATOKOR MELLE, ES KETTO KELL, NEM EGY ===
 *
 * Balazs eles hasznalat kozben irta, szo szerint (11:09 UTC): "megcsinaltam, de
 * a gomb ottmarad es megnyomhato barmelyik lapnal, jegynel. Azt szeretnem, hogy
 * csak admin jogos felhasznalonal jelenjen meg".
 *
 * A hatokor a PARTNERT zarja ki, a jog a SAJAT szerelo kollegainkat. A ketto
 * KULONBOZO kerdes, es egyik sem helyettesiti a masikat: a `SERVICE_MANAGE`
 * jogot a partner-fiokok is viselik, tehat jog-ellenorzes ONMAGABAN nem zarna
 * ki oket; a hatokor viszont a sajat SERVICE szerepunket engedi at.
 *
 * ES A KETTO EGY HELYEN TALALKOZIK (`mayHideRows`), nem ket kulon feltetelben:
 * ket helyen az egyik elobb-utobb kimarad, es a hiba NEMA -- a lista nem
 * hibazik, csak tobbet mutat.
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
  mayHide: boolean,
): { hiddenAt?: null } {
  if (!mayHideRows(scope, mayHide)) return { ...NOT_HIDDEN };
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
export function mayHideRows(scope: PartnerScope, mayHide: boolean): boolean {
  return scope.kind === "internal" && mayHide;
}
