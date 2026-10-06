import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  INTERNAL_ROLES,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  USER_ROLES,
} from "@acropora/types";

import { usersWithPermissionWhere } from "./permission-holders.js";

/**
 * A „KI HORDOZZA” SZŰRŐ (2026-10-06): ma pontosan a régi `role IN (…)`, a
 * sablonból számolva. Az állítás a régi, kézzel írt alakkal veti össze, hogy
 * az előkészítő lépés viselkedés-változás nélkül menjen be.
 */
describe("usersWithPermissionWhere", () => {
  it("a szerepek, akiknek a sablonja hordozza a jogot", () => {
    for (const permission of Object.values(PERMISSIONS))
      assert.deepEqual(usersWithPermissionWhere(permission), {
        role: {
          in: USER_ROLES.filter((role) =>
            ROLE_PERMISSIONS[role].includes(permission),
          ),
        },
      });
  });

  it("a hívó szűkítheti a szerepek körét (pl. csak belsőkre)", () => {
    const where = usersWithPermissionWhere(
      PERMISSIONS.SERVICE_MANAGE,
      INTERNAL_ROLES,
    );
    const roles = (where.role as { in: string[] }).in;
    assert.ok(roles.includes("SERVICE"));
    assert.ok(!roles.includes("PARTNER_SERVICE"));
    assert.ok(!roles.includes("VIEWER"));
  });
});
