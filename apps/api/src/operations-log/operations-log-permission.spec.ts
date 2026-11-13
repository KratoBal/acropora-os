import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PERMISSIONS } from "@acropora/types";

import { PermissionGuard } from "../auth/guards/permission.guard.js";
import { OperationsLogController } from "./operations-log.controller.js";

/*
  A SABLONOK OLVASÁSA ÉS ÍRÁSA KÜLÖN JOG (task os-uzemeltetesi-naplo, S1). MI PIROSIT: ha a szerelő (csak a nézet joga) írhatna
  sablont; ha a nézet jog nélkül az olvasás nyitva lenne; ha a kezelő jog a nézet nélkül nem engedne olvasni (a kezelés a
  megtekintéssel együtt jár, de az útvonal jogát külön mérjük).
*/
const guard = new PermissionGuard(new Reflector());
const run = (
  handler: (...args: never[]) => unknown,
  permissions: string[],
): boolean => {
  const context = {
    getHandler: () => handler,
    getClass: () => OperationsLogController,
    switchToHttp: () => ({
      getRequest: () => ({
        user: { id: "u", role: "SERVICE", permissions },
      }),
    }),
  };
  return guard.canActivate(context as never);
};
const proto = OperationsLogController.prototype;

describe("az üzemeltetési napló sablon-végpontjainak jogai", () => {
  it("a nézet joga olvashat, de nem írhat", () => {
    const view = [PERMISSIONS.OPERATIONS_LOG_VIEW];
    assert.equal(run(proto.list, view), true);
    assert.equal(run(proto.get, view), true);
    for (const write of [proto.create, proto.update, proto.retire])
      assert.throws(
        () => run(write, view),
        (error: unknown) =>
          error instanceof ForbiddenException && error.getStatus() === 403,
      );
  });

  it("a kezelő jog ír; jog nélkül minden végpont 403", () => {
    const manage = [PERMISSIONS.OPERATIONS_LOG_TEMPLATES_MANAGE];
    for (const write of [proto.create, proto.update, proto.retire])
      assert.equal(run(write, manage), true);
    for (const route of [
      proto.list,
      proto.get,
      proto.create,
      proto.update,
      proto.retire,
    ])
      assert.throws(
        () => run(route, [PERMISSIONS.SERVICE_VIEW]),
        ForbiddenException,
      );
  });
});
