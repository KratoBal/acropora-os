import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SupplierInvoiceImportResult } from "@acropora/types";

import {
  adapterSenders,
  arrivalIdentity,
  isDuplicateDocument,
} from "./expected-arrival.intake.js";

const result = (extra: Partial<Parameters<typeof arrivalIdentity>[0]> = {}) =>
  ({
    format: "PDF",
    supplier: { name: "AQUARIOOM", vatId: "FR 12 345678901", country: "FR" },
    invoiceNumber: "FA00009139",
    invoiceDate: "2026-09-30",
    dueDate: null,
    currency: "EUR",
    netTotal: 100,
    lines: [],
    warnings: [],
    ...extra,
  }) as SupplierInvoiceImportResult & Parameters<typeof arrivalIdentity>[0];

// What must fail: a proforma and its invoice landing on two arrivals; a
// proforma without an order number opening one keyed by its own number (it
// is not the invoice's); the same supplier split by the VAT id's spelling; a
// reminder's re-attached invoice read as new.
describe("what an arrived document opens or joins", () => {
  it("a proforma and its invoice share the order's arrival", () => {
    const proforma = arrivalIdentity(
      result({
        documentKind: "PROFORMA",
        orderReference: "13858",
        invoiceNumber: "CM9201",
      }),
    );
    const invoice = arrivalIdentity(
      result({ documentKind: "INVOICE", orderReference: " 13858 " }),
    );
    assert.equal(proforma?.arrivalKey, "order:13858");
    assert.equal(invoice?.arrivalKey, "order:13858");
    assert.equal(proforma?.supplierKey, "FR12345678901");
    assert.equal(proforma?.invoiceNumber, null);
    assert.equal(invoice?.invoiceNumber, "FA00009139");
  });

  it("without an order number an invoice is keyed by its number, and a proforma opens nothing", () => {
    assert.equal(arrivalIdentity(result())?.arrivalKey, "invoice:FA00009139");
    assert.equal(
      arrivalIdentity(
        result({ documentKind: "PROFORMA", invoiceNumber: "CM9201" }),
      ),
      null,
    );
  });

  it("the supplier's key is the VAT id however written, or the name without one", () => {
    const spaced = arrivalIdentity(
      result({
        supplier: { name: "X", vatId: "fr-12 345678901", country: "FR" },
      }),
    );
    assert.equal(spaced?.supplierKey, "FR12345678901");
    const named = arrivalIdentity(
      result({ supplier: { name: " Aquarioom ", vatId: null, country: null } }),
    );
    assert.equal(named?.supplierKey, "aquarioom");
    assert.equal(named?.supplierName, "Aquarioom");
    assert.equal(
      arrivalIdentity(
        result({ supplier: { name: "", vatId: null, country: null } }),
      ),
      null,
    );
  });

  it("the same bytes, or the same kind and invoice number, is a duplicate", () => {
    const on = [
      { sha256: "a", kind: "INVOICE" as const, invoiceNumber: "FA1" },
    ];
    assert.equal(
      isDuplicateDocument(
        { sha256: "a", kind: "PROFORMA", invoiceNumber: null },
        on,
      ),
      true,
    );
    assert.equal(
      isDuplicateDocument(
        { sha256: "b", kind: "INVOICE", invoiceNumber: "FA1" },
        on,
      ),
      true,
    );
    // the invoice after its proforma is not a duplicate
    assert.equal(
      isDuplicateDocument(
        { sha256: "b", kind: "INVOICE", invoiceNumber: "FA1" },
        [{ sha256: "p", kind: "PROFORMA", invoiceNumber: null }],
      ),
      false,
    );
    assert.equal(
      isDuplicateDocument(
        { sha256: "b", kind: "INVOICE", invoiceNumber: null },
        [{ sha256: "c", kind: "INVOICE", invoiceNumber: null }],
      ),
      false,
    );
  });

  it("reads the adapters' senders, and none from an adapter that names none", () => {
    assert.deepEqual(
      adapterSenders([
        { senders: ["contact@aquarioom.com"] },
        { key: "hertlein" },
      ]),
      ["contact@aquarioom.com"],
    );
  });
});
