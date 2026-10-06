import type { Prisma } from "@acropora/database";
import {
  rolesWithPermission,
  USER_ROLES,
  type Permission,
  type UserRole,
} from "@acropora/types";

/**
 * KIK HORDOZNAK EGY JOGOT: AZ ADATBÁZIS-SZŰRŐ, EGY HELYEN (2026-10-06, a
 * felhasználónkénti eltérés előkészítése).
 *
 * A választók és a címzettlisták (szerviz hozzárendelés, akvárium-karbantartó,
 * üzenet-partnerek) eddig mind a saját `role IN (…)` feltételüket rakták össze.
 * Egy személyes eltérés mellett ez CSENDBEN rossz lenne: aki egyénileg megkapta
 * a jogot, kimaradna a listából, aki egyénileg elvesztette, benne maradna.
 * Hibát egyik sem ad, csak rossz embert a választóban.
 *
 * Ma a szűrő pontosan a régi: a szerepek, akiknek a sablonja hordozza a jogot.
 * Amikor az eltérések tárolva lesznek, EZ a függvény bővül (a sablon VAGY a
 * személyes megadás, és NEM a személyes elvétel), és minden hívó vele együtt.
 *
 * A `roles` szűkítés a hívóé: pl. a belső szerepekre (`INTERNAL_ROLES`), mert
 * a partner-fiók hatóköre nem jog-kérdés.
 */
export function usersWithPermissionWhere(
  permission: Permission,
  roles: readonly UserRole[] = USER_ROLES,
): Prisma.UserWhereInput {
  return { role: { in: rolesWithPermission(permission, roles) } };
}
