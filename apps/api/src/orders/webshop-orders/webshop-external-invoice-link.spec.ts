import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  linkExternalInvoices,
  mentionsNumber,
  type LinkCandidate,
  type LinkProforma,
} from "./webshop-external-invoice-link.js";

/*
  A SZÁMLÁZZ.HU SZÁMLÁJA A RENDELÉSHEZ (bb3a6bd5). MI PIROSÍT:
  - a rendelésszámmal érkező számla nem kötődik, vagy a gyengébb út előzi;
  - a díjbekérő számát megnevező számla nem kötődik;
  - a gyenge (vevő és összeg) kötés nincs jelölve, vagy két jelöltből választ;
  - egy számla két rendeléshez kötődik;
  - sztornózott, sztornó (SS), a díjbekérő előtti vagy maga a díjbekérő kötődik.
*/
const proforma = (
  n: number,
  over: Partial<LinkProforma> = {},
): LinkProforma => ({
  orderId: `order_${n}`,
  number: `D-${n}`,
  reference: `Webshop rendelés #${n}`,
  partnerName: "Teszt Elek",
  grossAmount: "4800.0000",
  issuedOn: "2026-10-06",
  ...over,
});
const invoice = (
  id: string,
  over: Partial<LinkCandidate> = {},
): LinkCandidate => ({
  id,
  kindCode: "SZ",
  documentNumber: `E-${id}`,
  orderNumber: null,
  customerName: "Valaki Más",
  grossAmount: "1000.00",
  issueDate: "2026-10-07",
  cancelled: false,
  mentions: [],
  ...over,
});

describe("linking the Számlázz.hu invoice to the order", () => {
  it("by the order number first, then by the proforma number named in the message", () => {
    const result = linkExternalInvoices(
      [proforma(55), proforma(56)],
      [
        invoice("a", { orderNumber: " Webshop rendelés #55 " }),
        invoice("b", { mentions: ["D-56"] }),
        // the same buyer and amount would also fit 55: the order number wins
        invoice("c", { customerName: "Teszt Elek", grossAmount: "4800" }),
      ],
    );
    assert.deepEqual(result.get("order_55"), {
      id: "a",
      number: "E-a",
      link: "ORDER_NUMBER",
    });
    assert.deepEqual(result.get("order_56"), {
      id: "b",
      number: "E-b",
      link: "PROFORMA_NUMBER",
    });
  });

  it("by buyer and amount only as the marked weak link, and only when one fits", () => {
    const one = linkExternalInvoices(
      [proforma(55)],
      [
        invoice("c", {
          customerName: "  teszt  ELEK ",
          grossAmount: "4800.00",
        }),
      ],
    );
    assert.equal(one.get("order_55")?.link, "BUYER_AMOUNT");

    const two = linkExternalInvoices(
      [proforma(55)],
      [
        invoice("c", { customerName: "Teszt Elek", grossAmount: "4800" }),
        invoice("d", { customerName: "Teszt Elek", grossAmount: "4800" }),
      ],
    );
    assert.equal(two.has("order_55"), false);

    const otherAmount = linkExternalInvoices(
      [proforma(55)],
      [invoice("c", { customerName: "Teszt Elek", grossAmount: "4801" })],
    );
    assert.equal(otherAmount.has("order_55"), false);
  });

  it("one invoice is never the invoice of two orders", () => {
    const result = linkExternalInvoices(
      [proforma(55), proforma(57)],
      [invoice("c", { customerName: "Teszt Elek", grossAmount: "4800" })],
    );
    assert.equal(result.size, 0);
  });

  it("not a cancelled one, a reversal, one before the proforma, or the proforma itself", () => {
    for (const over of [
      { cancelled: true },
      { kindCode: "SS" },
      { issueDate: "2026-10-05" },
      { documentNumber: "D-55" },
    ]) {
      const result = linkExternalInvoices(
        [proforma(55)],
        [invoice("a", { orderNumber: "Webshop rendelés #55", ...over })],
      );
      assert.equal(result.has("order_55"), false, JSON.stringify(over));
    }
  });
});

describe("the raw message names the proforma number", () => {
  it("as a whole word, never inside a longer number", () => {
    assert.equal(
      mentionsNumber("<megjegyzes>D-ACR-1</megjegyzes>", "D-ACR-1"),
      true,
    );
    assert.equal(mentionsNumber("díjbekérő: D-ACR-1.", "D-ACR-1"), true);
    assert.equal(mentionsNumber("<x>D-ACR-12</x>", "D-ACR-1"), false);
    assert.equal(mentionsNumber("XD-ACR-1", "D-ACR-1"), false);
    assert.equal(mentionsNumber("D-ACR-1(2)", "D-ACR-1(2)"), true);
  });
});
