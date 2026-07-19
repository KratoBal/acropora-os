import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { PermissionGuard } from "./permission.guard.js";

const warehouseUser: AuthenticatedUser = {
  id: "warehouse-test",
  email: "warehouse@acropora.local",
  displayName: "Raktári Tesztelő",
  role: "WAREHOUSE",
};

function createContext(user?: AuthenticatedUser): ExecutionContext {
  return {
    getHandler: () => createContext,
    getClass: () => PermissionGuard,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function reflectorReturning<T>(value: T): Reflector {
  return {
    getAllAndOverride: () => value,
  } as unknown as Reflector;
}

describe("PermissionGuard", () => {
  it("allows an endpoint without permission metadata", () => {
    const guard = new PermissionGuard(reflectorReturning(undefined));
    assert.equal(guard.canActivate(createContext()), true);
  });

  it("allows a user with every required permission", () => {
    const guard = new PermissionGuard(
      reflectorReturning([
        PERMISSIONS.INVENTORY_VIEW,
        PERMISSIONS.INVENTORY_MANAGE,
      ]),
    );
    assert.equal(guard.canActivate(createContext(warehouseUser)), true);
  });

  it("rejects a user missing a required permission", () => {
    const guard = new PermissionGuard(
      reflectorReturning([PERMISSIONS.FINANCE_MANAGE]),
    );
    assert.throws(
      () => guard.canActivate(createContext(warehouseUser)),
      ForbiddenException,
    );
  });
});
