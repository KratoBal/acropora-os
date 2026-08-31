import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@acropora/database";
import type { CreatePosSaleInput, PosSaleStockWarning } from "@acropora/types";

import type {
  CreatePosSaleParams,
  CreatePosSaleResult,
  PosSaleRepository,
  PosSaleVariantInfo,
} from "./pos-sale.repository.js";
import { PosSaleService } from "./pos-sale.service.js";

/**
 * A TESZT SAJAT MENNYISEGE, ES MIERT NEM A TIPUSBOL JON.
 *
 * A `currentQty` 2026-08-31-ig a PosSaleVariantInfo mezoje volt, es a
 * termeleskodban SENKI nem olvasta: az egyetlen olvasojat a 819c833 vette ki
 * 2026-07-29-en, amikor a tranzakcio elotti becslest lecsereltek a zar alatt
 * szamitott ertekre. A mezo torolve lett; a hamis repository viszont tovabbra
 * is szimulalni akarja, MIT jelentene vissza az igazi, ezert sajat fixturaban
 * tartja a mennyiseget. Igy a teszt szandeka valtozatlan, es a termeleskod nem
 * hordoz olyan mezot, amit csak tesztek olvasnak.
 */
type TestVariantInfo = PosSaleVariantInfo & { currentQty: Prisma.Decimal };

function variant(overrides: Partial<TestVariantInfo> = {}): TestVariantInfo {
  return {
    variantId: "variant-1",
    sku: "REEF-SALT-01",
    productName: "Reef Salt",
    unit: "db",
    vatRate: new Prisma.Decimal("27"),
    currentQty: new Prisma.Decimal("10"),
    syncToUnas: true,
    stockComponents: [
      {
        variantId: "variant-1",
        sku: "REEF-SALT-01",
        productName: "Reef Salt",
        unit: "db",
        quantityPerSale: new Prisma.Decimal(1),
        syncToUnas: true,
      },
    ],
    ...overrides,
  };
}

/// A repository VALASZA, ahogy egy sikeres mentes utan kinez. Kulon fuggveny,
/// mert nemcsak az alapertelmezett hamis repository hasznalja: az utkozest
/// jatszo tesztek is ezt adjak vissza a masodik kiserletnel.
function fakeSaleResult(
  params: CreatePosSaleParams,
  variants: Map<string, TestVariantInfo>,
): CreatePosSaleResult {
  const stockWarnings: PosSaleStockWarning[] = [];
  for (const line of params.lines) {
    const info = variants.get(line.variantId);
    const resultingQty = (info?.currentQty ?? new Prisma.Decimal(0)).minus(
      line.quantity,
    );
    if (resultingQty.isNegative()) {
      stockWarnings.push({
        sku: line.sku,
        productName: line.productName,
        resultingQty: resultingQty.toString(),
      });
    }
  }

  return {
    detail: {
      id: "sale-1",
      orderNumber: params.orderNumber,
      status: "COMPLETED",
      paymentMethod: params.paymentMethod,
      customerName: null,
      soldByName: null,
      currency: "HUF",
      totalNet: params.totals.totalNet.toString(),
      totalTax: params.totals.totalTax.toString(),
      totalGross: params.totals.totalGross.toString(),
      discountPercent: params.discountPercent?.toString() ?? null,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      lines: params.lines.map((line, index) => ({
        id: `line-${index}`,
        variantId: line.variantId,
        sku: line.sku,
        productName: line.productName,
        quantity: line.quantity.toString(),
        unit: line.unit,
        unitNet: line.unitNet.toString(),
        taxRate: line.taxRate.toString(),
        lineGross: line.lineGross.toString(),
        discountPercent: line.discountPercent?.toString() ?? null,
        syncStatus: "PENDING" as const,
        syncError: null,
      })),
    },
    stockWarnings,
  };
}

