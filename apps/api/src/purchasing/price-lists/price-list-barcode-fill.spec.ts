import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Prisma } from "@acropora/database";

import { fillBarcodeFromPair } from "./price-list-barcode-fill.js";

/**
 * A VONALKÓD-PÓTLÁS A JÓVÁHAGYOTT PÁRNÁL (task arlista-vonalkod-potlas). Kitalált
 * kódok, érvényes ellenőrző számjegyekkel. MI PIROSÍT: ha a változat meglévő
 * vonalkódja mellé vagy helyére írna; ha érvénytelen kódot vinne a törzsbe; ha egy
 * másik változaté kódot adna oda; ha a vonalkód nélküli lista-sorból vonalkódot
 * találna ki; ha a napló vagy a típus, a forrás, az elsődlegesség hiányozna.
 */
const VALID_EAN13 = "4006381333931";
const GTIN14 = `0${VALID_EAN13}`;

function fakeTransaction(options: {
  entryGtin?: string | null;
  variantBarcodes?: number;
  ownedCode?: boolean;
}) {
  const created: Record<string, unknown>[] = [];
  const logs: Record<string, unknown>[] = [];
  const lookups: unknown[] = [];
  const transaction = {
    supplierPriceListEntry: {
      findFirst: async (args: unknown) => {
        lookups.push(args);
        return options.entryGtin === undefined
          ? { gtin: GTIN14 }
          : options.entryGtin === null
            ? null
            : { gtin: options.entryGtin };
      },
    },
    productBarcode: {
      count: async () => options.variantBarcodes ?? 0,
      findFirst: async () => (options.ownedCode ? { id: "other" } : null),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: "bc-1" };
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) =>
        void logs.push(data),
    },
  };
  return {
    transaction: transaction as unknown as Prisma.TransactionClient,
    created,
    logs,
    lookups,
  };
}

const input = {
  userId: "u-1",
  suggestionId: "sg-1",
  supplierId: "sup-1",
  supplierSku: "H-1",
  variantId: "v-1",
};

describe("fillBarcodeFromPair", () => {
  it("gives a variant without any barcode the supplier's, stored as the package shows it, primary, typed, sourced, and logged", async () => {
    const { transaction, created, logs } = fakeTransaction({});
    assert.equal(await fillBarcodeFromPair(transaction, input), "ADDED");
    assert.deepEqual(created, [
      {
        variantId: "v-1",
        code: VALID_EAN13,
        isPrimary: true,
        type: "EAN13",
        source: "IMPORT",
      },
    ]);
    assert.equal(logs.length, 1);
    assert.equal(logs[0]!.action, "product-barcode.added-from-price-list");
    assert.deepEqual(logs[0]!.metadata, {
      variantId: "v-1",
      code: VALID_EAN13,
      supplierId: "sup-1",
      supplierSku: "H-1",
      suggestionId: "sg-1",
    });
  });

  it("looks the barcode up on the supplier's own rows for this sku only", async () => {
    const { transaction, lookups } = fakeTransaction({});
    await fillBarcodeFromPair(transaction, input);
    assert.deepEqual((lookups[0] as { where: unknown }).where, {
      supplierSku: "H-1",
      gtin: { not: null },
      list: { supplierId: "sup-1" },
    });
  });

  it("never overwrites or adds beside a variant that already has a barcode", async () => {
    const { transaction, created, logs } = fakeTransaction({
      variantBarcodes: 1,
    });
    assert.equal(
      await fillBarcodeFromPair(transaction, input),
      "VARIANT_HAS_BARCODE",
    );
    assert.deepEqual([created, logs], [[], []]);
  });

  it("writes nothing for a list row without a barcode", async () => {
    const { transaction, created } = fakeTransaction({ entryGtin: null });
    assert.equal(await fillBarcodeFromPair(transaction, input), "NO_BARCODE");
    assert.deepEqual(created, []);
  });

  it("writes nothing for a code with a wrong check digit or a shop-internal range", async () => {
    for (const bad of ["04006381333932", "02000000000008", "00000000000000"]) {
      const { transaction, created } = fakeTransaction({ entryGtin: bad });
      assert.equal(
        await fillBarcodeFromPair(transaction, input),
        "INVALID",
        bad,
      );
      assert.deepEqual(created, [], bad);
    }
  });

  it("writes nothing when another variant already owns the code in any form", async () => {
    const { transaction, created } = fakeTransaction({ ownedCode: true });
    assert.equal(
      await fillBarcodeFromPair(transaction, input),
      "OWNED_BY_OTHER",
    );
    assert.deepEqual(created, []);
  });
});
