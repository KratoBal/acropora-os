import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PERMISSIONS } from "@acropora/types";

import { REQUIRED_PERMISSIONS_KEY } from "../auth/decorators/require-permissions.decorator.js";
import { InventoryCountController } from "./inventory-count.controller.js";
import type { InventoryCountService } from "./inventory-count.service.js";

function permissionsFor(method: (...args: never[]) => unknown) {
  return Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, method);
}

describe("InventoryCountController permissions", () => {
  it("requires inventory.view to list and read counts", () => {
    assert.deepEqual(permissionsFor(InventoryCountController.prototype.list), [
      PERMISSIONS.INVENTORY_VIEW,
    ]);
    assert.deepEqual(
      permissionsFor(InventoryCountController.prototype.detail),
      [PERMISSIONS.INVENTORY_VIEW],
    );
    assert.deepEqual(
      permissionsFor(InventoryCountController.prototype.downloadTemplate),
      [PERMISSIONS.INVENTORY_VIEW],
    );
  });

  it("requires inventory.manage to start, upload and apply counts", () => {
    assert.deepEqual(
      permissionsFor(InventoryCountController.prototype.create),
      [PERMISSIONS.INVENTORY_MANAGE],
    );
    assert.deepEqual(
      permissionsFor(InventoryCountController.prototype.upload),
      [PERMISSIONS.INVENTORY_MANAGE],
    );
    assert.deepEqual(
      permissionsFor(InventoryCountController.prototype.updateLine),
      [PERMISSIONS.INVENTORY_MANAGE],
    );
    assert.deepEqual(permissionsFor(InventoryCountController.prototype.apply), [
      PERMISSIONS.INVENTORY_MANAGE,
    ]);
  });
});

describe("InventoryCountController delegation", () => {
  it("passes the current user's id when starting a new count", async () => {
    let capturedUserId: string | undefined;
    const controller = new InventoryCountController({
      createCount: async (userId: string) => {
        capturedUserId = userId;
        return { id: "count-1" };
      },
    } as unknown as InventoryCountService);

    await controller.create({ id: "user-42" } as never);

    assert.equal(capturedUserId, "user-42");
  });

  it("passes the uploaded file's buffer to the service", async () => {
    let capturedBuffer: Buffer | undefined;
    const controller = new InventoryCountController({
      uploadCounts: async (_id: string, buffer: Buffer) => {
        capturedBuffer = buffer;
        return { detail: {}, unmatchedRows: [] };
      },
    } as unknown as InventoryCountService);

    const file = { buffer: Buffer.from("test") } as Express.Multer.File;
    await controller.upload("count-1", file);

    assert.equal(capturedBuffer?.toString(), "test");
  });

  it("passes id, lineId and counted quantity when editing a single line", async () => {
    let captured: [string, string, number] | undefined;
    const controller = new InventoryCountController({
      updateLineCount: async (id: string, lineId: string, qty: number) => {
        captured = [id, lineId, qty];
        return {};
      },
    } as unknown as InventoryCountService);

    await controller.updateLine("count-1", "line-1", { countedQty: 9 });

    assert.deepEqual(captured, ["count-1", "line-1", 9]);
  });
});
