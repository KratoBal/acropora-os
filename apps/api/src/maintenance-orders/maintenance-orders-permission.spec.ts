import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { PermissionGuard } from "../auth/guards/permission.guard.js";
import { MaintenanceOrdersController } from "./maintenance-orders.controller.js";

describe("megrendelőlap-végpontok irodai jogosultsága", () => {
  it("SERVICE_MANAGE jogkörű hívót elutasít, ÉS nem enged a végpontra", () => {
    /*
      MI PIROSÍT: ha a `MaintenanceOrdersController` valaha `SERVICE_MANAGE`
      alá kerülne (vagy a dekorátor lemaradna róla). Ugyanaz a mérce, mint a
      `contracts-permission.spec.ts`-ben: a szervizes jogköre itt sem lát
      árat, ahogy a szerződésén sem -- acrobot kikötése, 2026-09-24.

      A `user.role` DÖNTI EL A JOGOT (`ROLE_PERMISSIONS[role]`), nem egy
      fixture-re írt `permissions` mező -- ezért a `role: "SERVICE"` a
      lényeg, nem egy kitalált lista.
    */
    const guard = new PermissionGuard(new Reflector());
    const context = {
      getHandler: () => MaintenanceOrdersController.prototype.list,
      getClass: () => MaintenanceOrdersController,
      switchToHttp: () => ({
        getRequest: () => ({
          user: {
            id: "technician",
            role: "SERVICE",
          },
        }),
      }),
    };

    assert.throws(
      () => guard.canActivate(context as never),
      (error: unknown) =>
        error instanceof ForbiddenException && error.getStatus() === 403,
    );
  });

  it("POZITÍV KONTROLL: irodai (MANAGER) jogkörű hívót átenged", () => {
    /*
      A KAPU A `user.role`-BÓL VEZETI LE A JOGOKAT (`hasPermission` a
      `ROLE_PERMISSIONS[role]`-t nézi), NEM egy a fixture-re írt `permissions`
      tömbből -- egy kitalált szerepnév (pl. "OFFICE") ezért nem 403-at adna,
      hanem `ROLE_PERMISSIONS[role]` hiányában elhasalna. A `MANAGER` valódi
      `UserRole`, és `ALL_PERMISSIONS`-t kap (a `CONTENT_APPROVE` kivételével).
    */
    const guard = new PermissionGuard(new Reflector());
    const context = {
      getHandler: () => MaintenanceOrdersController.prototype.list,
      getClass: () => MaintenanceOrdersController,
      switchToHttp: () => ({
        getRequest: () => ({
          user: {
            id: "office",
            role: "MANAGER",
          },
        }),
      }),
    };

    assert.equal(guard.canActivate(context as never), true);
  });
});
