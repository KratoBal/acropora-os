import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@acropora/database";

import type { CreatePurchaseInvoiceDto } from "./dto/create-purchase-invoice.dto.js";
import type { MnbExchangeRateService } from "../integrations/mnb/mnb-exchange-rate.service.js";
import type { SuppliersRepository } from "../suppliers/suppliers.repository.js";
import type {
  CreatePurchaseInvoiceParams,
  PurchaseInvoiceRepository,
  PurchaseInvoiceVariantInfo,
} from "./purchase-invoice.repository.js";
import type { PurchaseProductSearchService } from "./purchase-product-search.service.js";
import type { ProjectRepository } from "./project.repository.js";
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
    catalogAuthority: "UNAS",
    isPackageProduct: false,
    ...overrides,
  };
}

function buildService(options: {
  variants: Map<string, PurchaseInvoiceVariantInfo>;
  warehouseId?: string;
  supplierExists?: boolean;
  getRateForDate?: MnbExchangeRateService["getRateForDate"];
}) {
  let capturedCreateParams: CreatePurchaseInvoiceParams | undefined;
  let mnbCallCount = 0;
  // No UnasApiClient/UnasAuthService dependency anymore - PurchasingService
  // no longer talks to UNAS synchronously at all (see purchasing.service.ts
  // constructor comment); the fake repository below stands in for
  // PurchaseInvoiceRepository, whose real implementation now posts stock via
  // the shared postInventoryMovement primitive instead of a manual
  // stockMovement/stockItem/UNAS-push loop.
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
          variantId: line.variantId ?? undefined,
          sku: line.sku ?? "",
          productName:
            (line.variantId
              ? options.variants.get(line.variantId)?.productName
              : undefined) ?? "",
          sourceDescription: line.sourceDescription ?? undefined,
          orderedQuantity: line.orderedQuantity.toString(),
          actualQuantity: line.actualQuantity.toString(),
          unit: line.unit,
          unitNet: line.unitNet.toString(),
          discountPercent: line.discountPercent?.toString(),
          lineNet: "0",
          syncStatus: line.syncStatus,
          syncError: line.syncError ?? undefined,
          projectAllocations: [],
          reservedQuantity: "0",
          warehouseQuantity: line.actualQuantity.toString(),
        })),
      };
    },
  } as unknown as PurchaseInvoiceRepository;
  const suppliers = {
    detail: async () =>
      (options.supplierExists ?? true)
        ? { id: "supplier-1", name: "Test" }
        : null,
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
  const projects = {
    listAssignable: async () => [
      {
        id: "project-1",
        projectNumber: "PRJ-000001",
        name: "Test project",
        status: "ACTIVE",
      },
    ],
    create: async (name: string) => ({
      id: "project-new",
      projectNumber: "PRJ-000002",
      name,
      status: "ACTIVE",
    }),
  } as unknown as ProjectRepository;
  const service = new PurchasingService(
    invoices,
    suppliers,
    productSearch,
    mnbRates,
    projects,
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
  it("rejects project allocations whose total exceeds the received quantity", async () => {
    const { service } = buildService({
      variants: new Map([["variant-1", variant()]]),
    });

    await assert.rejects(
      () =>
        service.createInvoice(
          baseInput({
            lines: [
              {
                ...baseInput().lines[0]!,
                actualQuantity: 5,
                projectAllocations: [{ projectId: "project-1", quantity: 6 }],
              },
            ],
          }),
          "user-1",
        ),
      /projektekhez rendelt összmennyiség/i,
    );
  });

  it("rejects a HU_MANUAL/HU_NAV invoice whose currency isn't HUF", async () => {
    const { service } = buildService({
      variants: new Map([["variant-1", variant()]]),
    });
    await assert.rejects(() =>
      service.createInvoice(
        baseInput({ source: "HU_MANUAL", currency: "EUR", vatRate: 27 }),
        "user-1",
      ),
    );
  });

  it("rejects a HU_MANUAL/HU_NAV invoice without a vatRate", async () => {
    const { service } = buildService({
      variants: new Map([["variant-1", variant()]]),
    });
    await assert.rejects(() =>
      service.createInvoice(
        baseInput({ source: "HU_NAV", currency: "HUF" }),
        "user-1",
      ),
    );
  });

  it("accepts a HU_MANUAL invoice with HUF currency and a vatRate, without calling MNB", async () => {
    const { service, getCapturedCreateParams, getMnbCallCount } = buildService({
      variants: new Map([["variant-1", variant()]]),
    });
    await service.createInvoice(
      baseInput({ source: "HU_MANUAL", currency: "HUF", vatRate: 27 }),
      "user-1",
    );
    const params = getCapturedCreateParams();
    assert.equal(params?.vatRate?.toString(), "27");
    assert.equal(params?.exchangeRate, null);
    assert.equal(getMnbCallCount(), 0);
  });

  it("passes navIncomingInvoiceId through for a HU_NAV invoice", async () => {
    const { service, getCapturedCreateParams } = buildService({
      variants: new Map([["variant-1", variant()]]),
    });
    await service.createInvoice(
      baseInput({
        source: "HU_NAV",
        currency: "HUF",
        vatRate: 27,
        navIncomingInvoiceId: "nav-invoice-1",
      }),
      "user-1",
    );
    assert.equal(
      getCapturedCreateParams()?.navIncomingInvoiceId,
      "nav-invoice-1",
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

  it("marks every product-linked line PENDING and carries its SKU through, without computing a resultingQty (the writer computes the absolute onHand under lock, not this service)", async () => {
    const { service, getCapturedCreateParams } = buildService({
      variants: new Map([
        ["variant-1", variant({ sku: "REEF-SALT-01" })],
        ["variant-2", variant({ variantId: "variant-2", sku: "PUMP-XL" })],
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
            variantId: "variant-2",
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
    assert.equal(params?.lines[0]?.syncStatus, "PENDING");
    assert.equal(params?.lines[0]?.sku, "REEF-SALT-01");
    assert.equal(params?.lines[1]?.syncStatus, "PENDING");
    assert.equal(params?.lines[1]?.sku, "PUMP-XL");
    assert.equal(
      (params?.lines[0] as { resultingQty?: unknown }).resultingQty,
      undefined,
    );
  });

  it("marks an existing local product NOT_APPLICABLE and never queues it for UNAS", async () => {
    const { service, getCapturedCreateParams } = buildService({
      variants: new Map([
        [
          "variant-local",
          variant({
            variantId: "variant-local",
            sku: "LOCAL-1",
            catalogAuthority: "ACROPORA",
          }),
        ],
      ]),
    });

    const result = await service.createInvoice(
      baseInput({
        lines: [
          {
            variantId: "variant-local",
            orderedQuantity: 2,
            actualQuantity: 2,
            unit: "db",
            unitNet: 5,
          },
        ],
      }),
      "user-1",
    );

    assert.equal(
      getCapturedCreateParams()?.lines[0]?.syncStatus,
      "NOT_APPLICABLE",
    );
    assert.equal(getCapturedCreateParams()?.lines[0]?.syncToUnas, false);
    assert.equal(result.successCount, 1);
    assert.equal(result.unasQueuedCount, 0);
  });

  it("prepares a normalized local product for atomic creation with the invoice", async () => {
    const { service, getCapturedCreateParams } = buildService({
      variants: new Map(),
    });

    const result = await service.createInvoice(
      baseInput({
        lines: [
          {
            createLocalProduct: {
              name: " Egyedi szivattyú ",
            },
            sourceDescription: "Pump model X",
            orderedQuantity: 2,
            actualQuantity: 2,
            unit: " db ",
            unitNet: 150,
          },
        ],
      }),
      "user-1",
    );

    const line = getCapturedCreateParams()?.lines[0];
    assert.deepEqual(line?.createLocalProduct, {
      name: "Egyedi szivattyú",
      primaryCategoryId: null,
    });
    assert.equal(line?.sku, null);
    assert.equal(line?.syncStatus, "NOT_APPLICABLE");
    assert.equal(line?.syncToUnas, false);
    assert.equal(result.successCount, 1);
    assert.equal(result.localProductCreatedCount, 1);
    assert.equal(result.unasQueuedCount, 0);
  });

  it("rejects a line that both links an existing variant and requests a new local product", async () => {
    const { service } = buildService({
      variants: new Map([["variant-1", variant()]]),
    });

    await assert.rejects(() =>
      service.createInvoice(
        baseInput({
          lines: [
            {
              variantId: "variant-1",
              createLocalProduct: { name: "Másik termék" },
              orderedQuantity: 1,
              actualQuantity: 1,
              unit: "db",
              unitNet: 10,
            },
          ],
        }),
        "user-1",
      ),
    );
  });

  it("always reports successCount = linked line count and failedCount = 0 - a real posting failure now throws and rolls back the whole transaction instead of producing a per-line synchronous failure (see repository.create)", async () => {
    const { service } = buildService({
      variants: new Map([
        ["variant-1", variant({ sku: "REEF-SALT-01" })],
        ["variant-2", variant({ variantId: "variant-2", sku: "PUMP-XL" })],
      ]),
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

    assert.equal(result.successCount, 2);
    assert.equal(result.failedCount, 0);
  });

  it("accepts a line without a matching product variant, marking it NOT_LINKED with no sku and skipping it from the linked-line count", async () => {
    const { service, getCapturedCreateParams } = buildService({
      variants: new Map([["variant-1", variant()]]),
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
            sourceDescription: "Egyedi csomagolóanyag",
            orderedQuantity: 2,
            actualQuantity: 2,
            unit: "db",
            unitNet: 3,
          },
        ],
      }),
      "user-1",
    );

    // A terméktörzs nélküli sor nem számít bele a linkedLineCount-ba (sem
    // sikeresként, sem hibásként) - a repository is kihagyja a helyi
    // készlethatásból és a UnasStockSyncOutbox-ból (lásd
    // purchase-invoice.repository.ts create()).
    assert.equal(result.successCount, 1);
    assert.equal(result.failedCount, 0);

    const params = getCapturedCreateParams();
    const unmatchedLine = params?.lines.find((line) => !line.variantId);
    assert.equal(unmatchedLine?.syncStatus, "NOT_LINKED");
    assert.equal(unmatchedLine?.sku, null);
    assert.equal(unmatchedLine?.sourceDescription, "Egyedi csomagolóanyag");
  });

  it("rejects an unmatched line without a sourceDescription", async () => {
    const { service } = buildService({
      variants: new Map([["variant-1", variant()]]),
    });
    await assert.rejects(() =>
      service.createInvoice(
        baseInput({
          lines: [
            {
              orderedQuantity: 1,
              actualQuantity: 1,
              unit: "db",
              unitNet: 10,
            },
          ],
        }),
        "user-1",
      ),
    );
  });

  it("rejects an unmatched line without a unit", async () => {
    const { service } = buildService({
      variants: new Map([["variant-1", variant()]]),
    });
    await assert.rejects(() =>
      service.createInvoice(
        baseInput({
          lines: [
            {
              sourceDescription: "Egyedi tétel",
              orderedQuantity: 1,
              actualQuantity: 1,
              unit: "",
              unitNet: 10,
            },
          ],
        }),
        "user-1",
      ),
    );
  });
});
