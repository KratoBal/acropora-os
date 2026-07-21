import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@acropora/database";
import type { CreatePosSaleInput } from "@acropora/types";

import type { UnasApiClient } from "../imports/unas/unas-api.client.js";
import type { UnasAuthService } from "../imports/unas/unas-auth.service.js";
import type {
  CreatePosSaleParams,
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
    ...overrides,
  };
}

function buildService(options: {
  variants: Map<string, PosSaleVariantInfo>;
  warehouseId?: string;
  setStock?: (
    ...args: Parameters<UnasApiClient["setStock"]>
  ) => ReturnType<UnasApiClient["setStock"]>;
  createSale?: (
    params: CreatePosSaleParams,
  ) => ReturnType<PosSaleRepository["createSale"]>;
}) {
  let capturedCreateSaleParams: CreatePosSaleParams | undefined;
  const repository = {
    currentStock: async () => ({
      warehouseId: options.warehouseId ?? "warehouse-1",
      variants: options.variants,
    }),
    createSale: async (params: CreatePosSaleParams) => {
      capturedCreateSaleParams = params;
      if (options.createSale) return options.createSale(params);
      return {
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
          syncStatus: line.syncStatus,
          syncError: line.syncError,
        })),
      };
    },
  } as unknown as PosSaleRepository;
  const unasApi = {
    setStock:
      options.setStock ??
      (async (_token: string, request: { sku: string }) => ({
        externalId: "1",
        sku: request.sku,
      })),
  } as unknown as UnasApiClient;
  const unasAuth = {
    getToken: async () => "token",
  } as unknown as UnasAuthService;
  const service = new PosSaleService(repository, unasApi, unasAuth);
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

  it("flags a stock warning when the resulting quantity goes negative, but still completes the sale", async () => {
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

  it("keeps going and reports a per-line UNAS push failure without blocking the sale", async () => {
    const { service, getCapturedCreateSaleParams } = buildService({
      variants: new Map([
        ["variant-1", variant({ sku: "REEF-SALT-01" })],
        ["variant-2", variant({ variantId: "variant-2", sku: "PUMP-XL" })],
      ]),
      setStock: async (_token, request) => {
        if (request.sku === "REEF-SALT-01") {
          throw new Error("UNAS_TIMEOUT");
        }
        return { externalId: "1", sku: request.sku };
      },
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

    assert.equal(result.successCount, 1);
    assert.equal(result.failedCount, 1);
    const params = getCapturedCreateSaleParams();
    const failedLine = params?.lines.find(
      (line) => line.sku === "REEF-SALT-01",
    );
    const okLine = params?.lines.find((line) => line.sku === "PUMP-XL");
    assert.equal(failedLine?.syncStatus, "FAILED");
    assert.equal(failedLine?.syncError, "UNAS_TIMEOUT");
    assert.equal(okLine?.syncStatus, "OK");
  });
});
