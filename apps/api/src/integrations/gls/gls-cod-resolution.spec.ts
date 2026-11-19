import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  resolveGlsCodLine,
  type GlsResolutionLookups,
} from "./gls-cod-resolution.js";

const lookups: GlsResolutionLookups = {
  existingInvoiceNumbers: new Set(["ACRW-2026/00001", "ACRW-2026/00002"]),
  orderInvoiceNumbers: new Map([
    ["11111-000001", ["ACRW-2026/00010"]],
    ["11111-000002", []],
  ]),
  webshopByParcel: new Map([
    [
      "3400000001",
      { orderIds: ["order_1"], invoiceNumbers: ["ACRW-2026/00600"] },
    ],
    ["3400000002", { orderIds: ["order_2"], invoiceNumbers: [] }],
    [
      "3400000003",
      {
        orderIds: ["order_3"],
        invoiceNumbers: ["ACRW-2026/00601", "ACRW-2026/00602"],
      },
    ],
    [
      "3400000004",
      {
        orderIds: ["order_4", "order_5"],
        invoiceNumbers: ["ACRW-2026/00603", "ACRW-2026/00604"],
      },
    ],
  ]),
};

describe("resolveGlsCodLine", () => {
  it("takes the COD reference as the invoice number when that invoice exists", () => {
    assert.deepEqual(
      resolveGlsCodLine(
        {
          parcelNumber: "1000000000",
          codReference: "ACRW-2026/00001, ACRW-2026/00002",
          clientReference: null,
        },
        lookups,
      ),
      {
        status: "RESOLVED",
        source: "INVOICE_NUMBER",
        invoiceNumbers: ["ACRW-2026/00001", "ACRW-2026/00002"],
      },
    );
  });

  it("goes through the order when the reference is an order key", () => {
    assert.deepEqual(
      resolveGlsCodLine(
        {
          parcelNumber: "1000000000",
          codReference: "11111-000001",
          clientReference: null,
        },
        lookups,
      ),
      {
        status: "RESOLVED",
        source: "ORDER_KEY",
        invoiceNumbers: ["ACRW-2026/00010"],
      },
    );
  });

  it("falls back to the client reference's order when the COD reference does not resolve", () => {
    for (const codReference of [null, "ACRW-2026/09999", "2026/00123"])
      assert.deepEqual(
        resolveGlsCodLine(
          {
            parcelNumber: "1000000000",
            codReference,
            clientReference: "11111-000001",
          },
          lookups,
        ),
        {
          status: "RESOLVED",
          source: "ORDER_KEY",
          invoiceNumbers: ["ACRW-2026/00010"],
        },
        String(codReference),
      );
  });

  it("names what the reference itself was, with a suggestion, when nothing resolves", () => {
    assert.deepEqual(
      resolveGlsCodLine(
        {
          parcelNumber: "1000000000",
          codReference: "ACRW-2026/09999",
          clientReference: "11111-000009",
        },
        lookups,
      ),
      {
        status: "NEEDS_REVIEW",
        errorCode: "INVOICE_NOT_FOUND",
        suggestedInvoiceNumber: "ACRW-2026/09999",
      },
    );
    // a bare number is suggested with its prefix, never completed
    assert.deepEqual(
      resolveGlsCodLine(
        {
          parcelNumber: "1000000000",
          codReference: "2026/00001",
          clientReference: null,
        },
        lookups,
      ),
      {
        status: "NEEDS_REVIEW",
        errorCode: "PREFIX_MISSING",
        suggestedInvoiceNumber: "ACRW-2026/00001",
      },
    );
  });

  it("tells a missing order from an order without an invoice", () => {
    assert.deepEqual(
      resolveGlsCodLine(
        {
          parcelNumber: "1000000000",
          codReference: "11111-000009",
          clientReference: null,
        },
        lookups,
      ),
      {
        status: "NEEDS_REVIEW",
        errorCode: "ORDER_NOT_FOUND",
        suggestedInvoiceNumber: null,
      },
    );
    assert.deepEqual(
      resolveGlsCodLine(
        {
          parcelNumber: "1000000000",
          codReference: null,
          clientReference: "11111-000002",
        },
        lookups,
      ),
      {
        status: "NEEDS_REVIEW",
        errorCode: "ORDER_NOT_INVOICED",
        suggestedInvoiceNumber: null,
      },
    );
    assert.deepEqual(
      resolveGlsCodLine(
        {
          parcelNumber: "1000000000",
          codReference: "CRPRW-2022-5",
          clientReference: null,
        },
        lookups,
      ),
      {
        status: "NEEDS_REVIEW",
        errorCode: "REFERENCE_UNKNOWN",
        suggestedInvoiceNumber: null,
      },
    );
  });
});

