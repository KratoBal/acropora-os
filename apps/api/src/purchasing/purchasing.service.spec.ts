import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@acropora/database";

import type { CreatePurchaseInvoiceDto } from "./dto/create-purchase-invoice.dto.js";
import type { UnasApiClient } from "../imports/unas/unas-api.client.js";
import type { UnasAuthService } from "../imports/unas/unas-auth.service.js";
import type { MnbExchangeRateService } from "../integrations/mnb/mnb-exchange-rate.service.js";
import type { SuppliersRepository } from "../suppliers/suppliers.repository.js";
import type {
  CreatePurchaseInvoiceParams,
  PurchaseInvoiceRepository,
  PurchaseInvoiceVariantInfo,
} from "./purchase-invoice.repository.js";
import type { PurchaseProductSearchService } from "./purchase-product-search.service.js";
import { PurchasingService } from "./purchasing.service.js";

function variant(
  overrides: Partial<PurchaseInvoiceVariantInfo> = {},
): PurchaseInvoiceVariantInfo {
  return {
    variantId: "variant-1",
    sku: "REEF-SALT-01",
    productName: "Reef Salt",
    unit: "db",
    currentQty: new Prisma.Decimal("10"),
    ...overrides,
  };
}

function buildService(options: {
  variants: Map<string, PurchaseInvoiceVariantInfo>;
  warehouseId?: string;
  supplierExists?: boolean;
  setStock?: (
    ...args: Parameters<UnasApiClient["setStock"]>
  ) => ReturnType<UnasApiClient["setStock"]>;
  getRateForDate?: MnbExchangeRateService["getRateForDate"];
}) {
  let capturedCreateParams: CreatePurchaseInvoiceParams | undefined;
  let mnbCallCount = 0;
  const invoices = {
    currentStock: async () => ({
      warehouseId: options.warehouseId ?? "warehouse-1",
      variants: options.variants,
    }),
    create: async (params: CreatePurchaseInvoiceParams) => {
      capturedCreateParams = params;
      return {
        id: "invoice-1",
        documentNumber: params.documentNumber,
        supplierInvoiceNumber: params.supplierInvoiceNumber,
        source: params.source,
        status: "POSTED",
        supplierId: params.supplierId,
        supplierName: "Test Supplier",
        currency: params.currency,
        exchangeRate: params.exchangeRate?.toString(),
        invoiceDate: params.invoiceDate.toISOString(),
        dueDate: params.dueDate?.toISOString(),
        isPaid: params.isPaid,
        paidAt: params.paidAt?.toISOString(),
        totalNet: "0",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        warehouseId: params.warehouseId,
        vatRate: undefined,
        note: params.note ?? undefined,
        lines: params.lines.map((line, index) => ({
          id: `line-${index}`,
          variantId: line.variantId,
          sku: options.variants.get(line.variantId)?.sku ?? "",
          productName: options.variants.get(line.variantId)?.productName ?? "",
          sourceDescription: line.sourceDescription ?? undefined,
          orderedQuantity: line.orderedQuantity.toString(),
          actualQuantity: line.actualQuantity.toString(),
          unit: line.unit,
          unitNet: line.unitNet.toString(),
          discountPercent: line.discountPercent?.toString(),
          lineNet: "0",
          syncStatus: line.syncStatus,
          syncError: line.syncError ?? undefined,
        })),
      };
    },
  } as unknown as PurchaseInvoiceRepository;
  const suppliers = {
    detail: async () =>
      (options.supplierExists ?? true) ? { id: "supplier-1", name: "Test" } : null,
  } as unknown as SuppliersRepository;
  const productSearch = {} as unknown as PurchaseProductSearchService;
  const mnbRates = {
    getRateForDate:
      options.getRateForDate ??
      (async () => {
        mnbCallCount += 1;
        return { quotedDate: "2026-07-20", rate: "400" };
      }),
  } as unknown as MnbExchangeRateService;
  const unasApi = {
    setStock:
      options.setStock ??
      (async (_token: string, request: { sku: string }) => ({
        externalId: "1",
        sku: request.sku,
      })),
  } as unknown as UnasApiClient;
  const unasAuth = { getToken: async () => "token" } as unknown as UnasAuthService;
  const service = new PurchasingService(
    invoices,
    suppliers,
    productSearch,
    mnbRates,
    unasApi,
    unasAuth,
  );
  return {
    service,
    getCapturedCreateParams: () => capturedCreateParams,
    getMnbCallCount: () => mnbCallCount,
  };
}

