import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { REQUIRED_PERMISSIONS_KEY } from "../auth/decorators/require-permissions.decorator.js";
import {
  MAX_OUTBOX_OFFSET,
  parseLimit,
  parseOffset,
  UnasStockSyncOutboxController,
} from "./unas-stock-sync-outbox.controller.js";
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

/*
  A LAPOZÁS KEZDETE (Picasso 3.27, acrobot 62278). MI PIROSÍT: ha a lista `limit` egyedül már nem az első oldalt adja; ha egy hibás `offset` (szöveg, tört, negatív) hibát dob az első oldal helyett;
  ha egy óriási `offset` korlát nélkül megy a lekérdezésbe; ha az `offset` nem jut el a tárolóig.
*/
describe("UnasStockSyncOutboxController paging", () => {
  it("the limit is 50 by default and 200 at most, as it always was", () => {
    assert.equal(parseLimit(undefined), 50);
    assert.equal(parseLimit("abc"), 50);
    assert.equal(parseLimit("0"), 50);
    assert.equal(parseLimit("-3"), 50);
    assert.equal(parseLimit("25"), 25);
    assert.equal(parseLimit("9999"), 200);
  });

  it("the offset is a non-negative whole number; anything else is the first page, not an error", () => {
    assert.equal(parseOffset(undefined), 0);
    assert.equal(parseOffset(""), 0);
    assert.equal(parseOffset("abc"), 0);
    assert.equal(parseOffset("-5"), 0);
    assert.equal(parseOffset("1.5"), 0);
    assert.equal(parseOffset("0"), 0);
    assert.equal(parseOffset("50"), 50);
    assert.equal(parseOffset("999999999999"), MAX_OUTBOX_OFFSET);
  });

  it("list() passes the status, the limit and the offset to the repository", () => {
    let captured: unknown;
    const controller = new UnasStockSyncOutboxController(
      {
        list: (params: unknown) => {
          captured = params;
          return [];
        },
      } as unknown as UnasStockSyncOutboxRepository,
      {} as UnasStockSyncOutboxScheduler,
    );

    controller.list("FAILED", "25", "50");
    assert.deepEqual(captured, { status: "FAILED", limit: 25, offset: 50 });
    // an old caller: only the limit; the offset is the first page
    controller.list(undefined, "10", undefined);
    assert.deepEqual(captured, { status: undefined, limit: 10, offset: 0 });
  });
});
