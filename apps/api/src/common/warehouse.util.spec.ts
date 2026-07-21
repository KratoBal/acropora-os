import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ensureMainWarehouse,
  type WarehouseLookupDatabase,
} from "./warehouse.util.js";

describe("ensureMainWarehouse", () => {
  it("returns the existing warehouse when one is already there", async () => {
    const database: WarehouseLookupDatabase = {
      warehouse: {
        findFirst: async () => ({ id: "warehouse-1", name: "Fő raktár" }),
        create: async () => {
          throw new Error("should not create when a warehouse already exists");
        },
      },
    };

    const result = await ensureMainWarehouse(database);

    assert.deepEqual(result, { id: "warehouse-1", name: "Fő raktár" });
  });

  it("auto-creates the default warehouse when none exists yet", async () => {
    let createArgs: unknown;
    const database: WarehouseLookupDatabase = {
      warehouse: {
        findFirst: async () => null,
        create: async (args) => {
          createArgs = args;
          return { id: "warehouse-new", name: "Fő raktár" };
        },
      },
    };

    const result = await ensureMainWarehouse(database);

    assert.deepEqual(result, { id: "warehouse-new", name: "Fő raktár" });
    assert.deepEqual(createArgs, {
      data: { code: "FO", name: "Fő raktár" },
      select: { id: true, name: true },
    });
  });
});
