import {
  isMachineRole,
  partnerMembership,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  type Permission,
  type UserRole,
} from "./auth.js";

/**
 * FELHASZNÁLÓNKÉNTI JOG-ELTÉRÉS A SZEREPKÖR SABLONJÁTÓL (Balázs döntése,
 * 2026-10-06 19:53 UTC: szerepkör-sablon + egyéni eltérés).
 *
 * Egy eltérés egy jogot AD (`GRANT`) vagy VESZ EL (`REVOKE`) a sablonhoz
 * képest. A személy jogai: a sablon, plusz amit kapott, mínusz amit
 * elvettek tőle.
 *
 * A SZÁMLÁZÁS KÜLÖN SOR (Balázs, 2026-10-06 20:23 UTC): a sablon a pénzügyi
 * jogokból vezeti le a számlázásiakat, és ez az alapértelmezés marad; az
 * eltérés viszont a KÉSZ listán hat, tehát a számlázás a pénzügytől
 * függetlenül adható és vehető el.
 */

export const PERMISSION_OVERRIDE_EFFECTS = ["GRANT", "REVOKE"] as const;
export type PermissionOverrideEffect =
  (typeof PERMISSION_OVERRIDE_EFFECTS)[number];

export interface PermissionOverride {
  permission: Permission;
  effect: PermissionOverrideEffect;
}

/** Minden ismert jog, a `PERMISSIONS` sorrendjében. */
export const ALL_PERMISSION_VALUES: readonly Permission[] =
  Object.values(PERMISSIONS);

const KNOWN = new Set<string>(ALL_PERMISSION_VALUES);

export function isPermission(value: string): value is Permission {
  return KNOWN.has(value);
}

/**
 * A SZEMÉLY JOGAI: a sablon, plusz a megadottak, mínusz az elvettek, a
 * `PERMISSIONS` sorrendjében.
 *
 * Az ISMERETLEN jog-nevű sort kihagyja, mert egy átnevezett vagy kivezetett
 * jog sora nem adhat semmit. Ha ugyanarra a jogra megadás és elvétel is állna
 * (a tábla kulcsa ezt kizárja), az elvétel nyer: kétes esetben a szűkebb.
 */
export function applyPermissionOverrides(
  template: readonly Permission[],
  overrides: readonly { permission: string; effect: string }[],
): Permission[] {
  const granted = new Set<string>();
  const revoked = new Set<string>();
  for (const override of overrides) {
    if (!isPermission(override.permission)) continue;
    if (override.effect === "GRANT") granted.add(override.permission);
    else if (override.effect === "REVOKE") revoked.add(override.permission);
  }
  // A SABLON SORRENDJE MARAD, a megadott jogok a végére kerülnek: eltérés
  // nélkül a személy jogai PONTOSAN a sablon, sorrendre is (a feloldó
  // integrációs tesztje így méri).
  const base = new Set<string>(template);
  return [
    ...template.filter((permission) => !revoked.has(permission)),
    ...ALL_PERMISSION_VALUES.filter(
      (permission) =>
        granted.has(permission) &&
        !base.has(permission) &&
        !revoked.has(permission),
    ),
  ];
}

/** A szerep sablonja és az eltérései alapján a személy jogai. */
export function permissionsWithOverrides(
  role: UserRole,
  overrides: readonly { permission: string; effect: string }[],
): Permission[] {
  return applyPermissionOverrides(ROLE_PERMISSIONS[role], overrides);
}

/**
 * CSAK TULAJDONOS ADHATJA MEG (Balázs, 2026-10-06): azok a jogok, amelyeket a
 * vezetői (MANAGER) sablon szándékosan kihagy -- beállítások, felhasználók
 * kezelése, rejtés, láthatósági hozzárendelés, jóváhagyások és társaik. A
 * lista NEM kézzel írt: a MANAGER sablonjából származik, tehát ha ott egy jog
 * kikerül vagy bekerül, ez vele együtt mozdul.
 */
export const OWNER_GRANTED_PERMISSIONS: readonly Permission[] =
  ALL_PERMISSION_VALUES.filter(
    (permission) => !ROLE_PERMISSIONS.MANAGER.includes(permission),
  );

export interface PermissionOverrideTarget {
  role: UserRole;
  customerId: string | null;
  supplierId: string | null;
}

