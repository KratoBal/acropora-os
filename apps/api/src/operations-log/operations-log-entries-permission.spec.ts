import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PERMISSIONS } from "@acropora/types";

import { PermissionGuard } from "../auth/guards/permission.guard.js";
import { OperationsLogEntriesController } from "./operations-log-entries.controller.js";
import { OperationsReportController } from "./operations-report.controller.js";

/*
  A BEJEGYZÉSEK JOGAI (task os-uzemeltetesi-naplo, S2a). MI PIROSIT: ha a rögzítés (és a rögzítő képernyő kínálata) a nézet
  jogával is menne, vagyis a csak olvasó VIEWER is rögzíthetne; ha a rögzítő jog nélkül a bejegyzések olvasása nyitva lenne; ha
  a sablonkezelő jog (a nézettel és a rögzítéssel együtt kapott jog nélkül) rögzíthetne.
*/
const guard = new PermissionGuard(new Reflector());
const run = (
  handler: (...args: never[]) => unknown,
  permissions: string[],
): boolean => {
  const context = {
    getHandler: () => handler,
    getClass: () => OperationsLogEntriesController,
    switchToHttp: () => ({
      getRequest: () => ({ user: { id: "u", role: "SERVICE", permissions } }),
    }),
  };
  return guard.canActivate(context as never);
};
const proto = OperationsLogEntriesController.prototype;
const denied = (handler: (...args: never[]) => unknown, p: string[]) =>
  assert.throws(
    () => run(handler, p),
    (error: unknown) =>
      error instanceof ForbiddenException && error.getStatus() === 403,
  );

describe("az üzemeltetési napló bejegyzés-végpontjainak jogai", () => {
  it("a rögzítő jog rögzít és kínálatot kap, de a bejegyzéseket nem olvassa", () => {
    const record = [PERMISSIONS.OPERATIONS_LOG_RECORD];
    for (const route of [
      proto.create,
      proto.templatesForAsset,
      proto.colleagues,
      proto.uploadPhoto,
    ])
      assert.equal(run(route, record), true);
    for (const route of [proto.list, proto.get, proto.downloadPhoto])
      denied(route, record);
  });

  it("a nézet jog olvas, de nem rögzít", () => {
    const view = [PERMISSIONS.OPERATIONS_LOG_VIEW];
    for (const route of [proto.list, proto.get, proto.downloadPhoto])
      assert.equal(run(route, view), true);
    for (const route of [
      proto.create,
      proto.templatesForAsset,
      proto.colleagues,
      proto.uploadPhoto,
    ])
      denied(route, view);
  });

  it("a sablonkezelő jog önmagában sem rögzít, sem nem olvas; jog nélkül minden 403", () => {
    const manage = [PERMISSIONS.OPERATIONS_LOG_TEMPLATES_MANAGE];
    for (const route of [
      proto.create,
      proto.templatesForAsset,
      proto.colleagues,
      proto.list,
      proto.get,
      proto.uploadPhoto,
      proto.downloadPhoto,
    ]) {
      denied(route, manage);
      denied(route, [PERMISSIONS.SERVICE_VIEW]);
    }
  });
});

describe("a havi kimutatás végpontjainak jogai", () => {
  /*
    MI PIROSIT: ha a kimutatást a rögzítő jog is olvasná (a szerelő a teljes helyszín kimutatását látná), ha a nézet jog nélkül
    nyitva volna, vagy ha a sablonkezelő jog önmagában olvasna.
  */
  const reportRun = (
    handler: (...args: never[]) => unknown,
    permissions: string[],
  ) =>
    guard.canActivate({
      getHandler: () => handler,
      getClass: () => OperationsReportController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: "u", role: "SERVICE", permissions } }),
      }),
    } as never);
  const reportProto = OperationsReportController.prototype;

  it("a nézet jog olvassa a JSON-t és a PDF-et, a rögzítő és a kezelő jog önmagában nem", () => {
    for (const route of [reportProto.report, reportProto.pdf]) {
      assert.equal(reportRun(route, [PERMISSIONS.OPERATIONS_LOG_VIEW]), true);
      for (const other of [
        [PERMISSIONS.OPERATIONS_LOG_RECORD],
        [PERMISSIONS.OPERATIONS_LOG_TEMPLATES_MANAGE],
        [PERMISSIONS.SERVICE_VIEW],
      ])
        assert.throws(
          () => reportRun(route, other),
          (error: unknown) =>
            error instanceof ForbiddenException && error.getStatus() === 403,
        );
    }
  });
});
