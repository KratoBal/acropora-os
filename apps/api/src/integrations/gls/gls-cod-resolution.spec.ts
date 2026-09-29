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
};

describe("resolveGlsCodLine", () => {
  it("takes the COD reference as the invoice number when that invoice exists", () => {
    assert.deepEqual(
      resolveGlsCodLine(
        {
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
        { codReference: "11111-000001", clientReference: null },
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
          { codReference, clientReference: "11111-000001" },
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
        { codReference: "ACRW-2026/09999", clientReference: "11111-000009" },
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
        { codReference: "2026/00001", clientReference: null },
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
        { codReference: "11111-000009", clientReference: null },
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
        { codReference: null, clientReference: "11111-000002" },
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
        { codReference: "CRPRW-2022-5", clientReference: null },
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
