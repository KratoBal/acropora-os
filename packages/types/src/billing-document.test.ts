import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BILLING_DOCUMENT_STATUSES,
  BILLING_DOCUMENT_TYPES,
  billingDrawerCta,
  billingEmailDelivery,
  billingIssueCta,
  canTransitionBillingDocument,
  getDocumentCapabilities,
  INVOICE_FORMATS,
  resolveInvoiceFormat,
} from "./billing-document.js";

describe("getDocumentCapabilities", () => {
  it("names the page and the summary after the document, not always 'Számla'", () => {
    assert.deepEqual(
      BILLING_DOCUMENT_TYPES.map((type) => [
        getDocumentCapabilities(type).newTitle,
        getDocumentCapabilities(type).summaryTitle,
      ]),
      [
        ["Új számla", "Számla összesen"],
        ["Új díjbekérő", "Díjbekérő összesen"],
        ["Új előlegszámla", "Előlegszámla összesen"],
        ["Új szállítólevél", "Szállítólevél összesen"],
      ],
    );
  });

  it("offers a format only where it has one, and its default is one of them", () => {
    for (const type of BILLING_DOCUMENT_TYPES) {
      const { formats, defaultFormat } = getDocumentCapabilities(type);
      if (formats.length === 0) assert.equal(defaultFormat, null, type);
      else assert.ok(formats.includes(defaultFormat!), type);
    }
    assert.equal(
      getDocumentCapabilities("INVOICE").defaultFormat,
      "ELECTRONIC",
    );
    assert.deepEqual(getDocumentCapabilities("PROFORMA").formats, []);
    assert.deepEqual(getDocumentCapabilities("DELIVERY_NOTE").formats, []);
  });

  it("hides the payment fields only on the delivery note", () => {
    assert.deepEqual(
      BILLING_DOCUMENT_TYPES.filter(
        (type) => !getDocumentCapabilities(type).showsPaymentFields,
      ),
      ["DELIVERY_NOTE"],
    );
  });
});

describe("resolveInvoiceFormat", () => {
  it("accepts every offered format, and only those", () => {
    for (const type of BILLING_DOCUMENT_TYPES)
      for (const format of INVOICE_FORMATS) {
        const offered = getDocumentCapabilities(type).formats.includes(format);
        assert.deepEqual(
          resolveInvoiceFormat(type, format),
          offered
            ? { ok: true, format }
            : { ok: false, error: "BILLING_FORMAT_NOT_SUPPORTED" },
          `${type} ${format}`,
        );
      }
  });

  it("refuses a format sent for a type that has none, instead of dropping it", () => {
    assert.deepEqual(resolveInvoiceFormat("PROFORMA", "ELECTRONIC"), {
      ok: false,
      error: "BILLING_FORMAT_NOT_SUPPORTED",
    });
    assert.deepEqual(resolveInvoiceFormat("DELIVERY_NOTE", null), {
      ok: true,
      format: null,
    });
  });

  it("requires a format where the type has one", () => {
    assert.deepEqual(resolveInvoiceFormat("INVOICE", undefined), {
      ok: false,
      error: "BILLING_FORMAT_REQUIRED",
    });
  });
});

describe("the issue flow's labels and e-mail step", () => {
  it("makes the e-invoice one flow with sending, and the paper invoice not", () => {
    assert.equal(billingEmailDelivery("INVOICE", "ELECTRONIC"), "REQUIRED");
    assert.equal(billingEmailDelivery("INVOICE", "PAPER"), "OPTIONAL");
    assert.equal(billingEmailDelivery("PROFORMA", null), "OPTIONAL");
    assert.equal(billingEmailDelivery("DELIVERY_NOTE", null), "NONE");
  });

  it("uses the brief's own button texts", () => {
    assert.equal(
      billingIssueCta("INVOICE", "ELECTRONIC"),
      "Kiállítás és kiküldés",
    );
    assert.equal(billingIssueCta("INVOICE", "PAPER"), "Számla kiállítása");
    assert.equal(billingIssueCta("PROFORMA", null), "Díjbekérő kiállítása");
    assert.equal(
      billingIssueCta("DELIVERY_NOTE", null),
      "Szállítólevél kiállítása",
    );
    assert.equal(
      billingDrawerCta("INVOICE", "ELECTRONIC"),
      "E-számla kiállítása és elküldése",
    );
  });
});

describe("canTransitionBillingDocument", () => {
  it("allows exactly the four transitions of the issue flow", () => {
    const allowed = BILLING_DOCUMENT_STATUSES.flatMap((from) =>
      BILLING_DOCUMENT_STATUSES.filter((to) =>
        canTransitionBillingDocument(from, to),
      ).map((to) => `${from}->${to}`),
    );
    assert.deepEqual(allowed, [
      "DRAFT->ISSUING",
      "ISSUING->ISSUED",
      "ISSUING->ISSUE_FAILED",
      "ISSUE_FAILED->DRAFT",
    ]);
  });

  it("never lets an unknown outcome go back to draft", () => {
    // a second real call could issue a second real document
    assert.equal(canTransitionBillingDocument("ISSUING", "DRAFT"), false);
  });
});
