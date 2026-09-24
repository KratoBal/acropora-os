import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { PermissionGuard } from "../auth/guards/permission.guard.js";
import { CompletionCertificatesController } from "./completion-certificates.controller.js";

describe("teljesítési igazolás végpontok irodai jogosultsága", () => {
  it("SERVICE_MANAGE jogkörű hívót elutasít", () => {
    const guard = new PermissionGuard(new Reflector());
    const context = {
      getHandler: () => CompletionCertificatesController.prototype.list,
      getClass: () => CompletionCertificatesController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: "technician", role: "SERVICE" } }),
      }),
    };
    assert.throws(
      () => guard.canActivate(context as never),
      (error: unknown) =>
        error instanceof ForbiddenException && error.getStatus() === 403,
    );
  });

  it("POZITÍV KONTROLL: irodai (MANAGER) jogkörű hívót átenged", () => {
    const guard = new PermissionGuard(new Reflector());
    const context = {
      getHandler: () => CompletionCertificatesController.prototype.list,
      getClass: () => CompletionCertificatesController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: "office", role: "MANAGER" } }),
      }),
    };
    assert.equal(guard.canActivate(context as never), true);
  });
});
