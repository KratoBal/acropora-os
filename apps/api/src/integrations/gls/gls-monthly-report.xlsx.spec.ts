import assert from "node:assert/strict";
import { describe, it } from "node:test";
import ExcelJS from "exceljs";

import { GlsMonthlyReportXlsx } from "./gls-monthly-report.xlsx.js";

async function workbookOf(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  return workbook;
}

function result(cell: ExcelJS.Cell): unknown {
  const value = cell.value as { result?: unknown } | null;
  return value && typeof value === "object" && "result" in value
    ? value.result
    : cell.value;
}

describe("GlsMonthlyReportXlsx", () => {
  it("writes a block per transfer, the fee invoices apart, and the open lines", async () => {
    const built = await new GlsMonthlyReportXlsx().build(
      2026,
      9,
      [
        {
          transferDate: new Date("2026-09-10T00:00:00.000Z"),
          fileName: "100031291_HUF_20260910_080212.xlsx",
          total: 27450,
          invoiceNumbers: [],
          unresolvedLines: [
            {
              rowNumber: 9,
              parcelNumber: "1000000002",
              codReference: "2026/00002",
              amount: 27450,
              reason: "Előtag nélküli számlaszám",
            },
          ],
        },
        {
          transferDate: new Date("2026-09-03T00:00:00.000Z"),
          fileName: "100031291_HUF_20260903_080032.xlsx",
          total: 56350,
          invoiceNumbers: ["ACRW-2026/00010", "ACRW-2026/00009"],
          unresolvedLines: [],
        },
      ],
      [
        {
          invoiceNumber: "HU00000001",
          invoiceDate: new Date("2026-09-18T00:00:00.000Z"),
          parcelCount: 6,
          feeTotal: 20795,
          cardFeeTotal: 286,
        },
      ],
    );
    assert.equal(built.filename, "gls-2026-09.xlsx");
    const workbook = await workbookOf(built.buffer);
    assert.deepEqual(
      workbook.worksheets.map((sheet) => sheet.name),
      ["GLS", "GLS számlák", "Ellenőrzendő tételek"],
    );

    const gls = workbook.getWorksheet("GLS")!;
    // the earlier transfer first; its invoices in number order
    assert.equal(
      (gls.getCell("A4").value as Date).toISOString().slice(0, 10),
      "2026-09-03",
    );
    assert.deepEqual(
      [gls.getCell("B4").value, gls.getCell("B5").value],
      ["ACRW-2026/00009", "ACRW-2026/00010"],
    );
    assert.deepEqual(
      [gls.getCell("D4").value, gls.getCell("E4").value],
      ["Beszedett", 56350],
    );
    // the whole COD amount is transferred: no fee row in the block
    assert.deepEqual(
      [gls.getCell("D5").value, result(gls.getCell("E5"))],
      ["Utalt", 56350],
    );
    const labels: unknown[] = [];
    gls.eachRow((row) => labels.push(row.getCell(4).value));
    assert.ok(!labels.includes("Számla"));
    assert.ok(labels.includes("Havi összesen"));

    const invoices = workbook.getWorksheet("GLS számlák")!;
    assert.equal(invoices.getCell("B2").value, "HU00000001");
    assert.equal(result(invoices.getCell("F2")), 21081);

    const review = workbook.getWorksheet("Ellenőrzendő tételek")!;
    assert.deepEqual(
      [
        review.getCell("D2").value,
        review.getCell("E2").value,
        review.getCell("G2").value,
      ],
      ["1000000002", "2026/00002", "Előtag nélküli számlaszám"],
    );
  });

  it("says so when a month has nothing to check", async () => {
    const built = await new GlsMonthlyReportXlsx().build(2026, 8, [], []);
    const workbook = await workbookOf(built.buffer);
    assert.equal(
      workbook.getWorksheet("Ellenőrzendő tételek")!.getCell("A2").value,
      "Nincs ellenőrzendő tétel.",
    );
    assert.equal(
      workbook.getWorksheet("GLS számlák")!.getCell("B2").value,
      "Nincs GLS számla ebben a hónapban.",
    );
  });
});
