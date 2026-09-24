import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PERMISSIONS } from "@acropora/types";

import { PermissionGuard } from "../auth/guards/permission.guard.js";
import { ContractsController } from "./contracts.controller.js";

describe("contract endpoints office permission", () => {
  it("irodai jogosultság nélkül 403 a szerződés-végpontokon", () => {
    const guard = new PermissionGuard(new Reflector());
    const context = {
      getHandler: () => ContractsController.prototype.list,
      getClass: () => ContractsController,
      switchToHttp: () => ({
        getRequest: () => ({
          user: {
            id: "technician",
            role: "SERVICE",
            permissions: [PERMISSIONS.SERVICE_MANAGE],
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
});