function buildService(options: {
  variants: Map<string, TestVariantInfo>;
  warehouseId?: string;
  createSale?: (params: CreatePosSaleParams) => Promise<CreatePosSaleResult>;
}) {
  let capturedCreateSaleParams: CreatePosSaleParams | undefined;
  let currentStockCallCount = 0;
  // No UnasApiClient/UnasAuthService dependency anymore - PosSaleService no
  // longer talks to UNAS synchronously at all (see pos-sale.service.ts
  // constructor comment). The default fake createSale below stands in for
  // PosSaleRepository.createSale, whose real implementation now computes
  // stockWarnings from postInventoryMovement's actual, under-lock resulting
  // onHand rather than a pre-transaction read - this fake mirrors that by
  // computing resultingQty from the variant's currentQty at "call time"
  // (still a simplification vs. the real lock-serialized writer, but
  // sufficient to prove the service no longer computes warnings itself).
  const repository = {
    currentStock: async () => {
      currentStockCallCount += 1;
      return {
        warehouseId: options.warehouseId ?? "warehouse-1",
        variants: options.variants,
      };
    },
    createSale: async (params: CreatePosSaleParams) => {
      capturedCreateSaleParams = params;
      if (options.createSale) return options.createSale(params);
      return fakeSaleResult(params, options.variants);
    },
  } as unknown as PosSaleRepository;
  const service = new PosSaleService(repository);
  return {
    service,
    getCapturedCreateSaleParams: () => capturedCreateSaleParams,
    getCurrentStockCallCount: () => currentStockCallCount,
  };
}

function baseInput(
  overrides: Partial<CreatePosSaleInput> = {},
): CreatePosSaleInput {
  return {
    paymentMethod: "CASH",
    lines: [{ variantId: "variant-1", quantity: 1, unitGross: 127 }],
    ...overrides,
  };
}

