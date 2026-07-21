import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@acropora/database";

import {
  setStockItemQuantity,
  type StockItemWriterDatabase,
} from "./stock-item-writer.js";

describe("setStockItemQuantity", () => {
  it("updates the existing row by id when one is found via plain field filters", async () => {
    const updates: unknown[] = [];
    const finds: unknown[] = [];
    const database: StockItemWriterDatabase = {
      stockItem: {
        findFirst: async (args) => {
          finds.push(args);
          return { id: "stock-item-1" };
        },
        update: async (args) => {
          updates.push(args);
          return {};
        },
        create: async () => {
          throw new Error("should not create when a row already exists");
        },
      },
    };

    await setStockItemQuantity(database, {
      variantId: "variant-1",
      warehouseId: "warehouse-1",
      onHand: new Prisma.Decimal("7"),
    });

    assert.deepEqual(finds, [
      {
        where: {
          variantId: "variant-1",
          warehouseId: "warehouse-1",
          locationId: null,
          lotId: null,
        },
        select: { id: true },
      },
    ]);
    assert.deepEqual(updates, [
      {
        where: { id: "stock-item-1" },
        data: { onHand: new Prisma.Decimal("7") },
      },
    ]);
  });

  it("creates a new row when none exists yet, instead of upserting on a null compound key", async () => {
    const creates: unknown[] = [];
    const database: StockItemWriterDatabase = {
      stockItem: {
        findFirst: async () => null,
        update: async () => {
          throw new Error("should not update when no row exists");
        },
        create: async (args) => {
          creates.push(args);
          return {};
        },
      },
    };

    await setStockItemQuantity(database, {
      variantId: "variant-2",
      warehouseId: "warehouse-1",
      onHand: new Prisma.Decimal("3"),
    });

    assert.deepEqual(creates, [
      {
        data: {
          variantId: "variant-2",
          warehouseId: "warehouse-1",
          onHand: new Prisma.Decimal("3"),
        },
      },
    ]);
  });

  it("allows a negative on-hand quantity (stock shortage is a warning, not a hard block)", async () => {
    let capturedOnHand: Prisma.Decimal | undefined;
    const database: StockItemWriterDatabase = {
      stockItem: {
        findFirst: async () => ({ id: "stock-item-1" }),
        update: async (args) => {
          capturedOnHand = (args as { data: { onHand: Prisma.Decimal } }).data
            .onHand;
          return {};
        },
        create: async () => ({}),
      },
    };

    await setStockItemQuantity(database, {
      variantId: "variant-1",
      warehouseId: "warehouse-1",
      onHand: new Prisma.Decimal("-2"),
    });

    assert.equal(capturedOnHand?.toString(), "-2");
  });
});
