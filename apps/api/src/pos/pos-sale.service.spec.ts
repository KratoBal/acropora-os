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

function variant(
  overrides: Partial<PosSaleVariantInfo> = {},
): PosSaleVariantInfo {
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

function buildService(options: {
  variants: Map<string, PosSaleVariantInfo>;
  warehouseId?: string;
  createSale?: (params: CreatePosSaleParams) => Promise<CreatePosSaleResult>;
}) {
  let capturedCreateSaleParams: CreatePosSaleParams | undefined;
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
    currentStock: async () => ({
      warehouseId: options.warehouseId ?? "warehouse-1",
      variants: options.variants,
    }),
    createSale: async (params: CreatePosSaleParams) => {
      capturedCreateSaleParams = params;
      if (options.createSale) return options.createSale(params);

      const stockWarnings: PosSaleStockWarning[] = [];
      for (const line of params.lines) {
        const info = options.variants.get(line.variantId);
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
            syncStatus: "PENDING" as const,
            syncError: null,
          })),
        },
        stockWarnings,
      };
    },
  } as unknown as PosSaleRepository;
  const service = new PosSaleService(repository);
  return {
    service,
    getCapturedCreateSaleParams: () => capturedCreateSaleParams,
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
});