describe("PosSaleService.createSale", () => {
  it("rejects an unknown variant", async () => {
    const { service } = buildService({ variants: new Map() });
    await assert.rejects(() => service.createSale(baseInput(), "user-1"));
  });

  it("rejects a local Acropora OS product until the POS channel is explicitly enabled", async () => {
    const { service } = buildService({
      variants: new Map([
        [
          "variant-local",
          variant({
            variantId: "variant-local",
            sku: "LOCAL-1",
            syncToUnas: false,
          }),
        ],
      ]),
    });

    await assert.rejects(() =>
      service.createSale(
        baseInput({
          lines: [
            {
              variantId: "variant-local",
              quantity: 1,
              unitGross: 127,
            },
          ],
        }),
        "user-1",
      ),
    );
  });

  it("rejects a variant with no configured VAT rate", async () => {
    const { service } = buildService({
      variants: new Map([["variant-1", variant({ vatRate: null })]]),
    });
    await assert.rejects(() => service.createSale(baseInput(), "user-1"));
  });

  it("rejects a non-positive quantity", async () => {
    const { service } = buildService({
      variants: new Map([["variant-1", variant()]]),
    });
    await assert.rejects(() =>
      service.createSale(
        baseInput({
          lines: [{ variantId: "variant-1", quantity: 0, unitGross: 127 }],
        }),
        "user-1",
      ),
    );
  });

  it("splits a 27% VAT gross price into net/tax correctly", async () => {
    const { service, getCapturedCreateSaleParams } = buildService({
      variants: new Map([["variant-1", variant()]]),
    });

    await service.createSale(
      baseInput({
        lines: [{ variantId: "variant-1", quantity: 2, unitGross: 127 }],
      }),
      "user-1",
    );

    const params = getCapturedCreateSaleParams();
    assert.equal(params?.totals.totalNet.toString(), "200");
    assert.equal(params?.totals.totalTax.toString(), "54");
    assert.equal(params?.totals.totalGross.toString(), "254");
  });

  it("applies the line discount before the order discount and persists both percentages", async () => {
    const { service, getCapturedCreateSaleParams } = buildService({
      variants: new Map([["variant-1", variant()]]),
    });

    await service.createSale(
      baseInput({
        discountPercent: 20,
        lines: [
          {
            variantId: "variant-1",
            quantity: 2,
            unitGross: 127,
            discountPercent: 10,
          },
        ],
      }),
      "user-1",
    );

    const params = getCapturedCreateSaleParams();
    assert.equal(params?.lines[0]?.discountPercent?.toString(), "10");
    assert.equal(params?.lines[0]?.lineGross.toString(), "228.6");
    assert.equal(params?.discountPercent?.toString(), "20");
    assert.equal(params?.totals.totalNet.toString(), "144");
    assert.equal(params?.totals.totalTax.toString(), "38.88");
    assert.equal(params?.totals.totalGross.toString(), "182.88");
  });

  it("rejects discounts outside the 0-100 percent range", async () => {
    const { service } = buildService({
      variants: new Map([["variant-1", variant()]]),
    });

    await assert.rejects(() =>
      service.createSale(
        baseInput({
          lines: [
            {
              variantId: "variant-1",
              quantity: 1,
              unitGross: 127,
              discountPercent: 101,
            },
          ],
        }),
        "user-1",
      ),
    );
    await assert.rejects(() =>
      service.createSale(baseInput({ discountPercent: -1 }), "user-1"),
    );
  });

  it("does not compute resultingQty/warnings itself anymore - it just forwards lines and returns whatever the repository (i.e. the writer) reports back", async () => {
    const { service } = buildService({
      variants: new Map([
        ["variant-1", variant({ currentQty: new Prisma.Decimal("1") })],
      ]),
    });

    const result = await service.createSale(
      baseInput({
        lines: [{ variantId: "variant-1", quantity: 3, unitGross: 127 }],
      }),
      "user-1",
    );

    assert.equal(result.stockWarnings.length, 1);
    assert.equal(result.stockWarnings[0]?.resultingQty, "-2");
  });

  it("negative stock never blocks the sale - the warning is informational and the sale still completes", async () => {
    const { service } = buildService({
      variants: new Map([
        ["variant-1", variant({ currentQty: new Prisma.Decimal("0") })],
      ]),
    });

    const result = await service.createSale(
      baseInput({
        lines: [{ variantId: "variant-1", quantity: 5, unitGross: 127 }],
      }),
      "user-1",
    );

    assert.equal(result.detail.status, "COMPLETED");
    assert.equal(result.stockWarnings.length, 1);
  });

  it("merges duplicate variantId cart lines into a single quantity", async () => {
    const { service, getCapturedCreateSaleParams } = buildService({
      variants: new Map([["variant-1", variant()]]),
    });

    await service.createSale(
      baseInput({
        lines: [
          { variantId: "variant-1", quantity: 1, unitGross: 100 },
          { variantId: "variant-1", quantity: 2, unitGross: 110 },
        ],
      }),
      "user-1",
    );

    const params = getCapturedCreateSaleParams();
    assert.equal(params?.lines.length, 1);
    assert.equal(params?.lines[0]?.quantity.toString(), "3");
  });

  it("always reports successCount = line count and failedCount = 0 - a real posting failure now throws and rolls back the whole transaction instead of a per-line synchronous UNAS failure (see pos-sale.repository.ts)", async () => {
    const { service } = buildService({
      variants: new Map([
        ["variant-1", variant({ sku: "REEF-SALT-01" })],
        ["variant-2", variant({ variantId: "variant-2", sku: "PUMP-XL" })],
      ]),
    });

    const result = await service.createSale(
      baseInput({
        lines: [
          { variantId: "variant-1", quantity: 1, unitGross: 127 },
          { variantId: "variant-2", quantity: 1, unitGross: 127 },
        ],
      }),
      "user-1",
    );

    assert.equal(result.successCount, 2);
    assert.equal(result.failedCount, 0);
  });

  it("propagates a repository-level failure (e.g. a rolled-back transaction) instead of swallowing it into a per-line failedCount", async () => {
    const { service } = buildService({
      variants: new Map([["variant-1", variant()]]),
      createSale: async () => {
        throw new Error("simulated posting failure");
      },
    });

    await assert.rejects(() => service.createSale(baseInput(), "user-1"));
  });
  /**
   * AZ ELADAS SZAMANAK UTKOZESE. A POS a legnagyobb forgalmu csalad: ket
   * eladas eshet ugyanabba a masodpercbe, es huzhatja ugyanazt a negyjegyu
   * veget. Ma a masodik hibaval vegzodik, es az eladonak kell ujraprobalnia,
   * a vevo elott.
   */
  it("mints a new order number when the first one is already taken", async () => {
    const seen: string[] = [];
    const { service } = buildService({
      variants: new Map([["variant-1", variant()]]),
      createSale: async (params) => {
        seen.push(params.orderNumber);
        if (seen.length === 1)
          throw { code: "P2002", meta: { target: ["orderNumber"] } };
        return fakeSaleResult(params, new Map([["variant-1", variant()]]));
      },
    });

    const result = await service.createSale(baseInput(), "user-1");

    assert.equal(seen.length, 2);
    // A masodik kiserlet MAS szamot visz be. Ha a szam a lezaron kivul
    // keletkezne, itt ketszer ugyanaz allna.
    assert.notEqual(seen[0], seen[1]);
    assert.equal(result.detail.orderNumber, seen[1]);
  });

  /**
   * AMI A LEZAR MERETET ORZI. Az ujraprobalas csak a MENTEST ismetli meg. Az
   * arazas, a keszlet-lekerdezes es az ellenorzesek folotte valtozatlanul
   * egyszer futnak.
   */
  it("repeats only the write, not the pricing above it", async () => {
    const seen: string[] = [];
    const { service, getCurrentStockCallCount } = buildService({
      variants: new Map([["variant-1", variant()]]),
      createSale: async (params) => {
        seen.push(params.orderNumber);
        if (seen.length <= 2)
          throw { code: "P2002", meta: { target: ["orderNumber"] } };
        return fakeSaleResult(params, new Map([["variant-1", variant()]]));
      },
    });

    await service.createSale(baseInput(), "user-1");

    assert.equal(seen.length, 3);
    assert.equal(getCurrentStockCallCount(), 1);
  });

  /**
   * AMIT SZANDEKOSAN ATENGED. A keszlet-mozgas szama a repository sajat
   * tranzakciojaban keletkezik, es az ottani burkolat dolga. Ez a reteg nem
   * huz hozza ujra eladas-szamot: az egy dragabb ujrafuttatas lenne ugyanarra
   * a hibara.
   */
  it("does not retry a movement-number violation at this layer", async () => {
    let calls = 0;
    const error = { code: "P2002", meta: { target: ["movementNumber"] } };
    const { service } = buildService({
      variants: new Map([["variant-1", variant()]]),
      createSale: async () => {
        calls += 1;
        throw error;
      },
    });

    await assert.rejects(
      () => service.createSale(baseInput(), "user-1"),
      (thrown) => thrown === error,
    );

    assert.equal(calls, 1);
  });

  /**
   * A HATAR. Az otodik kiserlet utan az eredeti adatbazis-hiba megy tovabb,
   * valtozatlanul - vagyis a legrosszabb eset pontosan a mai viselkedes.
   */
  it("gives the original error back when every attempt loses", async () => {
    let calls = 0;
    const error = { code: "P2002", meta: { target: ["orderNumber"] } };
    const { service } = buildService({
      variants: new Map([["variant-1", variant()]]),
      createSale: async () => {
        calls += 1;
        throw error;
      },
    });

    await assert.rejects(
      () => service.createSale(baseInput(), "user-1"),
      (thrown) => thrown === error,
    );

    assert.equal(calls, 5);
  });
});
