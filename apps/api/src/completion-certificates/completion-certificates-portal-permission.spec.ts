import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { PermissionGuard } from "../auth/guards/permission.guard.js";
import { CompletionCertificatesPortalController } from "./completion-certificates-portal.controller.js";

/**
 * A PARTNER PORTÁL TELJESÍTÉSI IGAZOLÁS VÉGPONTJAINAK JOGOSULTSÁGA.
 *
 * UGYANAZ A MÉRCE, MINT A MEGRENDELŐLAP TESTVÉR-SPECJÉBEN
 * (`maintenance-orders-portal-permission.spec.ts`): a belső, `PARTNERS_
 * MANAGE`-es kontroller és e között nincs átfedés -- a `PARTNER_SERVICE`
 * SOSEM kapja meg a `PARTNERS_MANAGE`-et.
 */
describe("a partner portál teljesítési igazolás végpontjainak jogosultsága", () => {
  const guardFor = (
    handler: unknown,
    role: string,
  ): { canActivate: () => boolean } => {
    const guard = new PermissionGuard(new Reflector());
    const context = {
      getHandler: () => handler,
      getClass: () => CompletionCertificatesPortalController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: "partner-user", role } }),
      }),
    };
    return { canActivate: () => guard.canActivate(context as never) };
  };

  it("PARTNER_SERVICE átjut az olvasó végpontokon", () => {
    for (const handler of [
      CompletionCertificatesPortalController.prototype.list,
      CompletionCertificatesPortalController.prototype.detail,
      CompletionCertificatesPortalController.prototype.download,
    ]) {
      assert.equal(guardFor(handler, "PARTNER_SERVICE").canActivate(), true);
    }
  });

  it("PARTNER_SERVICE átjut a feltöltő végponton", () => {
    assert.equal(
      guardFor(
        CompletionCertificatesPortalController.prototype.uploadSignedDocument,
        "PARTNER_SERVICE",
      ).canActivate(),
      true,
    );
  });

  it("KONTROLL: SERVICE_VIEW nélküli szerep elutasítást kap", () => {
    assert.throws(
      () =>
        guardFor(
          CompletionCertificatesPortalController.prototype.list,
          "CONTENT_AGENT",
        ).canActivate(),
      (error: unknown) =>
        error instanceof ForbiddenException && error.getStatus() === 403,
    );
  });
});
