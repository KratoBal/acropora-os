import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  UnasInvoiceTaxMeasurement,
  invoiceHuTaxNumber,
  unasInvoiceTaxCounts,
  unasInvoiceTaxLines,
  type UnasInvoiceTaxRow,
} from "./unas-customer-invoice-tax.js";

/*
  WHAT TURNS THIS RED (acrobot 42630). An invoice bound only through its order not counted; a non-UNAS customer's
  invoice counted; one number in two shapes counted as a contradiction; a foreign or empty number counted as
  Hungarian; the partner tax number read over the sent snapshot's; a log line with another head, two numbers, or a
  failure that throws.
*/
const row = (over: Partial<UnasInvoiceTaxRow> = {}): UnasInvoiceTaxRow => ({
  customerId: null,
  partnerTaxNumber: null,
  buyerSnapshot: null,
  salesOrder: null,
  ...over,
});

describe("the buyer's Hungarian tax number on an invoice", () => {
  it("the snapshot's first, the partner tax number only without it; dotted; foreign is none", () => {
    assert.equal(
      invoiceHuTaxNumber(
        row({
          buyerSnapshot: { taxNumber: "15490658242" },
          partnerTaxNumber: "11111111-1-11",
        }),
      ),
      "15490658-2-42",
    );
    assert.equal(
      invoiceHuTaxNumber(row({ partnerTaxNumber: " 11111111-1-11 " })),
      "11111111-1-11",
    );
    assert.equal(
      invoiceHuTaxNumber(row({ partnerTaxNumber: "DE123456789" })),
      null,
    );
    assert.equal(
      invoiceHuTaxNumber(row({ buyerSnapshot: { taxNumber: " " } })),
      null,
    );
  });
});

describe("the counts", () => {
  it("binds through the customer or the order, and splits one, many and none", () => {
    const counts = unasInvoiceTaxCounts(
      ["one", "many", "none", "noinvoice", "vat"],
      [
        // one number in two shapes, the second bound through the order only
        row({ customerId: "one", partnerTaxNumber: "15490658242" }),
        row({
          salesOrder: { customerId: "one" },
          buyerSnapshot: { taxNumber: "15490658-2-42" },
        }),
        row({ customerId: "many", partnerTaxNumber: "11111111-1-11" }),
        row({ customerId: "many", partnerTaxNumber: "22222222-2-22" }),
        row({ customerId: "none", partnerTaxNumber: "DE123456789" }),
        // one company whose VAT code changed: contradictory by the full number, not by the base (barracuda, #2188)
        row({ customerId: "vat", partnerTaxNumber: "33333333-1-42" }),
        row({ customerId: "vat", partnerTaxNumber: "33333333-2-42" }),
        // not a UNAS customer, neither directly nor through the order
        row({ customerId: "other", salesOrder: { customerId: "other" } }),
      ],
    );
    assert.deepEqual(counts, {
      unasCustomers: 5,
      customersWithInvoice: 4,
      invoices: 7,
      invoicesBoundThroughOrder: 1,
      invoicesWithHuTaxNumber: 6,
      customersUnambiguous: 1,
      customersContradictory: 2,
      customersContradictoryByBase: 1,
      customersWithoutHuTaxNumber: 1,
    });
  });
});

describe("the start log", () => {
  it("one number per line, the same head", () => {
    const lines = unasInvoiceTaxLines({
      ok: true,
      counts: unasInvoiceTaxCounts(["a"], [row({ customerId: "a" })]),
    });
    assert.equal(lines.length, 9);
    for (const line of lines)
      assert.match(line, /^UNAS-VEVO-SZAMLA-ADOSZAM [a-z_]+=\d+$/);
    assert.equal(lines[0], "UNAS-VEVO-SZAMLA-ADOSZAM unas_vevo=1");
  });

  it("a failure is one line with the error's type, not its text, and does not throw", async () => {
    const measurement = new UnasInvoiceTaxMeasurement({
      rows: async () => {
        throw new TypeError("a customer's name");
      },
    } as never);
    assert.deepEqual(await measurement.runOnce(), [
      "UNAS-VEVO-SZAMLA-ADOSZAM HIBA ok=TypeError",
    ]);
  });
});
