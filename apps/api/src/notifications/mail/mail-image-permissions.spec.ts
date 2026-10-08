import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { AuthenticatedUser, UserRole } from "@acropora/types";

import { PermissionGuard } from "../../auth/guards/permission.guard.js";
import { MailImageController } from "./mail-image.controller.js";

/**
 * A LEVELKEPEK JOGA (acrobot 25433, 2026-10-01): az OLVASAS (lista, tartalom)
 * `billing.resend` VAGY `settings.manage` joggal megy, a FELTOLTES csak
 * `settings.manage`-dzsel. A valodi guard fut a valodi metaadaton.
 *
 * MI PIROSIT: ha a szamlazo (MANAGER: billing.resend, settings.manage nelkul)
 * nem latna a kepeket; ha FEL is tolthetne; ha egy egyik joggal sem rendelkezo
 * szerep (WAREHOUSE) olvashatna. A SALES 2026-10-08 ota kiallit es kikuld
 * (billing.resend, Balazs dontese), tehat a kikuldo fiok kepeit o is olvassa.
 */
const user = (role: UserRole): AuthenticatedUser => ({
  id: `u-${role}`,
  email: `${role.toLowerCase()}@acropora.local`,
  displayName: role,
  role,
  customerId: null,
  supplierId: null,
});

const enged = (role: UserRole, handler: keyof MailImageController): boolean => {
  const context = {
    getHandler: () => MailImageController.prototype[handler],
    getClass: () => MailImageController,
    switchToHttp: () => ({ getRequest: () => ({ user: user(role) }) }),
  } as unknown as ExecutionContext;
  try {
    return new PermissionGuard(new Reflector()).canActivate(context);
  } catch (error) {
    if (error instanceof ForbiddenException) return false;
    throw error;
  }
};

describe("a levélképek joga", () => {
  it("a számlázó (billing.resend) olvas, de nem tölt fel", () => {
    assert.equal(enged("MANAGER", "list"), true);
    assert.equal(enged("MANAGER", "content"), true);
    assert.equal(enged("MANAGER", "upload"), false);
  });

  it("a beállításokat kezelő mindent", () => {
    assert.equal(enged("ADMIN", "list"), true);
    assert.equal(enged("ADMIN", "content"), true);
    assert.equal(enged("ADMIN", "upload"), true);
  });

  it("az ertekesito, aki 2026-10-08 ota kikuld, olvas, de nem tolt fel", () => {
    assert.equal(enged("SALES", "list"), true);
    assert.equal(enged("SALES", "content"), true);
    assert.equal(enged("SALES", "upload"), false);
  });

  it("akinek egyik joga sincs, az nem is olvas", () => {
    assert.equal(enged("WAREHOUSE", "list"), false);
    assert.equal(enged("WAREHOUSE", "content"), false);
    assert.equal(enged("WAREHOUSE", "upload"), false);
  });
});
