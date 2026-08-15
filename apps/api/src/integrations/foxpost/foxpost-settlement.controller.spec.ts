import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PERMISSIONS } from "@acropora/types";

import { REQUIRED_PERMISSIONS_KEY } from "../../auth/decorators/require-permissions.decorator.js";
import { FoxpostSettlementController } from "./foxpost-settlement.controller.js";

function permissionsFor(method: (...args: never[]) => unknown) {
  return Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, method);
}

describe("FoxpostSettlementController permissions", () => {
  it("uses finance.view for reads and downloads", () => {
    assert.deepEqual(
      permissionsFor(FoxpostSettlementController.prototype.list),
      [PERMISSIONS.FINANCE_VIEW],
    );
    assert.deepEqual(
      permissionsFor(FoxpostSettlementController.prototype.detail),
      [PERMISSIONS.FINANCE_VIEW],
    );
    assert.deepEqual(
      permissionsFor(FoxpostSettlementController.prototype.reports),
      [PERMISSIONS.FINANCE_VIEW],
    );
    assert.deepEqual(
      permissionsFor(FoxpostSettlementController.prototype.downloadReport),
      [PERMISSIONS.FINANCE_VIEW],
    );
  });

  it("uses finance.manage for Gmail sync, reprocessing and manual approval", () => {
    assert.deepEqual(
      permissionsFor(FoxpostSettlementController.prototype.sync),
      [PERMISSIONS.FINANCE_MANAGE],
    );
    assert.deepEqual(
      permissionsFor(FoxpostSettlementController.prototype.reprocess),
      [PERMISSIONS.FINANCE_MANAGE],
    );
    assert.deepEqual(
      permissionsFor(FoxpostSettlementController.prototype.approveLine),
      [PERMISSIONS.FINANCE_MANAGE],
    );
  });
});
