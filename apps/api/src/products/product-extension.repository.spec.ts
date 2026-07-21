import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import {
  type ProductExtensionDatabase,
  ProductExtensionRepository,
} from "./product-extension.repository.js";

const extension = (overrides: Record<string, unknown> = {}) => ({
  id: "extension-1",
  variantId: "variant-1",
  preferredSupplierId: null,
  defaultPurchaseCurrency: "EUR",
  defaultWarehouseId: null,
  defaultLocationId: null,
  minimumStock: new Prisma.Decimal("2"),
  optimalStock: null,
  reorderPoint: new Prisma.Decimal("3"),
  safetyStock: null,
  lastPurchaseNetPrice: null,
  lastPurchaseVatRate: null,
  stockTrackingEnabled: true,
  purchasingDisabled: false,
  phaseOut: false,
  autoReorderEnabled: false,
  internalNote: "secret internal note",
  createdAt: new Date("2026-07-20T10:00:00.000Z"),
  updatedAt: new Date("2026-07-20T10:00:00.000Z"),
  ...overrides,
});

function fixture(existing: ReturnType<typeof extension> | null) {
  const calls: Array<{ operation: string; args: unknown }> = [];
  const updated = extension({ minimumStock: new Prisma.Decimal("4") });
  const transaction = {
    productExtension: {
      findUnique: async () => existing,
      upsert: async (args: unknown) => {
        calls.push({ operation: "upsert", args });
        return updated;
      },
    },
    auditLog: {
      create: async (args: unknown) => {
        calls.push({ operation: "audit", args });
        return {};
      },
    },
    domainEvent: {
      create: async (args: unknown) => {
        calls.push({ operation: "event", args });
        return {};
      },
    },
  };
  const database = {
    productVariant: { findUnique: async () => ({ id: "variant-1" }) },
    productExtension: { findUnique: async () => existing },
    $transaction: (operation: (tx: typeof transaction) => Promise<unknown>) =>
      operation(transaction),
  } as ProductExtensionDatabase;
  return { repository: new ProductExtensionRepository(database), calls };
}

describe("ProductExtensionRepository audit", () => {
  it("writes the mutation, audit and event in one transaction without values", async () => {
    const { repository, calls } = fixture(extension());
    await repository.upsert(
      "variant-1",
      { minimumStock: "4", internalNote: "new confidential note" },
      "user-1",
    );

    assert.deepEqual(
      calls.map((call) => call.operation),
      ["upsert", "audit", "event"],
    );
    const audit = calls[1]!.args as {
      data: {
        userId: string;
        action: string;
        metadata: { changedFields: string[] };
      };
    };
    assert.equal(audit.data.userId, "user-1");
    assert.equal(audit.data.action, "product_extension.updated");
    assert.deepEqual(audit.data.metadata.changedFields, [
      "minimumStock",
      "internalNote",
    ]);
    assert.equal(JSON.stringify(audit).includes("confidential"), false);
  });

  it("does not write audit or event for an unchanged update", async () => {
    const { repository, calls } = fixture(extension());
    const result = await repository.upsert(
      "variant-1",
      { minimumStock: "2", autoReorderEnabled: false },
      "user-1",
    );

    assert.equal(result.minimumStock, "2");
    assert.deepEqual(calls, []);
  });
});
