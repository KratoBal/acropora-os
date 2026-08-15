import assert from "node:assert/strict";
import { describe, it } from "node:test";
import ExcelJS from "exceljs";

import { FoxpostMonthlyReportXlsx } from "./foxpost-monthly-report.xlsx.js";

describe("FoxpostMonthlyReportXlsx", () => {
  it("writes typed dates, numbers and auditable transfer formulas", async () => {
    const report = await new FoxpostMonthlyReportXlsx().build(2026, 8, [
      {
        invoiceIssueDate: new Date("2026-08-06T00:00:00.000Z"),
        settlementCode: "26H31",
        foxpostInvoiceNumber: "FX01015386",
        collectedAmount: 97_500,
        invoiceGrossAmount: 8_317,
        transferredAmount: 89_183,
        invoiceNumbers: [
          "ACRW-2026/00409",
          "ACRW-2026/00409",
          "ACRW-2026/00408",
        ],
        unresolvedLines: [
          {
            gmailMessageId: "gmail-message-1",
            gmailSubject: "FOXPOST heti elszámolás",
            sourceRowNumber: 14,
            referenceCode: "ACRW-2026/00400",
            transactionDate: new Date("2026-08-01T00:00:00.000Z"),
            recipientName: "Kovács András",
            parcelBarcode: "CLFOX123",
            collectedAmount: 4_000,
            status: "ORDER_NOT_FOUND",
            errorCode: "FOXPOST_UNAS_ORDER_NOT_FOUND",
          },
        ],
      },
    ]);
    assert.equal(report.filename, "foxpost-2026-08.xlsx");
    assert.equal(report.invoiceCount, 2);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(report.buffer as unknown as ExcelJS.Buffer);
    const sheet = workbook.getWorksheet("FOXPOST");
    assert.ok(sheet);
    assert.ok(sheet.getCell("A4").value instanceof Date);
    assert.equal(sheet.getCell("B4").value, "ACRW-2026/00408");
    assert.equal(sheet.getCell("B5").value, "ACRW-2026/00409");
    assert.equal(sheet.getCell("E4").value, 97_500);
    assert.deepEqual(sheet.getCell("E6").value, {
      formula: "E4-E5",
      result: 89_183,
    });
    assert.equal(sheet.getCell("F5").value, "FX01015386");
    const reviewSheet = workbook.getWorksheet("Ellenőrzendő tételek");
    assert.ok(reviewSheet);
    assert.equal(reviewSheet.getCell("A2").value, "26H31");
    assert.equal(reviewSheet.getCell("C2").value, "gmail-message-1");
    assert.equal(reviewSheet.getCell("F2").value, "ACRW-2026/00400");
    assert.equal(reviewSheet.getCell("J2").value, 4_000);
    assert.equal(reviewSheet.getCell("K2").value, "Rendelés nem található");
  });
});
