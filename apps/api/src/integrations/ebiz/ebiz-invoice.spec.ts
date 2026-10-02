import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EbizInvoiceListItem } from "./ebiz.client.js";
import {
  ebizKindCode,
  ebizListFields,
  ebizNewRow,
  ebizPayment,
  pagingStep,
} from "./ebiz-invoice.js";

/** Invented values only. */
export const ebizItem = (
  over: Partial<EbizInvoiceListItem> = {},
): EbizInvoiceListItem => ({
  id: 101,
  invoiceNumber: "TEST000101",
  type: "INVOICE",
  cancelled: false,
  navResult: { status: "DONE" },
  currencyCode: "HUF",
  customerName: "Teszt Vevő Kft.",
  issueDate: "2026-09-30",
  dueDate: "2026-10-08",
  deliveryDate: "2026-09-29",
  paymentMethod: "TRANSFER",
  paymentStatus: "WAITING_FOR_PAYMENT",
  summary: { netAmount: 10000, vatAmount: 2700, grossAmount: 12700 },
  ...over,
});

describe("eBIZ számla → külső bizonylat sor", () => {
  it("a típus a lista meglévő bizonylatkódjára fordul", () => {
    assert.equal(ebizKindCode("INVOICE"), "SZ");
    assert.equal(ebizKindCode("CANCELLATION"), "SS");
    assert.equal(ebizKindCode("CORRECTIVE"), "JS");
    assert.equal(ebizKindCode("ADVANCE"), "ES");
    assert.equal(ebizKindCode("FINAL"), "VS");
    assert.equal(ebizKindCode("PROFORMA"), "D");
    assert.equal(ebizKindCode("PARTIAL"), "SZ");
    assert.equal(ebizKindCode("valami"), "VALAMI");
  });

  it("a fizetés az eBIZ saját állapotából; a NONE ismeretlen, nem kifizetetlen", () => {
    assert.deepEqual(ebizPayment(ebizItem({ paymentStatus: "PAID" }), null), {
      paymentsKnown: true,
      paidAmount: "12700.00",
    });
    assert.deepEqual(
      ebizPayment(ebizItem({ paymentStatus: "PAID" }), { paidAmount: 5000 }),
      { paymentsKnown: true, paidAmount: "5000.00" },
    );
    assert.deepEqual(
      ebizPayment(ebizItem({ paymentStatus: "EXPIRED" }), null),
      {
        paymentsKnown: true,
        paidAmount: "0.00",
      },
    );
    assert.deepEqual(ebizPayment(ebizItem({ paymentStatus: "NONE" }), null), {
      paymentsKnown: null,
      paidAmount: "0.00",
    });
    assert.equal(
      ebizPayment(ebizItem({ paymentStatus: undefined }), null).paymentsKnown,
      null,
    );
  });

  it("az új sor EBIZ forrású, a részletekből hozza a tételeket és a vevőt", () => {
    const now = new Date("2026-10-02T05:00:00.000Z");
    const row = ebizNewRow(
      ebizItem(),
      {
        id: 101,
        invoiceNumber: "TEST000101",
        orderNumber: "RENDELES-1",
        customer: {
          address: {
            zipCode: "1111",
            city: "Teszt",
            address: "Kitalált u. 1.",
          },
          taxNumbers: [{ taxNumber: "12345678-2-41", taxType: "HU" }],
        },
        items: [
          {
            name: "Kitalált szolgáltatás",
            quantity: 2,
            unit: "PIECE",
            netUnitAmount: 5000,
            netAmount: 10000,
            vat: "AFA_27",
            vatAmount: 2700,
            grossAmount: 12700,
          },
        ],
      },
      now,
    );
    assert.equal(row.source, "EBIZ");
    assert.equal(row.externalId, "101");
    assert.equal(row.feedMessageId, "EBIZ:101");
    assert.equal(row.feedReceivedAt, now);
    assert.equal(row.kindCode, "SZ");
    assert.equal(row.customerTaxNumber, "12345678-2-41");
    assert.equal(row.customerAddress, "1111 Teszt Kitalált u. 1.");
    assert.equal(row.orderNumber, "RENDELES-1");
    assert.equal(row.lines.length, 1);
    assert.equal(row.lines[0]!.vatRate, "AFA_27");
    assert.equal(row.grossAmount, "12700.00");
    assert.equal(row.issueDate.toISOString(), "2026-09-30T00:00:00.000Z");
    assert.equal(
      row.fulfillmentDate?.toISOString(),
      "2026-09-29T00:00:00.000Z",
    );
    assert.equal(row.paymentsKnown, true);
  });

  it("részletek nélkül is létrejön a sor, tételek nélkül", () => {
    const row = ebizNewRow(ebizItem(), null, new Date());
    assert.deepEqual(row.lines, []);
    assert.equal(row.customerTaxNumber, null);
    assert.equal(ebizListFields(ebizItem({ cancelled: true })).cancelled, true);
  });

  it("a lapozás módját méri, nem találgatja", () => {
    const page = (from: number) =>
      Array.from({ length: 50 }, (_, i) => ({ id: from + i }));
    // offset counts invoices: offset 1 starts with page 0's second invoice
    assert.equal(pagingStep(page(1), page(2), 50), 50);
    // offset counts pages: offset 1 is the next page
    assert.equal(pagingStep(page(1), page(51), 50), 1);
  });
});
