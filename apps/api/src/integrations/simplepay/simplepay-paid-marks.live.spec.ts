import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import { decideSimplePayOrder } from "./simplepay-paid-marks.js";
import { simplePayMarksToWrite } from "./simplepay-paid-marks.live.js";

const order = (orderKey: string, invoiceNumber: string, gross: number) =>
  decideSimplePayOrder({
    orderKey,
    lines: [
      {
        transactionId: `T${orderKey}`,
        transactionStatus: "COMPLETED",
        amount: new Prisma.Decimal(gross),
        currency: "HUF",
        transactionDate: "2026-09-28",
      },
    ],
    invoices: [
      {
        invoiceNumber,
        grossAmount: new Prisma.Decimal(gross),
        currency: "HUF",
        cancelled: false,
        paymentsKnown: false,
        paidAmount: new Prisma.Decimal(0),
        missingPayments: "CARD_AT_ORDER",
      },
    ],
  });

/*
  MI KERÜL A KÖZÖS ÍRÓHOZ. MI PIROSÍT: ha egy nem jóváhagyott jelölés is
  átmenne; ha egy már SimplePay-jelölést kapott számla (más napon) újra
  bekerülne; ha a jóváírás-adat nem a jelölésé (összeg, nap, jogcím,
  megjegyzés, tranzakció-hivatkozás).
*/
describe("simplePayMarksToWrite", () => {
  const decisions = [
    order("665707", "ACRW-2", 5000),
    order("665706", "ACRW-1", 29210),
    order("665708", "ACRW-3", 8000),
  ];

  it("only the approved, and none an earlier SimplePay mark touched", () => {
    const out = simplePayMarksToWrite({
      decisions,
      approved: new Set(["ACRW-1", "ACRW-2", "ACRW-9"]),
      markedBefore: new Set(["ACRW-2"]),
    });
    assert.deepEqual(out, {
      marks: [
        {
          invoiceNumber: "ACRW-1",
          date: "2026-09-28",
          amount: "29210",
          title: "bankkártya",
          note: "SimplePay, 2026-09-28, tranzakció: T665706",
          sourceRef: "T665706",
        },
      ],
      markedBefore: ["ACRW-2"],
    });
  });

  it("nothing approved: nothing to write", () => {
    assert.deepEqual(
      simplePayMarksToWrite({
        decisions,
        approved: new Set(),
        markedBefore: new Set(),
      }).marks,
      [],
    );
  });
});
