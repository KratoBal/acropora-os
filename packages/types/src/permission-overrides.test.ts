import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PERMISSIONS, ROLE_PERMISSIONS, type UserRole } from "./auth.js";
import {
  ALL_PERMISSION_VALUES,
  applyPermissionOverrides,
  normalizePermissionOverrides,
  OWNER_GRANTED_PERMISSIONS,
  permissionOverrideChangeProblem,
  permissionsWithOverrides,
} from "./permission-overrides.js";

/**
 * A FELHASZNÁLÓNKÉNTI ELTÉRÉS SZABÁLYAI (Balázs, 2026-10-06).
 *
 * MI PIROSÍT: ha az elvétel nem nyer; ha egy ismeretlen jog-név jogot adna;
 * ha a számlázás a pénzügyet követné az eltérésnél; ha partner kaphatna jogot;
 * ha nem tulajdonos adhatna csak-tulajdonosi jogot.
 */
describe("applyPermissionOverrides", () => {
  it("eltérés nélkül PONTOSAN a sablon, sorrendre is, minden szerepre", () => {
    // a sorrend is mérce: a feloldó integrációs tesztje a sablonnal veti
    // össze, és az ADMIN sablonjában a számlázás a lista végén áll
    for (const role of Object.keys(ROLE_PERMISSIONS) as UserRole[])
      assert.deepEqual(
        permissionsWithOverrides(role, []),
        ROLE_PERMISSIONS[role],
        role,
      );
  });

  it("a megadott jog a sablon után áll, a sablon sorrendje nem mozdul", () => {
    const result = permissionsWithOverrides("VIEWER", [
      { permission: PERMISSIONS.SERVICE_MANAGE, effect: "GRANT" },
    ]);
    assert.deepEqual(result, [
      ...ROLE_PERMISSIONS.VIEWER,
      PERMISSIONS.SERVICE_MANAGE,
    ]);
  });

  it("megad és elvesz", () => {
    const result = permissionsWithOverrides("VIEWER", [
      { permission: PERMISSIONS.SERVICE_MANAGE, effect: "GRANT" },
      { permission: PERMISSIONS.DASHBOARD_VIEW, effect: "REVOKE" },
    ]);
    assert.ok(result.includes(PERMISSIONS.SERVICE_MANAGE));
    assert.ok(!result.includes(PERMISSIONS.DASHBOARD_VIEW));
  });

  it("ugyanarra a jogra az elvétel nyer", () => {
    const result = applyPermissionOverrides(
      [],
      [
        { permission: PERMISSIONS.SERVICE_VIEW, effect: "GRANT" },
        { permission: PERMISSIONS.SERVICE_VIEW, effect: "REVOKE" },
      ],
    );
    assert.equal(result.includes(PERMISSIONS.SERVICE_VIEW), false);
  });

  it("ismeretlen jog-név és ismeretlen hatás nem ad semmit", () => {
    assert.deepEqual(
      applyPermissionOverrides(
        [],
        [
          { permission: "nincs.ilyen", effect: "GRANT" },
          { permission: PERMISSIONS.SERVICE_VIEW, effect: "MAYBE" },
        ],
      ),
      [],
    );
  });

  it("a számlázás a pénzügytől külön vehető el és adható (Balázs, 20:23)", () => {
    const elvett = permissionsWithOverrides("MANAGER", [
      { permission: PERMISSIONS.FINANCE_VIEW, effect: "REVOKE" },
    ]);
    assert.ok(!elvett.includes(PERMISSIONS.FINANCE_VIEW));
    assert.ok(elvett.includes(PERMISSIONS.BILLING_VIEW));
    const csakSzamlazas = permissionsWithOverrides("SERVICE", [
      { permission: PERMISSIONS.BILLING_VIEW, effect: "GRANT" },
    ]);
    assert.ok(csakSzamlazas.includes(PERMISSIONS.BILLING_VIEW));
    assert.ok(!csakSzamlazas.includes(PERMISSIONS.FINANCE_VIEW));
  });
});

describe("OWNER_GRANTED_PERMISSIONS", () => {
  it("a vezetői sablonból kimaradt jogok, a beállításokkal és a felhasználókkal", () => {
    assert.ok(OWNER_GRANTED_PERMISSIONS.includes(PERMISSIONS.USERS_MANAGE));
    assert.ok(OWNER_GRANTED_PERMISSIONS.includes(PERMISSIONS.SETTINGS_MANAGE));
    assert.ok(!OWNER_GRANTED_PERMISSIONS.includes(PERMISSIONS.SERVICE_VIEW));
    for (const permission of OWNER_GRANTED_PERMISSIONS)
      assert.ok(!ROLE_PERMISSIONS.MANAGER.includes(permission), permission);
  });
});

