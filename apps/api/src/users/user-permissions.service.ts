import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  isPermission,
  normalizePermissionOverrides,
  OWNER_GRANTED_PERMISSIONS,
  permissionOverrideChangeProblem,
  permissionsWithOverrides,
  ROLE_PERMISSIONS,
  type AuthenticatedUser,
  type PermissionOverride,
  type UserPermissionOverview,
} from "@acropora/types";

import {
  UserPermissionsRepository,
  type PermissionTargetRow,
} from "./user-permissions.repository.js";

export const USER_NOT_FOUND = "A felhasználó nem található.";

/** A tárolt sorokból az ismert jogúak (egy kivezetett jog sora kimarad). */
function storedOverrides(row: PermissionTargetRow): PermissionOverride[] {
  return row.permissionOverrides.flatMap((override) =>
    isPermission(override.permission)
      ? [{ permission: override.permission, effect: override.effect }]
      : [],
  );
}

function overview(row: PermissionTargetRow): UserPermissionOverview {
  const overrides = storedOverrides(row);
  return {
    userId: row.id,
    role: row.role,
    template: [...ROLE_PERMISSIONS[row.role]],
    overrides,
    effective: permissionsWithOverrides(row.role, overrides),
    ownerGranted: [...OWNER_GRANTED_PERMISSIONS],
  };
}

/**
 * FELHASZNÁLÓNKÉNTI JOG-ELTÉRÉSEK (Balázs döntése, 2026-10-06: szerepkör-sablon
 * + egyéni eltérés). A végpont `users.manage` alatt áll, a felhasználó-
 * szerkesztő mellett; a szabályokat a közös `permissionOverrideChangeProblem`
 * dönti el, a VÁLTOZÁSRA nézve.
 *
 * A MÓDOSÍTÁS A KÖVETKEZŐ KÉRÉSNÉL HAT: a feloldó minden kérésnél az
 * adatbázisból olvassa a jogokat, tehát kiléptetés nem kell.
 */
@Injectable()
export class UserPermissionsService {
  constructor(private readonly repository: UserPermissionsRepository) {}

  async overview(id: string): Promise<UserPermissionOverview> {
    const row = await this.repository.target(id);
    if (!row) throw new NotFoundException(USER_NOT_FOUND);
    return overview(row);
  }

  async replace(
    id: string,
    requested: readonly PermissionOverride[],
    actor: AuthenticatedUser,
  ): Promise<UserPermissionOverview> {
    const row = await this.repository.target(id);
    if (!row) throw new NotFoundException(USER_NOT_FOUND);
    for (const override of requested)
      if (!isPermission(override.permission))
        throw new BadRequestException(
          `Ismeretlen jog: ${String(override.permission)}`,
        );

    const before = storedOverrides(row);
    const after = normalizePermissionOverrides(row.role, requested);
    const problem = permissionOverrideChangeProblem({
      actorRole: actor.role,
      target: row,
      before,
      after,
    });
    if (problem) throw new ForbiddenException(problem);

    const had = new Set(permissionsWithOverrides(row.role, before));
    const has = new Set(permissionsWithOverrides(row.role, after));
    const gained = [...has].filter((permission) => !had.has(permission));
    const lost = [...had].filter((permission) => !has.has(permission));
    // sorrendtől független összevetés: a tárolt sorok sorrendje nem jelentés
    const key = (list: readonly PermissionOverride[]) =>
      list
        .map((o) => `${o.permission}:${o.effect}`)
        .sort()
        .join(",");
    if (key(before) !== key(after))
      await this.repository.replace({
        userId: id,
        actorId: actor.id,
        before,
        after,
        gained,
        lost,
      });
    return this.overview(id);
  }
}
