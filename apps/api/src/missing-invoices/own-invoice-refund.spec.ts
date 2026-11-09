import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import {
  ownInvoiceRefund,
  type OwnInvoiceDocument,
} from "./own-invoice-refund.js";

/**
 * A VEVŐNEK VISSZAUTALT ÖSSZEG (kártya a116ec70: az „E-CRPR-2026-1 utalás vissza” közleményű 11 287 062 Ft terhelés
 * „Kérd el a számlát a partnertől” lett). MI PIROSÍT: ha a szám-egyezés előtag szerinti (az -1 megtalálná a -13-at);
 * ha a sztornó összege, pénzneme vagy vevője nem kell az egyezéshez; ha a sztornó nélküli számla-hivatkozás is
 * visszatérítés lenne; ha a sztornó kelte az ablakon kívül is jó; ha a közlemény nélküli vagy névtelen terhelés is egyezne.
 */
const zoo = "Fővárosi Állat- és Növénykert";
const money = (value: string) => new Prisma.Decimal(value);
const invoice = (
  over: Partial<OwnInvoiceDocument> = {},
): OwnInvoiceDocument => ({
  number: "E-CRPR-2026-1",
  kindCode: "SZ",
  customerName: zoo,
  gross: money("11287062"),
  currency: "HUF",
  issueDate: "2026-10-20",
  ...over,
});
const storno = (over: Partial<OwnInvoiceDocument> = {}): OwnInvoiceDocument =>
  invoice({
    number: "E-CRPR-2026-14",
    kindCode: "SS",
    gross: money("-11287062"),
    issueDate: "2026-11-05",
    ...over,
  });
const debit = (over: Record<string, unknown> = {}) => ({
  bookingDate: "2026-11-04",
  amount: money("11287062"),
  currency: "HUF",
  counterpartyName: zoo,
  narrative: "E-CRPR-2026-1 utalas vissza",
  ...over,
});

describe("a refund of one of our own invoices", () => {
  it("is recognised: the narrative names our invoice and a storno of the same customer and amount exists", () => {
    const found = ownInvoiceRefund(debit(), [invoice(), storno()]);
    assert.equal(found?.cited, "E-CRPR-2026-1");
    assert.equal(found?.credit.number, "E-CRPR-2026-14");
  });

  it("takes a credit note (JS) like a storno, and the sign of the credit's total does not matter", () => {
    const found = ownInvoiceRefund(debit(), [
      invoice(),
      storno({ kindCode: "JS", gross: money("11287062") }),
    ]);
    assert.equal(found?.credit.kindCode, "JS");
  });

  it("matches the invoice number as a whole word, not as a prefix", () => {
    // the narrative names ...-1; only ...-13 is ours here
    assert.equal(
      ownInvoiceRefund(debit(), [
        invoice({ number: "E-CRPR-2026-13" }),
        storno(),
      ]),
      null,
    );
  });

  it("is nothing without a number of ours in the narrative", () => {
    assert.equal(
      ownInvoiceRefund(debit({ narrative: "utalas vissza" }), [
        invoice(),
        storno(),
      ]),
      null,
    );
    // a storno's own number is not the invoice that was refunded
    assert.equal(
      ownInvoiceRefund(debit({ narrative: "E-CRPR-2026-14" }), [
        invoice(),
        storno(),
      ]),
      null,
    );
  });

  it("is nothing without a storno that matches the amount, the currency, the customer and the window", () => {
    assert.equal(ownInvoiceRefund(debit(), [invoice()]), null);
    const cases: Array<Partial<OwnInvoiceDocument>> = [
      { gross: money("-11287061") },
      { currency: "EUR" },
      { customerName: "Teljesen Más Kft." },
      { issueDate: "2025-01-05" },
    ];
    for (const over of cases)
      assert.equal(
        ownInvoiceRefund(debit(), [invoice(), storno(over)]),
        null,
        JSON.stringify(over),
      );
  });

  it("is nothing for a debit without a payee name", () => {
    assert.equal(
      ownInvoiceRefund(debit({ counterpartyName: null }), [
        invoice(),
        storno(),
      ]),
      null,
    );
  });
});