/**
 * SZABAD-E A JOG-ELTÉRÉSEK EZEN VÁLTOZÁSA. Az első sértett szabály mondata,
 * vagy `null`. Balázs 2026-10-06-i döntése és a két alapértelmezés:
 *
 * - gépi fiók jogai nem módosíthatók (a jogkörük a feladatuk, nem személyes);
 * - tulajdonos jogait csak tulajdonos módosítja;
 * - partner-fiók egyénileg sem kaphat jogot (elvenni lehet tőle);
 * - csak-tulajdonosi jogot (`OWNER_GRANTED_PERMISSIONS`) csak tulajdonos ad.
 *
 * A VÁLTOZÁST NÉZI, NEM A TELJES LISTÁT: egy adminisztrátor, aki egy olyan
 * listát ment vissza, amiben egy tulajdonos által adott jog változatlanul áll,
 * nem ad semmit. És egy ELVÉTEL TÖRLÉSE is adás: visszaadja a sablon jogát,
 * tehát a csak-tulajdonosi szabály arra is áll.
 */
export function permissionOverrideChangeProblem(input: {
  actorRole: UserRole;
  target: PermissionOverrideTarget;
  before: readonly PermissionOverride[];
  after: readonly PermissionOverride[];
}): string | null {
  const { actorRole, target } = input;
  const effectOf = (list: readonly PermissionOverride[]) =>
    new Map(list.map((o) => [o.permission, o.effect]));
  const before = effectOf(input.before);
  const after = effectOf(input.after);
  const changed = ALL_PERMISSION_VALUES.filter(
    (permission) => before.get(permission) !== after.get(permission),
  );
  if (changed.length === 0) return null;
  if (isMachineRole(target.role)) return "Gépi fiók jogai nem módosíthatók.";
  if (target.role === "OWNER" && actorRole !== "OWNER")
    return "Tulajdonos jogait csak tulajdonos módosíthatja.";
  const partner =
    target.role === "PARTNER_SERVICE" ||
    partnerMembership(target).kind !== "internal";
  const had = new Set(permissionsWithOverrides(target.role, input.before));
  const has = new Set(permissionsWithOverrides(target.role, input.after));
  for (const permission of changed) {
    if (partner && after.get(permission) === "GRANT")
      return "Partner-fiók egyénileg sem kaphat jogot.";
    const gains = has.has(permission) && !had.has(permission);
    if (
      gains &&
      OWNER_GRANTED_PERMISSIONS.includes(permission) &&
      actorRole !== "OWNER"
    )
      return "Ezt a jogot csak tulajdonos adhatja meg.";
  }
  return null;
}

/**
 * A FELESLEGES ELTÉRÉS ELHAGYÁSA: a sablonban már meglévő jog megadása, vagy a
 * sablonban nem szereplő jog elvétele nem változtat semmit, és egy ilyen sor
 * csak félrevezetne (a táblán eltérésnek látszana). Ugyanarra a jogra a
 * későbbi sor nyer.
 */
export function normalizePermissionOverrides(
  role: UserRole,
  overrides: readonly PermissionOverride[],
): PermissionOverride[] {
  const template = new Set<Permission>(ROLE_PERMISSIONS[role]);
  const last = new Map<Permission, PermissionOverrideEffect>();
  for (const override of overrides)
    last.set(override.permission, override.effect);
  return ALL_PERMISSION_VALUES.flatMap((permission) => {
    const effect = last.get(permission);
    if (!effect) return [];
    if (effect === "GRANT" && template.has(permission)) return [];
    if (effect === "REVOKE" && !template.has(permission)) return [];
    return [{ permission, effect }];
  });
}

/** Egy felhasználó jogainak áttekintése (a felhasználó adatlapjának táblázata). */
export interface UserPermissionOverview {
  userId: string;
  role: UserRole;
  /** a szerep sablonja */
  template: Permission[];
  /** a rögzített eltérések */
  overrides: PermissionOverride[];
  /** a személy jogai (sablon + eltérés) */
  effective: Permission[];
  /** amit csak tulajdonos adhat meg (a táblázat jelöli) */
  ownerGranted: Permission[];
}

export interface UpdateUserPermissionOverridesInput {
  overrides: PermissionOverride[];
}
