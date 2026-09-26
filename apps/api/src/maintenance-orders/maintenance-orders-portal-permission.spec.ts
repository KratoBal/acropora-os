import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { PermissionGuard } from "../auth/guards/permission.guard.js";
import { MaintenanceOrdersPortalController } from "./maintenance-orders-portal.controller.js";

/**
 * A PARTNER PORTÁL MEGRENDELŐLAP-VÉGPONTJAINAK JOGOSULTSÁGA.
 *
 * MI PIROSÍT: ha a `list()`/`detail()`/`download()` valaha `PARTNERS_MANAGE`
 * mögé kerülne (ami a belső, ár-hordozó kontrollert védi -- a
 * `PARTNER_SERVICE` szerep SOSEM kapja meg azt a jogot, tehát a portál
 * azonnal 403-at adna mindenkinek), vagy ha a feltöltés kikerülne
 * `SERVICE_MANAGE` alól.
 */
describe("a partner portál megrendelőlap-végpontjainak jogosultsága", () => {
  const guardFor = (
    handler: unknown,
    role: string,
  ): { canActivate: () => boolean } => {
    const guard = new PermissionGuard(new Reflector());
    const context = {
      getHandler: () => handler,
      getClass: () => MaintenanceOrdersPortalController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: "partner-user", role } }),
      }),
    };
    return { canActivate: () => guard.canActivate(context as never) };
  };

  it("PARTNER_SERVICE átjut az olvasó végpontokon", () => {
    for (const handler of [
      MaintenanceOrdersPortalController.prototype.list,
      MaintenanceOrdersPortalController.prototype.detail,
      MaintenanceOrdersPortalController.prototype.download,
    ]) {
      assert.equal(
        guardFor(handler, "PARTNER_SERVICE").canActivate(),
        true,
        "a PARTNER_SERVICE szerepnek át kell jutnia az olvasó végponton",
      );
    }
  });

  it("PARTNER_SERVICE átjut a feltöltő végponton", () => {
    assert.equal(
      guardFor(
        MaintenanceOrdersPortalController.prototype.uploadSignedDocument,
        "PARTNER_SERVICE",
      ).canActivate(),
      true,
    );
  });

  /**
   * POZITÍV KONTROLL, HOGY A GUARD TÉNYLEG TILT VALAHOL -- enélkül a fenti
   * két átengedő állítás akkor is zöld lenne, ha a guard mindig igazat adna.
   */
  it("KONTROLL: SERVICE_VIEW nélküli szerep elutasítást kap", () => {
    /*
      A `CONTENT_AGENT` valódi `UserRole`, csak `CONTENT_VIEW`/
      `CONTENT_MANAGE`-et hordoz (`auth.ts`), tehát `SERVICE_VIEW` nélkül áll.
    */
    assert.throws(
      () =>
        guardFor(
          MaintenanceOrdersPortalController.prototype.list,
          "CONTENT_AGENT",
        ).canActivate(),
      (error: unknown) =>
        error instanceof ForbiddenException && error.getStatus() === 403,
    );
  });
});
