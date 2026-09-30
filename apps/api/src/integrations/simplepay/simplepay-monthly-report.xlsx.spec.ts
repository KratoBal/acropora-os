import assert from "node:assert/strict";
import { describe, it } from "node:test";
import ExcelJS from "exceljs";

import {
  SimplePayMonthlyReportXlsx,
  type SimplePayReportBlock,
} from "./simplepay-monthly-report.xlsx.js";

async function read(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  return workbook;
}

/** Column B and the label/amount columns of the main sheet, row by row. */
function rows(sheet: ExcelJS.Worksheet) {
  const out: Array<[string, string, unknown]> = [];
  sheet.eachRow((row) => {
    const amount = row.getCell(5).value;
    out.push([
      String(row.getCell(2).value ?? ""),
      String(row.getCell(4).value ?? ""),
      amount && typeof amount === "object" && "result" in amount
        ? amount.result
        : amount,
    ]);
  });
  return out;
}

// the 2026-07-27..31 report (report_20260805.csv) as measured on 2026-09-30
const week: SimplePayReportBlock = {
  reportDate: new Date("2026-08-05T00:00:00Z"),
  fileName: "report_20260805.csv",
  amountTotal: 167923,
  commissionTotal: 4120,
  netTotal: 163803,
  invoiceNumbers: ["ACRW-2026/00438", "ACRW-2026/00437"],
  notInvoiced: [{ amount: 140140, orderNumber: "UNAS-47679-608888" }],
  review: [
    {
      merchantTransactionId: "106638476T608888",
      transactionAt: "2026-07-30 18:45:29",
      amount: 140140,
      orderNumber: "UNAS-47679-608888",
      reason: "A rendelésnek még nincs számlája",
    },
  ],
};

describe("SimplePayMonthlyReportXlsx", () => {
  it("writes each week as Luca's table does: its invoices, the order not yet invoiced, Összesen, Jutalék, Utalt", async () => {
    const { filename, buffer } = await new SimplePayMonthlyReportXlsx().build(
      2026,
      8,
      [week],
    );
    assert.equal(filename, "simplepay-2026-08.xlsx");
    const workbook = await read(buffer);
    const main = rows(workbook.getWorksheet("SimplePay")!);
    const block = main.filter(([invoice, label]) => invoice || label);
    assert.deepEqual(block.slice(2, 5), [
      ["ACRW-2026/00437", "Összesen", 167923],
      ["ACRW-2026/00438", "Jutalék", 4120],
      [
        "140 140 Ft még nem teljesített rendelés (UNAS-47679-608888)",
        "Utalt",
        163803,
      ],
    ]);
    // the month's totals add the weeks up
    assert.deepEqual(
      main
        .filter(([, label]) => label)
        .slice(-3)
        .map(([, l, v]) => [l, v]),
      [
        ["Összesen", 167923],
        ["Jutalék", 4120],
        ["Utalt", 163803],
      ],
    );
    const review = workbook.getWorksheet("Ellenőrzendő fizetések")!;
    assert.equal(review.getRow(2).getCell(2).value, "106638476T608888");
    assert.equal(
      review.getRow(2).getCell(6).value,
      "A rendelésnek még nincs számlája",
    );
  });

  it("names payments that need a person, beyond the not-yet-invoiced ones", async () => {
    const { buffer } = await new SimplePayMonthlyReportXlsx().build(2026, 8, [
      {
        ...week,
        review: [
          ...week.review,
          {
            merchantTransactionId: "KEZI-0001",
            transactionAt: "2026-07-31 00:46:11",
            amount: 500,
            orderNumber: null,
            reason: "Az azonosítóból nem olvasható ki a rendelés",
          },
        ],
      },
    ]);
    const main = rows((await read(buffer)).getWorksheet("SimplePay")!);
    assert.ok(
      main.some(
        ([invoice]) => invoice === "1 fizetés ellenőrzendő (külön lapon)",
      ),
    );
  });

  it("says so when the month has no report and nothing to check", async () => {
    const workbook = await read(
      (await new SimplePayMonthlyReportXlsx().build(2026, 1, [])).buffer,
    );
    assert.equal(
      workbook.getWorksheet("SimplePay")!.getRow(4).getCell(2).value,
      "Ebben a hónapban nincs SimplePay kimutatás.",
    );
    assert.equal(
      workbook.getWorksheet("Ellenőrzendő fizetések")!.getRow(2).getCell(1)
        .value,
      "Nincs ellenőrzendő fizetés.",
    );
  });
});
