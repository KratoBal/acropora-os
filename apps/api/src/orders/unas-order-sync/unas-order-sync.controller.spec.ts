import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NotFoundException } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { REQUIRED_PERMISSIONS_KEY } from "../../auth/decorators/require-permissions.decorator.js";
import type { UnasAuthService } from "../../imports/unas/unas-auth.service.js";
import type { UnasOrderDeletionReconciliationScheduler } from "./unas-order-deletion-reconciliation.scheduler.js";
import { UnasOrderSyncController } from "./unas-order-sync.controller.js";
import type { UnasOrderSyncRepository } from "./unas-order-sync.repository.js";
import type { UnasOrderSyncService } from "./unas-order-sync.service.js";

function permissionsFor(method: (...args: never[]) => unknown) {
  return Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, method);
}

describe("UnasOrderSyncController permissions", () => {
  it("requires orders.manage to trigger a manual sync", () => {
    assert.deepEqual(permissionsFor(UnasOrderSyncController.prototype.run), [
      PERMISSIONS.ORDERS_MANAGE,
    ]);
  });

  it("requires orders.view to read runs and orders", () => {
    assert.deepEqual(permissionsFor(UnasOrderSyncController.prototype.getRun), [
      PERMISSIONS.ORDERS_VIEW,
    ]);
    assert.deepEqual(
      permissionsFor(UnasOrderSyncController.prototype.listRuns),
      [PERMISSIONS.ORDERS_VIEW],
    );
    assert.deepEqual(permissionsFor(UnasOrderSyncController.prototype.list), [
      PERMISSIONS.ORDERS_VIEW,
    ]);
    assert.deepEqual(permissionsFor(UnasOrderSyncController.prototype.getOne), [
      PERMISSIONS.ORDERS_VIEW,
    ]);
  });

  it("requires inventory.view for the stock reconciliation report", () => {
    assert.deepEqual(
      permissionsFor(
        UnasOrderSyncController.prototype.checkStockReconciliation,
      ),
      [PERMISSIONS.INVENTORY_VIEW],
    );
  });

  it("requires orders.manage for the manual single-order refresh - same as the general sync trigger, not orders.view, since it mutates order/invoice/stock state", () => {
    assert.deepEqual(
      permissionsFor(UnasOrderSyncController.prototype.refresh),
      [PERMISSIONS.ORDERS_MANAGE],
    );
  });

  it("requires orders.view for the deletion-reconciliation status, orders.manage to trigger it manually", () => {
    assert.deepEqual(
      permissionsFor(
        UnasOrderSyncController.prototype.deletionReconciliationStatus,
      ),
      [PERMISSIONS.ORDERS_VIEW],
    );
    assert.deepEqual(
      permissionsFor(
        UnasOrderSyncController.prototype.runDeletionReconciliation,
      ),
      [PERMISSIONS.ORDERS_MANAGE],
    );
  });
});

describe("UnasOrderSyncController delegation", () => {
  it("triggers a sync using a server-side token", async () => {
    let receivedToken = "";
    const controller = new UnasOrderSyncController(
      { getToken: async () => "server-token" } as UnasAuthService,
      {
        runIncremental: async (token: string) => {
          receivedToken = token;
          return { runId: "run-1" };
        },
      } as unknown as UnasOrderSyncService,
      {} as UnasOrderSyncRepository,
      {} as UnasOrderDeletionReconciliationScheduler,
    );

    await controller.run();
    assert.equal(receivedToken, "server-token");
  });

  it("raises 404 when an order isn't found", async () => {
    const controller = new UnasOrderSyncController(
      {} as UnasAuthService,
      {} as UnasOrderSyncService,
      { findById: async () => null } as unknown as UnasOrderSyncRepository,
      {} as UnasOrderDeletionReconciliationScheduler,
    );

    await assert.rejects(
      controller.getOne("missing"),
      (error) => error instanceof NotFoundException,
    );
  });

  it("delegates the reconciliation report to the service", async () => {
    let called = false;
    const controller = new UnasOrderSyncController(
      {} as UnasAuthService,
      {
        checkStockReconciliation: async () => {
          called = true;
          return { checkedAt: "", checkedCount: 0, mismatches: [] };
        },
      } as unknown as UnasOrderSyncService,
      {} as UnasOrderSyncRepository,
      {} as UnasOrderDeletionReconciliationScheduler,
    );

    await controller.checkStockReconciliation();
    assert.equal(called, true);
  });

  it("refreshes a single order using a server-side token, delegated to the service", async () => {
    let receivedToken = "";
    let receivedOrderId = "";
    const controller = new UnasOrderSyncController(
      { getToken: async () => "server-token" } as UnasAuthService,
      {
        refreshOrder: async (token: string, orderId: string) => {
          receivedToken = token;
          receivedOrderId = orderId;
          return { id: orderId };
        },
      } as unknown as UnasOrderSyncService,
      {} as UnasOrderSyncRepository,
      {} as UnasOrderDeletionReconciliationScheduler,
    );

    const result = await controller.refresh("order-1");

    assert.equal(receivedToken, "server-token");
    assert.equal(receivedOrderId, "order-1");
    assert.equal((result as { id: string }).id, "order-1");
  });
});
