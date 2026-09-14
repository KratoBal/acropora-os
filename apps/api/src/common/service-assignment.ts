import {
  hasPermission,
  PERMISSIONS,
  USER_ROLES,
  type UserRole,
} from "@acropora/types";

/**
 * Kit lehet szerviz-munkára kiosztani: munkalap FELELŐSNEK vagy hibajegyre
 * DELEGÁLTNAK.
 *
 * A szabály nem a szerepkörök felsorolása, hanem a jogosultságból számolt
 * következmény: kiosztható az, aki a szerviz-munkát kezelni is tudja. Egy
 * felsorolt lista némán elavulna, amint egy szerepkör megkapja vagy elveszíti
 * a `service.manage` jogot -- a kiosztás pedig attól még megtörténne, és a
 * kolléga a lapot vagy a jegyet megnyitva nem tudna vele mit kezdeni.
 *
 * A `service.view` szándékosan kevés lenne: a VIEWER LÁTJA a munkát, de nem ír
 * rá, tehát kiosztva néma zsákutcába kerülne.
 *
 * === MIÉRT A KÖZÖS MAPPÁBAN ÁLL, ÉS NEM KÉTSZER ===
 *
 * Ez a szabály 2026-09-14-ig a `worksheets/worksheet-assignment.ts` fájlban
 * élt, munkalap-néven. A hibajegy-delegálás UGYANEZT a kérdést teszi fel,
 * ugyanabból az okból, és a két modul közt ma nincs import.
 *
 * Két rossz út volt, és mind a kettő csendben romlik el:
 *
 *   a szabály MÁSOLÁSA        a két másolat elcsúszik, amint az egyik oldal
 *                             feltétele változik -- és a különbség nem hibázik,
 *                             csak mást enged
 *   a hibajegy IMPORTÁLNÁ     a jegy a munkalap belső szabályától függene,
 *   a munkalap fájljából      holott a kettő egyenrangú
 *
 * Ezért a szabály ide költözött, a `worksheet-under-ticket.ts` mellé, ami már
 * ma is azért áll itt, mert mindkét oldal olvassa. A munkalap-oldali NÉV
 * (`WORKSHEET_ASSIGNABLE_ROLES`) megmaradt, ugyanarra az értékre mutatva, hogy
 * a meglévő hívók és az őrzőjük változatlanul álljanak.
 */
export const SERVICE_ASSIGNABLE_ROLES: readonly UserRole[] = USER_ROLES.filter(
  (role) => hasPermission(role, PERMISSIONS.SERVICE_MANAGE),
);

/**
 * A beküldött kiosztás-lista rendbetétele: üres elemek el, ismétlődés
 * összevonva.
 *
 * Az ismétlődés nem elméleti: a felületen egy nevet kétszer kiválasztva a
 * kapcsolótábla egyedi kulcsa hibát dobna, pedig a szándék egyértelmű, és az
 * eredmény ugyanaz a lap vagy jegy.
 */
export function normalizeAssigneeIds(userIds: readonly string[]): string[] {
  return [...new Set(userIds.map((userId) => userId.trim()).filter(Boolean))];
}
