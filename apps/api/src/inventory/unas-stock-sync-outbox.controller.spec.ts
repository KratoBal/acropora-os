import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { REQUIRED_PERMISSIONS_KEY } from "../auth/decorators/require-permissions.decorator.js";
import { UnasStockSyncOutboxController } from "./unas-stock-sync-outbox.controller.js";
import type { UnasStockSyncOutboxRepository } from "./unas-stock-sync-outbox.repository.js";
import type { UnasStockSyncOutboxScheduler } from "./unas-stock-sync-outbox.scheduler.js";

function permissionsFor(method: (...args: never[]) => unknown) {
  return Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, method);
}

describe("UnasStockSyncOutboxController permissions", () => {
  it("requires inventory.view for read endpoints", () => {
    assert.deepEqual(
      permissionsFor(UnasStockSyncOutboxController.prototype.summary),
      [PERMISSIONS.INVENTORY_VIEW],
    );
    assert.deepEqual(
      permissionsFor(UnasStockSyncOutboxController.prototype.list),
      [PERMISSIONS.INVENTORY_VIEW],
    );
    assert.deepEqual(
      permissionsFor(UnasStockSyncOutboxController.prototype.getOne),
      [PERMISSIONS.INVENTORY_VIEW],
    );
  });

  it("requires inventory.manage for retry and manual run (both mutate / trigger a UNAS write)", () => {
    assert.deepEqual(
      permissionsFor(UnasStockSyncOutboxController.prototype.retry),
      [PERMISSIONS.INVENTORY_MANAGE],
    );
    assert.deepEqual(
      permissionsFor(UnasStockSyncOutboxController.prototype.run),
      [PERMISSIONS.INVENTORY_MANAGE],
    );
  });
});

describe("UnasStockSyncOutboxController delegation", () => {
  it("retry() passes the acting user's id through to the repository", async () => {
    let capturedArgs: unknown[] = [];
    const controller = new UnasStockSyncOutboxController(
      {
        manualRetry: async (...args: unknown[]) => {
          capturedArgs = args;
          return { retried: true, status: "PENDING" };
        },
      } as unknown as UnasStockSyncOutboxRepository,
      {} as UnasStockSyncOutboxScheduler,
    );

    const user = { id: "user-1" } as AuthenticatedUser;
    const result = await controller.retry("outbox-1", user);

    assert.deepEqual(result, { retried: true, status: "PENDING" });
    assert.deepEqual(capturedArgs, ["outbox-1", "user-1"]);
  });

  it("run() delegates to the scheduler's runOnce (same path the scheduled tick uses)", async () => {
    let called = false;
    const controller = new UnasStockSyncOutboxController(
      {} as UnasStockSyncOutboxRepository,
      {
        runOnce: async () => {
          called = true;
          return "DISABLED" as const;
        },
      } as unknown as UnasStockSyncOutboxScheduler,
    );

    assert.equal(await controller.run(), "DISABLED");
    assert.equal(called, true);
  });
});
