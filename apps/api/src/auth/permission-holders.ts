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
 * A szűrő: a sablonból kapja és nem vették el tőle, VAGY egyénileg megkapta
 * (`UserPermissionOverride`). Ugyanaz a szabály, mint a
 * `permissionsWithOverrides`-é, csak az adatbázis nyelvén.
 *
 * A `roles` szűkítés a hívóé: pl. a belső szerepekre (`INTERNAL_ROLES`), mert
 * a partner-fiók hatóköre nem jog-kérdés.
 */
export function usersWithPermissionWhere(
  permission: Permission,
  roles: readonly UserRole[] = USER_ROLES,
): Prisma.UserWhereInput {
  /*
    `AND`-BE CSOMAGOLVA, és ez nem díszítés: a hívók a saját feltételeik közé
    terítik (`...usersWithPermissionWhere(...)`), és az üzenet-partnerek
    keresője saját `OR`-t ad a névre. Egy felső szintű `OR` itt azt csendben
    felülírná, és a választó vagy mindenkit, vagy rossz embereket adna.
  */
  return {
    AND: [
      { role: { in: [...roles] } },
      {
        OR: [
          // a sablonból kapja, és nem vették el tőle
          {
            role: { in: rolesWithPermission(permission, roles) },
            permissionOverrides: { none: { permission, effect: "REVOKE" } },
          },
          // egyénileg megkapta
          { permissionOverrides: { some: { permission, effect: "GRANT" } } },
        ],
      },
    ],
  };
}
