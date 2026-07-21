import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PERMISSIONS } from "@acropora/types";

import { REQUIRED_PERMISSIONS_KEY } from "../auth/decorators/require-permissions.decorator.js";
import { PosController } from "./pos.controller.js";
import type { PosProductSearchService } from "./pos-product-search.service.js";
import type { PosSaleService } from "./pos-sale.service.js";

function permissionsFor(method: (...args: never[]) => unknown) {
  return Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, method);
}

describe("PosController permissions", () => {
  it("requires orders.view to search products and read sales", () => {
    assert.deepEqual(permissionsFor(PosController.prototype.searchProducts), [
      PERMISSIONS.ORDERS_VIEW,
    ]);
    assert.deepEqual(permissionsFor(PosController.prototype.listSales), [
      PERMISSIONS.ORDERS_VIEW,
    ]);
    assert.deepEqual(permissionsFor(PosController.prototype.getSale), [
      PERMISSIONS.ORDERS_VIEW,
    ]);
  });

  it("requires orders.manage to record a new sale", () => {
    assert.deepEqual(permissionsFor(PosController.prototype.createSale), [
      PERMISSIONS.ORDERS_MANAGE,
    ]);
  });
});

describe("PosController delegation", () => {
  it("passes the current user's id when recording a sale", async () => {
    let capturedUserId: string | undefined;
    const controller = new PosController(
      {} as PosProductSearchService,
      {
        createSale: async (_input: unknown, userId: string) => {
          capturedUserId = userId;
          return {
            detail: {},
            stockWarnings: [],
            successCount: 0,
            failedCount: 0,
          };
        },
      } as unknown as PosSaleService,
    );

    await controller.createSale({ paymentMethod: "CASH", lines: [] }, {
      id: "user-42",
    } as never);

    assert.equal(capturedUserId, "user-42");
  });

  it("passes the q query param through to the search service", async () => {
    let capturedQuery: string | undefined;
    const controller = new PosController(
      {
        search: async (q: string | undefined) => {
          capturedQuery = q;
          return [];
        },
      } as unknown as PosProductSearchService,
      {} as PosSaleService,
    );

    await controller.searchProducts({ q: "reef" });

    assert.equal(capturedQuery, "reef");
  });
});