describe("resolveGlsCodLine: a webshop parcel, by the parcel number", () => {
  const webshopLine = (extra: {
    parcelNumber?: string;
    codReference?: string | null;
    clientReference?: string | null;
  }) => ({
    parcelNumber: "3400000001",
    codReference: null,
    clientReference: "72",
    ...extra,
  });

  it("a webshop parcel whose COD reference is missing resolves to its order's one live invoice", () => {
    assert.deepEqual(resolveGlsCodLine(webshopLine({}), lookups), {
      status: "RESOLVED",
      source: "WEBSHOP_PARCEL",
      invoiceNumbers: ["ACRW-2026/00600"],
    });
  });

  it("so does one whose COD reference is the display id (the client library's own fallback), not an invoice number", () => {
    assert.equal(
      resolveGlsCodLine(webshopLine({ codReference: "72" }), lookups).status,
      "RESOLVED",
    );
  });

  it("the COD reference that names an existing invoice still wins, and the webshop is not asked", () => {
    assert.deepEqual(
      resolveGlsCodLine(
        webshopLine({ codReference: "ACRW-2026/00001" }),
        lookups,
      ),
      {
        status: "RESOLVED",
        source: "INVOICE_NUMBER",
        invoiceNumbers: ["ACRW-2026/00001"],
      },
    );
  });

  it("a COD reference that names an invoice we do not have is NOT overridden by the webshop: the two disagree, a person decides", () => {
    assert.deepEqual(
      resolveGlsCodLine(
        webshopLine({ codReference: "ACRW-2026/09999" }),
        lookups,
      ),
      {
        status: "NEEDS_REVIEW",
        errorCode: "INVOICE_NOT_FOUND",
        suggestedInvoiceNumber: "ACRW-2026/09999",
      },
    );
    assert.equal(
      (
        resolveGlsCodLine(
          webshopLine({ codReference: "2026/00600" }),
          lookups,
        ) as {
          errorCode: string;
        }
      ).errorCode,
      "PREFIX_MISSING",
    );
  });

  it("an order without a live invoice is ORDER_NOT_INVOICED", () => {
    assert.deepEqual(
      resolveGlsCodLine(webshopLine({ parcelNumber: "3400000002" }), lookups),
      {
        status: "NEEDS_REVIEW",
        errorCode: "ORDER_NOT_INVOICED",
        suggestedInvoiceNumber: null,
      },
    );
  });

  it("two live invoices for one order are not picked from", () => {
    assert.deepEqual(
      resolveGlsCodLine(webshopLine({ parcelNumber: "3400000003" }), lookups),
      {
        status: "NEEDS_REVIEW",
        errorCode: "WEBSHOP_INVOICE_AMBIGUOUS",
        suggestedInvoiceNumber: null,
      },
    );
  });

  it("two orders for one parcel are not picked from, whatever their invoices", () => {
    assert.deepEqual(
      resolveGlsCodLine(webshopLine({ parcelNumber: "3400000004" }), lookups),
      {
        status: "NEEDS_REVIEW",
        errorCode: "WEBSHOP_ORDER_AMBIGUOUS",
        suggestedInvoiceNumber: null,
      },
    );
  });

  it("a parcel that is no webshop parcel is as before", () => {
    assert.deepEqual(
      resolveGlsCodLine(
        webshopLine({ parcelNumber: "3499999999", clientReference: null }),
        lookups,
      ),
      {
        status: "NEEDS_REVIEW",
        errorCode: "REFERENCE_UNKNOWN",
        suggestedInvoiceNumber: null,
      },
    );
  });
});