function baseInput(
  overrides: Partial<CreatePurchaseInvoiceDto> = {},
): CreatePurchaseInvoiceDto {
  return {
    source: "EU",
    supplierId: "supplier-1",
    supplierInvoiceNumber: "INV-2026-001",
    currency: "EUR",
    invoiceDate: "2026-07-20T00:00:00.000Z",
    isPaid: false,
    lines: [
      {
        variantId: "variant-1",
        orderedQuantity: 5,
        actualQuantity: 5,
        unit: "db",
        unitNet: 10,
      },
    ],
    ...overrides,
  };
}

describe("PurchasingService.createInvoice", () => {
  it("rejects a non-EU source (not implemented yet)", async () => {
    const { service } = buildService({ variants: new Map() });
    await assert.rejects(() =>
      service.createInvoice(baseInput({ source: "HU_MANUAL" }), "user-1"),
    );
  });

  it("rejects an unknown supplier", async () => {
    const { service } = buildService({
      variants: new Map([["variant-1", variant()]]),
      supplierExists: false,
    });
    await assert.rejects(() => service.createInvoice(baseInput(), "user-1"));
  });

  it("rejects an unknown product variant", async () => {
    const { service } = buildService({ variants: new Map() });
    await assert.rejects(() => service.createInvoice(baseInput(), "user-1"));
  });

  it("uses the client-supplied exchange rate without calling the MNB service", async () => {
    const { service, getCapturedCreateParams, getMnbCallCount } = buildService({
      variants: new Map([["variant-1", variant()]]),
    });
    await service.createInvoice(baseInput({ exchangeRate: 405.5 }), "user-1");
    assert.equal(getCapturedCreateParams()?.exchangeRate?.toString(), "405.5");
    assert.equal(getMnbCallCount(), 0);
  });

  it("resolves the exchange rate from MNB when omitted for a non-HUF currency", async () => {
    const { service, getCapturedCreateParams, getMnbCallCount } = buildService({
      variants: new Map([["variant-1", variant()]]),
    });
    await service.createInvoice(baseInput(), "user-1");
    assert.equal(getCapturedCreateParams()?.exchangeRate?.toString(), "400");
    assert.equal(getMnbCallCount(), 1);
  });

  it("never calls MNB and stores a null exchange rate for HUF invoices", async () => {
    const { service, getCapturedCreateParams, getMnbCallCount } = buildService({
      variants: new Map([["variant-1", variant()]]),
    });
    await service.createInvoice(baseInput({ currency: "HUF" }), "user-1");
    assert.equal(getCapturedCreateParams()?.exchangeRate, null);
    assert.equal(getMnbCallCount(), 0);
  });

  it("accumulates the resulting stock across two lines for the same variant instead of overwriting", async () => {
    const { service, getCapturedCreateParams } = buildService({
      variants: new Map([
        ["variant-1", variant({ currentQty: new Prisma.Decimal("10") })],
      ]),
    });
    await service.createInvoice(
      baseInput({
        lines: [
          {
            variantId: "variant-1",
            orderedQuantity: 5,
            actualQuantity: 5,
            unit: "db",
            unitNet: 10,
          },
          {
            variantId: "variant-1",
            orderedQuantity: 3,
            actualQuantity: 3,
            unit: "db",
            unitNet: 12,
          },
        ],
      }),
      "user-1",
    );
    const params = getCapturedCreateParams();
    assert.equal(params?.lines[0]?.resultingQty.toString(), "15");
    assert.equal(params?.lines[1]?.resultingQty.toString(), "18");
  });

  it("keeps going and reports a per-line UNAS push failure without blocking the invoice", async () => {
    const { service, getCapturedCreateParams } = buildService({
      variants: new Map([
        ["variant-1", variant({ sku: "REEF-SALT-01" })],
        ["variant-2", variant({ variantId: "variant-2", sku: "PUMP-XL" })],
      ]),
      setStock: async (_token, request) => {
        if (request.sku === "REEF-SALT-01") throw new Error("UNAS_TIMEOUT");
        return { externalId: "1", sku: request.sku };
      },
    });

    const result = await service.createInvoice(
      baseInput({
        lines: [
          {
            variantId: "variant-1",
            orderedQuantity: 1,
            actualQuantity: 1,
            unit: "db",
            unitNet: 10,
          },
          {
            variantId: "variant-2",
            orderedQuantity: 1,
            actualQuantity: 1,
            unit: "db",
            unitNet: 10,
          },
        ],
      }),
      "user-1",
    );

    assert.equal(result.successCount, 1);
    assert.equal(result.failedCount, 1);
    const params = getCapturedCreateParams();
    const failedLine = params?.lines.find((line) => line.variantId === "variant-1");
    const okLine = params?.lines.find((line) => line.variantId === "variant-2");
    assert.equal(failedLine?.syncStatus, "FAILED");
    assert.equal(failedLine?.syncError, "UNAS_TIMEOUT");
    assert.equal(okLine?.syncStatus, "OK");
  });
});
