import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import type { SimplePaySettlementLineInput } from "./simplepay-paid-marks.js";
import {
  refundsAfterMarks,
  refundsAfterMarksReport,
} from "./simplepay-paid-marks.refunds.js";

const line = (
  transactionStatus: string,
  amount: number,
  transactionDate: string,
): SimplePaySettlementLineInput => ({
  transactionId: `${transactionStatus}-${transactionDate}`,
  transactionStatus,
  amount: new Prisma.Decimal(amount),
  currency: "HUF",
  transactionDate,
});

const mark = (invoiceNumber: string, orderKey: string) => ({
  invoiceNumber,
  orderKey,
  date: "2026-09-28",
  amount: "29210",
});

/*
  A BEÍRÁS UTÁN ÉRKEZŐ VISSZATÉRÍTÉS (acrobot 25997). MI PIROSÍT: ha egy
  visszatérítés nélküli jelölt rendelés is a listára kerülne (zaj, ami a valódit
  eltakarja); ha a negatív előjelű visszatérítés nem számítana; ha a részleges
  teljesnek látszana; ha egy másik rendelés sora keveredne ide.
*/
describe("refundsAfterMarks", () => {
  const lines = new Map([
    ["665706", [line("COMPLETED", 29210, "2026-09-28")]],
    [
      "665707",
      [
        line("COMPLETED", 29210, "2026-09-28"),
        line("REFUND", -29210, "2026-10-05"),
      ],
    ],
    [
      "665708",
      [
        line("COMPLETED", 29210, "2026-09-28"),
        line("REFUND", 5000, "2026-10-06"),
        line("REFUND", 5000, "2026-10-06"),
      ],
    ],
  ]);

  it("lists only the marked orders with a refund, full or partial, either sign", () => {
    const rows = refundsAfterMarks(
      [
        mark("ACRW-3", "665708"),
        mark("ACRW-1", "665706"),
        mark("ACRW-2", "665707"),
        mark("ACRW-4", "999999"),
      ],
      lines,
    );
    assert.deepEqual(
      rows.map((r) => [r.invoiceNumber, r.refunded, r.full, r.refundDates]),
      [
        ["ACRW-2", "29210", true, ["2026-10-05"]],
        ["ACRW-3", "10000", false, ["2026-10-06"]],
      ],
    );
  });

  /*
    A RÉSZLEGES VISSZATÉRÍTÉS JELÖLÉSE UTÁN (c03e9896). MI PIROSÍT: ha a
    csökkentett számla vagy a számla és helyesbítője jelölése után a rendelés
    hírként jönne (zaj); ha a helyesbítő negatív jelölése külön sort kapna; ha
    a visszatérítés előtt teljes összeggel beírt számla, helyesbítő-jelölés
    nélkül, eltűnne a listáról.
  */
  it("a partial refund the written marks already show is not news; the full mark without a corrective is", () => {
    const partial = new Map([
      [
        "665709",
        [
          line("COMPLETED", 30958, "2026-06-10"),
          line("REFUND", -10990, "2026-06-12"),
        ],
      ],
    ]);
    const at = (invoiceNumber: string, amount: string) => ({
      invoiceNumber,
      orderKey: "665709",
      date: "2026-06-10",
      amount,
    });
    assert.deepEqual(refundsAfterMarks([at("R-1", "19968")], partial), []);
    assert.deepEqual(
      refundsAfterMarks([at("R-1", "30958"), at("R-1H", "-10990")], partial),
      [],
    );
    assert.deepEqual(
      refundsAfterMarks([at("R-1", "30958")], partial).map((r) => [
        r.invoiceNumber,
        r.refunded,
        r.full,
      ]),
      [["R-1", "10990", false]],
    );
    // a second refund after the corrective's mark: news, on the invoice's row only
    const again = new Map([
      [
        "665709",
        [...partial.get("665709")!, line("REFUND", -5000, "2026-06-20")],
      ],
    ]);
    assert.deepEqual(
      refundsAfterMarks([at("R-1", "30958"), at("R-1H", "-10990")], again).map(
        (r) => [r.invoiceNumber, r.refunded],
      ),
      [["R-1", "15990"]],
    );
  });

  it("the report says nothing was written back, one line per invoice; empty when none", () => {
    const report = refundsAfterMarksReport(
      refundsAfterMarks([mark("ACRW-2", "665707")], lines),
    );
    assert.equal(
      report,
      "FIGYELEM: 1 már beírt jelölés rendelésére később visszatérítés érkezett (nem írtam vissza semmit):\n" +
        "  ACRW-2\tbeírva 29210 Ft, 2026-09-28\tvisszatérítve 29210 Ft (2026-10-05)\tteljes visszatérítés\n",
    );
    assert.equal(
      refundsAfterMarksReport(
        refundsAfterMarks([mark("ACRW-1", "665706")], lines),
      ),
      "",
    );
  });
});
