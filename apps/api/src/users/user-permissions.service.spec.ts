import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import {
  PERMISSIONS,
  type AuthenticatedUser,
  type PermissionOverride,
  type UserRole,
} from "@acropora/types";

import type {
  PermissionTargetRow,
  UserPermissionsRepository,
} from "./user-permissions.repository.js";
import { UserPermissionsService } from "./user-permissions.service.js";

/**
 * A FELHASZNÁLÓNKÉNTI JOG-ELTÉRÉS SZOLGÁLTATÁSA (Balázs döntése, 2026-10-06).
 *
 * MI PIROSÍT: ha a szabály-sértés is íródna; ha egy változatlan mentés naplót
 * írna; ha a napló nem mondaná meg, mit nyert és mit vesztett a személy; ha a
 * felesleges eltérés (a sablonban meglévő jog megadása) eltárolódna.
 */

function setup(row: PermissionTargetRow | null) {
  const writes: Array<{
    before: PermissionOverride[];
    after: PermissionOverride[];
    gained: string[];
    lost: string[];
    actorId: string;
  }> = [];
  let current = row;
  const repository = {
    target: async () => current,
    replace: async (input: (typeof writes)[number] & { userId: string }) => {
      writes.push(input);
      if (current)
        current = { ...current, permissionOverrides: [...input.after] };
    },
  } as unknown as UserPermissionsRepository;
  return { service: new UserPermissionsService(repository), writes };
}

const actor = (role: UserRole): AuthenticatedUser => ({
  id: "actor",
  email: "a@x.invalid",
  displayName: "A",
  role,
  customerId: null,
  supplierId: null,
});

const target = (
  over: Partial<PermissionTargetRow> = {},
): PermissionTargetRow => ({
  id: "u1",
  role: "SERVICE",
  customerId: null,
  supplierId: null,
  permissionOverrides: [],
  ...over,
});

describe("UserPermissionsService", () => {
  it("nem létező felhasználóra 404", async () => {
    const { service } = setup(null);
    await assert.rejects(service.overview("x"), NotFoundException);
    await assert.rejects(
      service.replace("x", [], actor("OWNER")),
      NotFoundException,
    );
  });

  it("az áttekintés: sablon, eltérés, a személy jogai", async () => {
    const { service } = setup(
      target({
        permissionOverrides: [
          { permission: PERMISSIONS.SERVICE_MANAGE, effect: "REVOKE" },
          { permission: "kivezetett.jog", effect: "GRANT" },
        ],
      }),
    );
    const view = await service.overview("u1");
    assert.ok(view.template.includes(PERMISSIONS.SERVICE_MANAGE));
    assert.deepEqual(view.overrides, [
      { permission: PERMISSIONS.SERVICE_MANAGE, effect: "REVOKE" },
    ]);
    assert.equal(view.effective.includes(PERMISSIONS.SERVICE_MANAGE), false);
  });

  it("ment, és a napló a nyert és elvesztett jogokat is viszi", async () => {
    const { service, writes } = setup(target());
    const view = await service.replace(
      "u1",
      [
        { permission: PERMISSIONS.FINANCE_VIEW, effect: "GRANT" },
        { permission: PERMISSIONS.SERVICE_MANAGE, effect: "REVOKE" },
        // felesleges: a SERVICE sablonja már hordozza
        { permission: PERMISSIONS.SERVICE_VIEW, effect: "GRANT" },
      ],
      actor("ADMIN"),
    );
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0]!.gained, [PERMISSIONS.FINANCE_VIEW]);
    assert.deepEqual(writes[0]!.lost, [PERMISSIONS.SERVICE_MANAGE]);
    assert.equal(writes[0]!.actorId, "actor");
    assert.equal(
      writes[0]!.after.some((o) => o.permission === PERMISSIONS.SERVICE_VIEW),
      false,
    );
    assert.ok(view.effective.includes(PERMISSIONS.FINANCE_VIEW));
  });

  it("változatlan mentés nem ír naplót, más sorrendben sem", async () => {
    const stored: PermissionOverride[] = [
      { permission: PERMISSIONS.SERVICE_MANAGE, effect: "REVOKE" },
      { permission: PERMISSIONS.FINANCE_VIEW, effect: "GRANT" },
    ];
    const { service, writes } = setup(target({ permissionOverrides: stored }));
    await service.replace("u1", [...stored].reverse(), actor("ADMIN"));
    assert.equal(writes.length, 0);
  });

  it("a szabály-sértés 403, és nem ír", async () => {
    const { service, writes } = setup(target());
    await assert.rejects(
      service.replace(
        "u1",
        [{ permission: PERMISSIONS.USERS_MANAGE, effect: "GRANT" }],
        actor("ADMIN"),
      ),
      (error: Error) =>
        error instanceof ForbiddenException &&
        /csak tulajdonos/.test(error.message),
    );
    assert.equal(writes.length, 0);
  });

  it("partner-fiók egyéni megadása 403", async () => {
    const { service } = setup(
      target({ role: "PARTNER_SERVICE", customerId: "c1" }),
    );
    await assert.rejects(
      service.replace(
        "u1",
        [{ permission: PERMISSIONS.FINANCE_VIEW, effect: "GRANT" }],
        actor("OWNER"),
      ),
      ForbiddenException,
    );
  });

  it("ismeretlen jog 400 (a DTO mögött is)", async () => {
    const { service } = setup(target());
    await assert.rejects(
      service.replace(
        "u1",
        [{ permission: "nincs.ilyen" as never, effect: "GRANT" }],
        actor("OWNER"),
      ),
      BadRequestException,
    );
  });
});