describe("permissionOverrideChangeProblem", () => {
  const internal = { customerId: null, supplierId: null };
  const grant = (permission: (typeof ALL_PERMISSION_VALUES)[number]) => ({
    permission,
    effect: "GRANT" as const,
  });
  const revoke = (permission: (typeof ALL_PERMISSION_VALUES)[number]) => ({
    permission,
    effect: "REVOKE" as const,
  });

  it("belső kollégának ADMIN adhat nem csak-tulajdonosi jogot", () => {
    assert.equal(
      permissionOverrideChangeProblem({
        actorRole: "ADMIN",
        target: { role: "VIEWER", ...internal },
        before: [],
        after: [grant(PERMISSIONS.SERVICE_MANAGE)],
      }),
      null,
    );
  });

  it("csak-tulajdonosi jogot csak tulajdonos ad", () => {
    const input = {
      target: { role: "SERVICE" as const, ...internal },
      before: [],
      after: [grant(PERMISSIONS.USERS_MANAGE)],
    };
    assert.match(
      permissionOverrideChangeProblem({ actorRole: "ADMIN", ...input }) ?? "",
      /csak tulajdonos/,
    );
    assert.equal(
      permissionOverrideChangeProblem({ actorRole: "OWNER", ...input }),
      null,
    );
  });

  it("a változatlanul visszamentett tulajdonosi jog nem adás", () => {
    const kapott = [grant(PERMISSIONS.USERS_MANAGE)];
    assert.equal(
      permissionOverrideChangeProblem({
        actorRole: "ADMIN",
        target: { role: "SERVICE", ...internal },
        before: kapott,
        // a tulajdonosi sor változatlan, mellé egy nem tulajdonosi jog jön
        after: [...kapott, grant(PERMISSIONS.SERVICE_MANAGE)],
      }),
      null,
    );
  });

  it("a sablonban már meglévő jog megadása nem adás (nem kell hozzá tulajdonos)", () => {
    assert.equal(
      permissionOverrideChangeProblem({
        actorRole: "ADMIN",
        target: { role: "ADMIN", ...internal },
        before: [],
        after: [grant(PERMISSIONS.USERS_MANAGE)],
      }),
      null,
    );
  });

  it("egy elvétel törlése is adás: tulajdonosi jogot így sem ad vissza más", () => {
    assert.match(
      permissionOverrideChangeProblem({
        actorRole: "ADMIN",
        target: { role: "ADMIN", ...internal },
        before: [revoke(PERMISSIONS.USERS_MANAGE)],
        after: [],
      }) ?? "",
      /csak tulajdonos/,
    );
  });

  it("partner egyénileg sem kap jogot, elvenni és visszaadni lehet", () => {
    const partner = {
      role: "PARTNER_SERVICE" as const,
      customerId: "c1",
      supplierId: null,
    };
    assert.match(
      permissionOverrideChangeProblem({
        actorRole: "OWNER",
        target: partner,
        before: [],
        after: [grant(PERMISSIONS.USERS_MANAGE)],
      }) ?? "",
      /Partner/,
    );
    assert.equal(
      permissionOverrideChangeProblem({
        actorRole: "OWNER",
        target: partner,
        before: [],
        after: [revoke(PERMISSIONS.SERVICE_VIEW)],
      }),
      null,
    );
    // belső szerepű, de partnerhez kötött fiók is partner
    assert.match(
      permissionOverrideChangeProblem({
        actorRole: "OWNER",
        target: { role: "SERVICE", customerId: "c1", supplierId: null },
        before: [],
        after: [grant(PERMISSIONS.FINANCE_VIEW)],
      }) ?? "",
      /Partner/,
    );
  });

  it("gépi fiók, és tulajdonos más által: tiltva", () => {
    assert.match(
      permissionOverrideChangeProblem({
        actorRole: "OWNER",
        target: { role: "CONTENT_AGENT", ...internal },
        before: [],
        after: [revoke(PERMISSIONS.CONTENT_VIEW)],
      }) ?? "",
      /Gépi/,
    );
    assert.match(
      permissionOverrideChangeProblem({
        actorRole: "ADMIN",
        target: { role: "OWNER", ...internal },
        before: [],
        after: [revoke(PERMISSIONS.SERVICE_VIEW)],
      }) ?? "",
      /Tulajdonos jogait/,
    );
  });

  it("változás nélkül soha nincs akadály", () => {
    assert.equal(
      permissionOverrideChangeProblem({
        actorRole: "VIEWER",
        target: { role: "CONTENT_AGENT", ...internal },
        before: [],
        after: [],
      }),
      null,
    );
  });
});

describe("normalizePermissionOverrides", () => {
  it("a felesleges eltérés kimarad, ugyanarra a jogra a későbbi nyer", () => {
    assert.deepEqual(
      normalizePermissionOverrides("SERVICE", [
        { permission: PERMISSIONS.SERVICE_VIEW, effect: "GRANT" },
        { permission: PERMISSIONS.USERS_MANAGE, effect: "REVOKE" },
        { permission: PERMISSIONS.FINANCE_VIEW, effect: "REVOKE" },
        { permission: PERMISSIONS.FINANCE_VIEW, effect: "GRANT" },
      ]),
      ROLE_PERMISSIONS.SERVICE.includes(PERMISSIONS.FINANCE_VIEW)
        ? []
        : [{ permission: PERMISSIONS.FINANCE_VIEW, effect: "GRANT" }],
    );
  });
});
