import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AuthenticatedUser } from "@acropora/types";

import { ProductController } from "./product.controller.js";
import type { ProductService } from "./product.service.js";

function createController() {
  const calls: Array<{ operation: string; args: unknown[] }> = [];
  const service = {
    listProducts: async (...args: unknown[]) => {
      calls.push({ operation: "list", args });
      return { items: [] };
    },
    getProduct: async (...args: unknown[]) => {
      calls.push({ operation: "get", args });
      return { id: args[0] };
    },
    createProduct: async (...args: unknown[]) => {
      calls.push({ operation: "create", args });
      return { id: "created" };
    },
    updateProduct: async (...args: unknown[]) => {
      calls.push({ operation: "update", args });
      return { id: args[0] };
    },
    archiveProduct: async (...args: unknown[]) => {
      calls.push({ operation: "archive", args });
      return { id: args[0] };
    },
  } as unknown as ProductService;
  return { controller: new ProductController(service), calls };
}

const user: AuthenticatedUser = {
  id: "user-1",
  email: "admin@acropora.local",
  displayName: "Admin",
  role: "ADMIN",
};

describe("ProductController", () => {
  it("forwards list and detail requests", async () => {
    const { controller, calls } = createController();
    const query = { page: 1, pageSize: 20 };
    await controller.listProducts(query);
    await controller.getProduct("product-1");
    assert.deepEqual(
      calls.map((call) => call.operation),
      ["list", "get"],
    );
  });

  it("passes the current actor to product creation", async () => {
    const { controller, calls } = createController();
    const input = { name: "Reef Salt", productType: "PHYSICAL" } as const;
    await controller.createProduct(input, user);
    assert.deepEqual(calls[0]?.args, [input, "user-1"]);
  });

  it("forwards update and soft archive operations", async () => {
    const { controller, calls } = createController();
    await controller.updateProduct("product-1", { name: "Updated" });
    await controller.archiveProduct("product-1");
    assert.deepEqual(
      calls.map((call) => call.operation),
      ["update", "archive"],
    );
  });
});
