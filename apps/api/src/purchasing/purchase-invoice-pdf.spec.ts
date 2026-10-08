import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  collectedPdfIndex,
  type CollectedDocument,
} from "../billing/incoming-collected-pdf.js";
import {
  PurchaseInvoicePdfLookup,
  purchaseInvoiceHasPdf,
  type PurchaseInvoicePdfSources,
} from "./purchase-invoice-pdf.js";

/**
 * VAN-E PDF EGY BESZERZÉSI SZÁMLÁHOZ (kártya f7df5354, Sutyerák #16).
 * Kitalált számlaszámok és adószámok.
 *
 * MI PIROSÍT: ha a párosítás csak a számlaszámot nézi (egy másik szállító
 * azonos számú PDF-je igent adna); ha valamelyik forrás (levélben gyűjtött,
 * feed, várható beérkezés) kimarad; ha adószám nélkül a számlaszám egyedül
 * dönt.
 */

const collectedDoc = (
  over: Partial<CollectedDocument> = {},
): CollectedDocument => ({
  id: "col-1",
  fileName: "TISZA-97.pdf",
  createdAt: new Date("2026-10-05T08:00:00Z"),
  textReading: {
    invoiceNumber: "TZ-2026/97",
    supplierTaxNumber: "11223344-2-13",
  },
  importResult: null,
  ...over,
});

const none: PurchaseInvoicePdfSources = {
  collected: new Map(),
  feedKeys: new Set(),
  arrivalInvoiceIds: new Set(),
};

const invoice = {
  id: "pi-1",
  supplierInvoiceNumber: "TZ-2026/97",
  supplierTaxNumber: "11223344-2-13",
};

describe("purchaseInvoiceHasPdf", () => {
  it("forrás nélkül nincs PDF", () => {
    assert.equal(purchaseInvoiceHasPdf(invoice, none), false);
  });

  it("a levélben begyűjtött PDF számlaszám és adószám-törzs szerint", () => {
    const collected = collectedPdfIndex([collectedDoc()]);
    assert.equal(purchaseInvoiceHasPdf(invoice, { ...none, collected }), true);
    // ugyanaz a szám, másik szállító: nem az övé
    assert.equal(
      purchaseInvoiceHasPdf(
        { ...invoice, supplierTaxNumber: "99887766-2-41" },
        { ...none, collected },
      ),
      false,
    );
  });

  it("a feed PDF-es számlája", () => {
    assert.equal(
      purchaseInvoiceHasPdf(invoice, {
        ...none,
        feedKeys: new Set(["TZ-2026/97|11223344"]),
      }),
      true,
    );
  });

  it("a várható beérkezés saját PDF-je, adószám nélkül is", () => {
    assert.equal(
      purchaseInvoiceHasPdf(
        { ...invoice, supplierTaxNumber: null },
        { ...none, arrivalInvoiceIds: new Set(["pi-1"]) },
      ),
      true,
    );
  });

  it("adószám nélkül a számlaszám egyedül nem dönt", () => {
    const collected = collectedPdfIndex([collectedDoc()]);
    assert.equal(
      purchaseInvoiceHasPdf(
        { ...invoice, supplierTaxNumber: null },
        { ...none, collected, feedKeys: new Set(["TZ-2026/97|11223344"]) },
      ),
      false,
    );
  });
});

describe("PurchaseInvoicePdfLookup", () => {
  function lookup(input: {
    feed?: Array<{ documentNumber: string; supplierTaxNumber: string | null }>;
    arrivals?: Array<{ purchaseInvoiceId: string | null }>;
    collected?: CollectedDocument[];
  }) {
    const subject = new PurchaseInvoicePdfLookup();
    Object.defineProperty(subject, "database", {
      value: {
        supplier: {
          findMany: async () => [
            { id: "sup-1", taxNumber: "11223344-2-13" },
            { id: "sup-2", taxNumber: null },
          ],
        },
        incomingBillingDocument: { findMany: async () => input.feed ?? [] },
        expectedArrival: { findMany: async () => input.arrivals ?? [] },
        incomingSupplierDocument: {
          findMany: async () => input.collected ?? [],
        },
      },
    });
    return subject;
  }
  const page = [
    { id: "pi-1", supplierInvoiceNumber: "TZ-2026/97", supplierId: "sup-1" },
    { id: "pi-2", supplierInvoiceNumber: "X-1", supplierId: "sup-2" },
  ];

  it("a lap minden számlájára ad értéket, a szállító adószámával", async () => {
    const result = await lookup({ collected: [collectedDoc()] }).hasPdf(page);
    assert.deepEqual(
      [...result],
      [
        ["pi-1", true],
        ["pi-2", false],
      ],
    );
  });

  it("a feed és a várható beérkezés is számít", async () => {
    const result = await lookup({
      feed: [
        { documentNumber: "TZ-2026/97", supplierTaxNumber: "11223344213" },
      ],
      arrivals: [{ purchaseInvoiceId: "pi-2" }],
    }).hasPdf(page);
    assert.deepEqual(
      [...result],
      [
        ["pi-1", true],
        ["pi-2", true],
      ],
    );
  });

  it("üres lapra nem kérdez", async () => {
    const subject = new PurchaseInvoicePdfLookup();
    Object.defineProperty(subject, "database", { value: {} });
    assert.equal((await subject.hasPdf([])).size, 0);
  });
});

describe("GET /purchasing/invoices", () => {
  it("minden sor megkapja a hasPdf mezőt", async () => {
    const { PurchasingController } = await import("./purchasing.controller.js");
    const page = {
      items: [
        { id: "pi-1", supplierInvoiceNumber: "A", supplierId: "s" },
        { id: "pi-2", supplierInvoiceNumber: "B", supplierId: "s" },
      ],
      pagination: { page: 1, pageSize: 25, totalItems: 2, totalPages: 1 },
    };
    const controller = new PurchasingController(
      { list: async () => page } as never,
      {} as never,
      {} as never,
      { hasPdf: async () => new Map([["pi-1", true]]) } as never,
      {} as never,
    );
    const result = await controller.listInvoices({} as never);
    assert.deepEqual(
      result.items.map((item) => [item.id, item.hasPdf]),
      [
        ["pi-1", true],
        ["pi-2", false],
      ],
    );
    assert.deepEqual(result.pagination, page.pagination);
  });
});

it("the scan endpoints: attaching needs purchasing.manage, reading purchasing.view (5ec62e35)", async () => {
  const { PurchasingController } = await import("./purchasing.controller.js");
  const { REQUIRED_PERMISSIONS_KEY } =
    await import("../auth/decorators/require-permissions.decorator.js");
  const { PERMISSIONS } = await import("@acropora/types");
  const of = (name: string) =>
    Reflect.getMetadata(
      REQUIRED_PERMISSIONS_KEY,
      PurchasingController.prototype[
        name as keyof typeof PurchasingController.prototype
      ],
    );
  assert.deepEqual(of("attachScan"), [PERMISSIONS.PURCHASING_MANAGE]);
  assert.deepEqual(of("scanPdf"), [PERMISSIONS.PURCHASING_VIEW]);
});
