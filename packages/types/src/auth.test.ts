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
