import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ForbiddenException,
  SetMetadata,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import {
  REQUIRED_ANY_PERMISSIONS_KEY,
  REQUIRED_PERMISSIONS_KEY,
} from "../decorators/require-permissions.decorator.js";
import { PermissionGuard } from "./permission.guard.js";

const warehouseUser: AuthenticatedUser = {
  id: "warehouse-test",
  email: "warehouse@acropora.local",
  displayName: "Raktári Tesztelő",
  role: "WAREHOUSE",
  customerId: null,
  supplierId: null,
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

  /*
    LEGALABB EGY JOG (`RequireAnyPermission`), valodi Reflectorral: a fenti
    mock minden kulcsra ugyanazt adja, tehat a ket kulcsot nem tudna
    szetvalasztani. MI PIROSIT: ha az any-of mindet kerne, ha semmit sem, vagy
    ha a ket kulcs egyutt nem mindket feltetelt jelentene.
  */
  const handlerWith = (meta: Record<string, unknown>) => {
    const handler = () => undefined;
    for (const [key, value] of Object.entries(meta))
      SetMetadata(key, value)(handler);
    return {
      getHandler: () => handler,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => ({ user: warehouseUser }) }),
    } as unknown as ExecutionContext;
  };
  const guard = new PermissionGuard(new Reflector());

  it("any-of: one of the permissions is enough", () => {
    assert.equal(
      guard.canActivate(
        handlerWith({
          [REQUIRED_ANY_PERMISSIONS_KEY]: [
            PERMISSIONS.FINANCE_MANAGE,
            PERMISSIONS.INVENTORY_VIEW,
          ],
        }),
      ),
      true,
    );
  });

  it("any-of: none of them is rejected", () => {
    assert.throws(
      () =>
        guard.canActivate(
          handlerWith({
            [REQUIRED_ANY_PERMISSIONS_KEY]: [
              PERMISSIONS.FINANCE_MANAGE,
              PERMISSIONS.SETTINGS_MANAGE,
            ],
          }),
        ),
      ForbiddenException,
    );
  });

  it("both keys: the all-of list still has to hold", () => {
    assert.throws(
      () =>
        guard.canActivate(
          handlerWith({
            [REQUIRED_PERMISSIONS_KEY]: [PERMISSIONS.FINANCE_MANAGE],
            [REQUIRED_ANY_PERMISSIONS_KEY]: [PERMISSIONS.INVENTORY_VIEW],
          }),
        ),
      ForbiddenException,
    );
  });
});
