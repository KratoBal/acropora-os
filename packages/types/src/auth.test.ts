import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  USER_ROLES,
} from "./auth.js";

describe("role permission mapping", () => {
  it("defines a permission set for every role", () => {
    assert.deepEqual(
      Object.keys(ROLE_PERMISSIONS).sort(),
      [...USER_ROLES].sort(),
    );
  });

  it("grants every permission to owner and admin", () => {
    const permissionCount = Object.keys(PERMISSIONS).length;
    assert.equal(ROLE_PERMISSIONS.OWNER.length, permissionCount);
    assert.equal(ROLE_PERMISSIONS.ADMIN.length, permissionCount);
  });

  it("keeps closed-worksheet amendment away from the service role", () => {
    assert.ok(ROLE_PERMISSIONS.SERVICE.includes(PERMISSIONS.SERVICE_MANAGE));
    assert.ok(
      !ROLE_PERMISSIONS.SERVICE.includes(PERMISSIONS.SERVICE_WORKSHEET_AMEND),
    );
    assert.ok(
      !ROLE_PERMISSIONS.MANAGER.includes(PERMISSIONS.SERVICE_WORKSHEET_AMEND),
    );
    assert.ok(
      ROLE_PERMISSIONS.OWNER.includes(PERMISSIONS.SERVICE_WORKSHEET_AMEND),
    );
  });

  it("lets the service role see partners without editing them", () => {
    assert.ok(ROLE_PERMISSIONS.SERVICE.includes(PERMISSIONS.PARTNERS_VIEW));
    assert.ok(!ROLE_PERMISSIONS.SERVICE.includes(PERMISSIONS.PARTNERS_MANAGE));
  });

  /**
   * Partner access used to hang off the purchasing permissions, and the
   * supplier endpoints were moved onto the new pair. Anyone who could reach
   * partners before must still reach them, otherwise the split quietly takes
   * away access that nobody decided to take away -- and the only symptom would
   * be a colleague locked out of a screen they used yesterday.
   */
  it("takes partner access away from nobody who had it", () => {
    for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS)) {
      if (permissions.includes(PERMISSIONS.PURCHASING_VIEW)) {
        assert.ok(
          permissions.includes(PERMISSIONS.PARTNERS_VIEW),
          `${role} could see partners before and cannot now`,
        );
      }
      if (permissions.includes(PERMISSIONS.PURCHASING_MANAGE)) {
        assert.ok(
          permissions.includes(PERMISSIONS.PARTNERS_MANAGE),
          `${role} could edit partners before and cannot now`,
        );
      }
    }
  });

  it("keeps warehouse permissions scoped to warehouse work", () => {
    assert.ok(
      ROLE_PERMISSIONS.WAREHOUSE.includes(PERMISSIONS.INVENTORY_MANAGE),
    );
    assert.ok(!ROLE_PERMISSIONS.WAREHOUSE.includes(PERMISSIONS.FINANCE_MANAGE));
  });
});

describe("permission helpers", () => {
  it("checks one permission", () => {
    assert.equal(hasPermission("SERVICE", PERMISSIONS.SERVICE_MANAGE), true);
    assert.equal(hasPermission("SERVICE", PERMISSIONS.USERS_MANAGE), false);
  });

  it("checks whether any permission is available", () => {
    assert.equal(
      hasAnyPermission("SALES", [
        PERMISSIONS.SETTINGS_MANAGE,
        PERMISSIONS.ORDERS_MANAGE,
      ]),
      true,
    );
    assert.equal(
      hasAnyPermission("VIEWER", [
        PERMISSIONS.SETTINGS_MANAGE,
        PERMISSIONS.USERS_MANAGE,
      ]),
      false,
    );
  });

  it("checks whether every permission is available", () => {
    assert.equal(
      hasAllPermissions("WAREHOUSE", [
        PERMISSIONS.INVENTORY_VIEW,
        PERMISSIONS.INVENTORY_MANAGE,
      ]),
      true,
    );
    assert.equal(
      hasAllPermissions("WAREHOUSE", [
        PERMISSIONS.INVENTORY_MANAGE,
        PERMISSIONS.FINANCE_MANAGE,
      ]),
      false,
    );
  });
});
