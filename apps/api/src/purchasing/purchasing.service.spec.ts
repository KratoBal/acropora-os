import assert from "node:assert/strict";
import { describe, it } from "node:test";

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
    catalogAuthority: "UNAS",
    isPackageProduct: false,
    ...overrides,
  };
}

function buildService(options: {
  variants: Map<string, PurchaseInvoiceVariantInfo>;
  warehouseId?: string;
  supplierExists?: boolean;
  supplierCountry?: string;
  getRateForDate?: MnbExchangeRateService["getRateForDate"];
  /// Hany mentesi kiserlet bukjon el "ez a bizonylatszam mar foglalt" hibaval,
  /// mielott atmegy. Enelkul az utkozes 65 536-bol egy eselyre varna.
  takenDocumentNumbers?: number;
  /// A NAV bejovo szamla tarolt `parsedData`-ja (#1199 A-007).
  navParsedData?: unknown;
  /// #1199 P-026: a mar foglalt EAN-ek es beszallitoi cikkszamok, es az aktiv markak.
  takenEans?: Record<string, string>;
  takenSupplierSkus?: Record<string, string>;
  activeBrandIds?: string[];
  /// #1199 P-026: a sor-javaslatok lezaroja.
  lineSuggestions?: { resolveForInvoice(lines: unknown): Promise<void> };
}) {
  const navParsedDataReads: string[] = [];
  let capturedCreateParams: CreatePurchaseInvoiceParams | undefined;
  let mnbCallCount = 0;
  let currentStockCallCount = 0;
  const seenDocumentNumbers: string[] = [];
  // No UnasApiClient/UnasAuthService dependency anymore - PurchasingService
  // no longer talks to UNAS synchronously at all (see purchasing.service.ts
  // constructor comment); the fake repository below stands in for
  // PurchaseInvoiceRepository, whose real implementation now posts stock via
  // the shared postInventoryMovement primitive instead of a manual
  // stockMovement/stockItem/UNAS-push loop.
  const owner = (productName: string) => ({
    variantId: `variant-of-${productName}`,
    sku: "ACR-L-000001",
    productName,
  });
  const invoices = {
    barcodeOwners: async (codes: string[]) =>
      codes
        .filter((code) => options.takenEans?.[code])
        .map((code) => ({ code, ...owner(options.takenEans![code]!) })),
    supplierSkuOwners: async (_supplierId: string, skus: string[]) =>
      skus
        .filter((sku) => options.takenSupplierSkus?.[sku])
        .map((supplierSku) => ({
          supplierSku,
          ...owner(options.takenSupplierSkus![supplierSku]!),
        })),
    activeBrandIds: async (ids: string[]) =>
      new Set(ids.filter((id) => (options.activeBrandIds ?? []).includes(id))),
    navInvoiceParsedData: async (id: string) => {
      navParsedDataReads.push(id);
      return options.navParsedData ?? null;
    },
    currentStock: async () => {
      currentStockCallCount += 1;
      return {
        warehouseId: options.warehouseId ?? "warehouse-1",
        variants: options.variants,
      };
    },
    create: async (params: CreatePurchaseInvoiceParams) => {
      capturedCreateParams = params;
      seenDocumentNumbers.push(params.documentNumber);
      if (seenDocumentNumbers.length <= (options.takenDocumentNumbers ?? 0))
        // Amit az adatbazis adna vissza, ha ezt a szamot mar kiadtuk volna.
        throw { code: "P2002", meta: { target: ["documentNumber"] } };
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
          // the repository saves a line under its pre-assigned id, if it has one
          id: line.lineId ?? `line-${index}`,
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
        ? {
            id: "supplier-1",
            name: "Test",
            country: options.supplierCountry ?? "DE",
          }
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
    options.lineSuggestions as never,
  );
  return {
    service,
    getCapturedCreateParams: () => capturedCreateParams,
    getMnbCallCount: () => mnbCallCount,
    getSeenDocumentNumbers: () => [...seenDocumentNumbers],
    getCurrentStockCallCount: () => currentStockCallCount,
    getNavParsedDataReads: () => [...navParsedDataReads],
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
      supplierCountry: "HU",
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
      supplierCountry: "HU",
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
      supplierCountry: "HU",
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
      supplierCountry: "HU",
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

  it("rejects a Hungarian supplier for an EU purchase", async () => {
    const { service } = buildService({
      variants: new Map([["variant-1", variant()]]),
      supplierCountry: "HU",
    });
    await assert.rejects(
      () => service.createInvoice(baseInput(), "user-1"),
      /csak nem magyarországi beszállító/i,
    );
  });

  it("rejects a non-Hungarian supplier for a domestic purchase", async () => {
    const { service } = buildService({
      variants: new Map([["variant-1", variant()]]),
      supplierCountry: "DE",
    });
    await assert.rejects(
      () =>
        service.createInvoice(
          baseInput({ source: "HU_MANUAL", currency: "HUF", vatRate: 27 }),
          "user-1",
        ),
      /csak magyarországi beszállító/i,
    );
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
    // the old client sends name and category only; the new details stay empty
    assert.deepEqual(line?.createLocalProduct, {
      name: "Egyedi szivattyú",
      primaryCategoryId: null,
      brandId: null,
      vatRate: null,
      ean: null,
      supplierSku: null,
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
  /**
   * A BIZONYLATSZAM UTKOZESE. Ket bevetelezes ugyanabban a masodpercben
   * ugyanazt a negyjegyu veget huzhatja. Ma a masodik hibaval vegzodik, es a
   * kollegának kell ujraprobalnia - holott a kovetkezo huzas mas veletlent ad.
   */
  it("mints a new document number when the first one is already taken", async () => {
    const { service, getSeenDocumentNumbers } = buildService({
      variants: new Map([["variant-1", variant()]]),
      takenDocumentNumbers: 1,
    });

    const result = await service.createInvoice(baseInput(), "user-1");

    const seen = getSeenDocumentNumbers();
    assert.equal(seen.length, 2);
    // A masodik kiserlet MAS szamot visz. Ha a szam a lezaron kivul keletkezne,
    // itt ketszer ugyanaz allna, es a mentes otször veszitene ugyanazzal.
    assert.notEqual(seen[0], seen[1]);
    assert.equal(result.detail.documentNumber, seen[1]);
  });

  /**
   * AMI A LEZAR MERETET ORZI. Az ujraprobalas CSAK a mentest ismetli meg. A
   * folotte allo ellenorzesek es olvasasok (koztuk a keszlet-lekerdezes)
   * valtozatlanul egyszer futnak - kulonben egy ritka utkozes csendben
   * megduplazna a bevetelezes teljes munkajat.
   */
  it("repeats only the write, not the validation above it", async () => {
    const { service, getCurrentStockCallCount, getSeenDocumentNumbers } =
      buildService({
        variants: new Map([["variant-1", variant()]]),
        takenDocumentNumbers: 2,
      });

    await service.createInvoice(baseInput(), "user-1");

    assert.equal(getSeenDocumentNumbers().length, 3);
    assert.equal(getCurrentStockCallCount(), 1);
  });

  /**
   * A HATAR. Az otodik kiserlet utan az eredeti adatbazis-hiba megy tovabb,
   * valtozatlanul - vagyis a legrosszabb eset pontosan a mai viselkedes.
   */
  it("gives the original error back when every attempt loses", async () => {
    const { service, getSeenDocumentNumbers } = buildService({
      variants: new Map([["variant-1", variant()]]),
      takenDocumentNumbers: 99,
    });

    await assert.rejects(
      () => service.createInvoice(baseInput(), "user-1"),
      (error: unknown) =>
        (error as { code?: string }).code === "P2002" &&
        (error as { meta?: { target?: string[] } }).meta?.target?.[0] ===
          "documentNumber",
    );

    assert.equal(getSeenDocumentNumbers().length, 5);
  });
});

/**
 * A NAV SOR FORRASA (#1199 A-007): a sorszamot a kliens kuldi, a SZOVEGET a
 * szerver a tarolt NAV adatbol veszi. Semmi nem allitja meg a mentest.
 */
describe("PurchasingService.createInvoice: NAV line source", () => {
  const NAV = {
    lines: [
      { lineNumber: 1, description: "Reef Salt 20kg vödör" },
      { lineNumber: 2, description: "Szállítási díj" },
      { lineNumber: 3, description: "Pumpa A" },
      { lineNumber: 3, description: "Pumpa B" },
    ],
  };
  const sor = (
    navLineNumber: number | undefined,
    extra: Partial<CreatePurchaseInvoiceDto["lines"][number]> = {},
  ) => ({
    orderedQuantity: 1,
    actualQuantity: 1,
    unit: "db",
    unitNet: 10,
    navLineNumber,
    ...extra,
  });
  const nav = (lines: CreatePurchaseInvoiceDto["lines"], navId?: string) =>
    baseInput({
      source: "HU_NAV",
      currency: "HUF",
      vatRate: 27,
      navIncomingInvoiceId: navId,
      lines,
    });

  it("fills number and ORIGINAL text from the stored NAV data on all three line kinds", async () => {
    const { service, getCapturedCreateParams, getNavParsedDataReads } =
      buildService({
        variants: new Map([["variant-1", variant()]]),
        supplierCountry: "HU",
        navParsedData: NAV,
      });
    await service.createInvoice(
      nav(
        [
          sor(1, { variantId: "variant-1", sourceDescription: "átírt név" }),
          sor(2, { sourceDescription: "Szállítás (kézzel átírva)" }),
          sor(1, {
            createLocalProduct: { name: "Új só" },
            sourceDescription: "Új só",
          }),
        ],
        "nav-1",
      ),
      "user-1",
    );
    assert.deepEqual(getNavParsedDataReads(), ["nav-1"]);
    assert.deepEqual(
      getCapturedCreateParams()?.lines.map((l) => [
        l.navLineNumber,
        l.navLineDescription,
        l.sourceDescription,
      ]),
      [
        [1, "Reef Salt 20kg vödör", "átírt név"],
        [2, "Szállítási díj", "Szállítás (kézzel átírva)"],
        [1, "Reef Salt 20kg vödör", "Új só"],
      ],
    );
  });

  it("an unknown or ambiguous line number, or none, leaves both fields null and still saves", async () => {
    const { service, getCapturedCreateParams } = buildService({
      variants: new Map([["variant-1", variant()]]),
      supplierCountry: "HU",
      navParsedData: NAV,
    });
    await service.createInvoice(
      nav(
        [
          sor(9, { sourceDescription: "nincs ilyen sor" }),
          sor(3, { sourceDescription: "kétszer álló sorszám" }),
          sor(undefined, { sourceDescription: "kézi sor" }),
        ],
        "nav-1",
      ),
      "user-1",
    );
    assert.deepEqual(
      getCapturedCreateParams()?.lines.map((l) => [
        l.navLineNumber,
        l.navLineDescription,
      ]),
      [
        [null, null],
        [null, null],
        [null, null],
      ],
    );
  });

  it("without a NAV invoice the client's line number is ignored and nothing is read", async () => {
    const { service, getCapturedCreateParams, getNavParsedDataReads } =
      buildService({
        variants: new Map([["variant-1", variant()]]),
        supplierCountry: "HU",
        navParsedData: NAV,
      });
    await service.createInvoice(
      nav([sor(1, { sourceDescription: "kézi sor" })]),
      "user-1",
    );
    assert.deepEqual(getNavParsedDataReads(), []);
    assert.equal(getCapturedCreateParams()?.lines[0]?.navLineNumber, null);
    assert.equal(getCapturedCreateParams()?.lines[0]?.navLineDescription, null);
  });

  it("a NAV invoice without parsed data leaves the fields null", async () => {
    const { service, getCapturedCreateParams } = buildService({
      variants: new Map([["variant-1", variant()]]),
      supplierCountry: "HU",
    });
    await service.createInvoice(
      nav([sor(1, { sourceDescription: "x" })], "nav-1"),
      "user-1",
    );
    assert.equal(getCapturedCreateParams()?.lines[0]?.navLineNumber, null);
  });
});

/** #1199 P-026 UJ-TERMEK: egy új termék a számlasorból, és hogy tényleg új-e. */
describe("PurchasingService new product details", () => {
  function newProductLine(
    details: Record<string, unknown>,
    name = "Dupla Marin Coral Plugs",
  ) {
    return {
      createLocalProduct: { name, ...details },
      sourceDescription: "Dupla Marin Coral Plugs 10 St., SB",
      orderedQuantity: 3,
      actualQuantity: 3,
      unit: "db",
      unitNet: 4.5,
    } as CreatePurchaseInvoiceDto["lines"][number];
  }

  it("passes brand, VAT, EAN and supplier code on to the repository", async () => {
    const { service, getCapturedCreateParams } = buildService({
      variants: new Map(),
      activeBrandIds: ["brand-dupla"],
    });
    await service.createInvoice(
      baseInput({
        lines: [
          newProductLine({
            brandId: "brand-dupla",
            vatRate: 27,
            ean: " 4011444815934 ",
            supplierSku: " 81593 ",
          }),
        ],
      }),
      "user-1",
    );
    const product = getCapturedCreateParams()?.lines[0]?.createLocalProduct;
    assert.equal(product?.brandId, "brand-dupla");
    assert.equal(product?.vatRate?.toString(), "27");
    assert.equal(product?.ean, "4011444815934");
    assert.equal(product?.supplierSku, "81593");
  });

  it("refuses a product whose EAN already belongs to one, and names it", async () => {
    const { service, getCapturedCreateParams } = buildService({
      variants: new Map(),
      takenEans: { "4011444815934": "Coral Plugs 10 db" },
    });
    await assert.rejects(
      service.createInvoice(
        baseInput({ lines: [newProductLine({ ean: "4011444815934" })] }),
        "user-1",
      ),
      (error: unknown) =>
        error instanceof Error &&
        error.constructor.name === "ConflictException" &&
        error.message.includes("Coral Plugs 10 db"),
    );
    assert.equal(getCapturedCreateParams(), undefined);
  });

  it("refuses a supplier code already mapped at this supplier", async () => {
    const { service, getCapturedCreateParams } = buildService({
      variants: new Map(),
      takenSupplierSkus: { "81593": "Coral Plugs 10 db" },
    });
    await assert.rejects(
      service.createInvoice(
        baseInput({ lines: [newProductLine({ supplierSku: "81593" })] }),
        "user-1",
      ),
      (error: unknown) =>
        error instanceof Error &&
        error.constructor.name === "ConflictException" &&
        error.message.includes("81593"),
    );
    assert.equal(getCapturedCreateParams(), undefined);
  });

  it("refuses two new products with the same EAN or code on one invoice", async () => {
    const { service } = buildService({ variants: new Map() });
    for (const details of [{ ean: "4011444815934" }, { supplierSku: "81593" }])
      await assert.rejects(
        service.createInvoice(
          baseInput({
            lines: [
              newProductLine(details, "Egyik"),
              newProductLine(details, "Másik"),
            ],
          }),
          "user-1",
        ),
        /Két új termék ugyanazt/,
      );
  });

  it("refuses an EAN with a wrong check digit, and an unknown brand", async () => {
    const { service } = buildService({ variants: new Map() });
    await assert.rejects(
      service.createInvoice(
        baseInput({ lines: [newProductLine({ ean: "4011444815935" })] }),
        "user-1",
      ),
      /Érvénytelen EAN/,
    );
    await assert.rejects(
      service.createInvoice(
        baseInput({ lines: [newProductLine({ brandId: "brand-gone" })] }),
        "user-1",
      ),
      /márka nem található/,
    );
  });

  it("answers the pre-creation lookup by EAN and by supplier code", async () => {
    const { service } = buildService({
      variants: new Map(),
      takenEans: { "4011444815934": "Coral Plugs 10 db" },
      takenSupplierSkus: { "81593": "Coral Plugs 10 db" },
    });
    const found = await service.newProductConflicts({
      ean: "4011444815934",
      supplierId: "supplier-1",
      supplierSku: "81593",
    });
    assert.equal(found.byEan?.productName, "Coral Plugs 10 db");
    assert.equal(found.bySupplierSku?.productName, "Coral Plugs 10 db");
    assert.deepEqual(
      await service.newProductConflicts({
        ean: "0000000000000",
        supplierSku: "x",
      }),
      { byEan: null, bySupplierSku: null },
    );
  });
});

/** #1199 P-026: a javaslat audit-futása pontosan a mentett sorhoz zárul. */
describe("PurchasingService line suggestion closure", () => {
  it("gives a line with a run its id up front, and closes the run against it", async () => {
    const closed: unknown[] = [];
    const { service, getCapturedCreateParams } = buildService({
      variants: new Map([["variant-1", variant()]]),
      lineSuggestions: {
        resolveForInvoice: async (lines) => {
          closed.push(lines);
        },
      },
    });
    await service.createInvoice(
      baseInput({
        lines: [
          {
            variantId: "variant-1",
            decisionRunId: "run-7",
            orderedQuantity: 1,
            actualQuantity: 1,
            unit: "db",
            unitNet: 10,
          },
          {
            sourceDescription: "Frachtkosten",
            orderedQuantity: 1,
            actualQuantity: 1,
            unit: "db",
            unitNet: 80,
          },
        ],
      }),
      "user-1",
    );
    const [first, second] = getCapturedCreateParams()!.lines;
    assert.match(first!.lineId!, /^[0-9a-f-]{36}$/);
    assert.equal(second!.lineId, undefined);
    assert.equal(closed.length, 1);
    assert.deepEqual(closed[0], [
      { decisionRunId: "run-7", lineId: first!.lineId, variantId: "variant-1" },
    ]);
  });

  it("a failed closure never undoes the saved invoice", async () => {
    const { service } = buildService({
      variants: new Map([["variant-1", variant()]]),
      lineSuggestions: {
        resolveForInvoice: async () => {
          throw new Error("adatbazis nem erheto el");
        },
      },
    });
    const result = await service.createInvoice(
      baseInput({
        lines: [
          {
            variantId: "variant-1",
            decisionRunId: "run-7",
            orderedQuantity: 1,
            actualQuantity: 1,
            unit: "db",
            unitNet: 10,
          },
        ],
      }),
      "user-1",
    );
    assert.equal(result.detail.id, "invoice-1");
  });
});
