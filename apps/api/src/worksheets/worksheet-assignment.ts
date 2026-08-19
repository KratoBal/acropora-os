import {
  hasPermission,
  PERMISSIONS,
  USER_ROLES,
  type UserRole,
} from "@acropora/types";

/**
 * Kit lehet felelősnek kiosztani.
 *
 * A szabály nem a szerepkörök felsorolása, hanem a jogosultságból számolt
 * következmény: felelős az lehet, aki a munkalapot írni is tudja. Egy
 * felsorolt lista némán elavulna, amint egy szerepkör megkapja vagy
 * elveszíti a `service.manage` jogot - a kiosztás pedig attól még
 * megtörténne, és a kolléga a lapot megnyitva nem tudná szerkeszteni.
 *
 * A `service.view` szándékosan kevés lenne: a VIEWER látja a lapot, de nem
 * ír rá, tehát felelősnek kiosztva néma zsákutcába kerülne.
 */
export const WORKSHEET_ASSIGNABLE_ROLES: readonly UserRole[] =
  USER_ROLES.filter((role) => hasPermission(role, PERMISSIONS.SERVICE_MANAGE));

/**
 * A beküldött felelős-lista rendbetétele: üres elemek el, ismétlődés
 * összevonva.
 *
 * Az ismétlődés nem elméleti: a felületen egy nevet kétszer kiválasztva a
 * kapcsolótábla egyedi kulcsa hibát dobna, pedig a szándék egyértelmű, és
 * az eredmény ugyanaz a lap.
 */
export function normalizeAssigneeIds(userIds: readonly string[]): string[] {
  return [...new Set(userIds.map((userId) => userId.trim()).filter(Boolean))];
}
