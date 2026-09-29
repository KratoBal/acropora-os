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
          compensation: null,
        },
        {
          transferDate: new Date("2026-09-03T00:00:00.000Z"),
          fileName: "100031291_HUF_20260903_080032.xlsx",
          total: 56350,
          invoiceNumbers: ["ACRW-2026/00010", "ACRW-2026/00009"],
          unresolvedLines: [],
          compensation: {
            date: new Date("2026-09-03T00:00:00.000Z"),
            fileName: "100031291_20260903.pdf",
            cod: 56350,
            compensated: 8013,
            transferred: 48337,
            references: ["HU00000009"],
          },
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
    // GLS set its own invoice off against the COD: the rest was transferred
    assert.deepEqual(
      [
        gls.getCell("D5").value,
        gls.getCell("E5").value,
        gls.getCell("F5").value,
      ],
      ["Kompenzáció", 8013, "GLS számla: HU00000009"],
    );
    assert.deepEqual(
      [gls.getCell("D6").value, result(gls.getCell("E6"))],
      ["Utalt", 48337],
    );
    assert.equal(
      (gls.getCell("E6").value as { formula: string }).formula,
      "E4-E5",
    );
    assert.equal(
      gls.getCell("F6").value,
      "Egyezik az értesítővel: 56\u00a0350 Ft - 8013 Ft = 48\u00a0337 Ft.",
    );
    // a day with no letter says so, and transfers the whole COD amount
    assert.equal(
      (gls.getCell("A8").value as Date).toISOString().slice(0, 10),
      "2026-09-10",
    );
    assert.deepEqual(
      [gls.getCell("E9").value, result(gls.getCell("E10"))],
      [0, 27450],
    );
    assert.equal(
      gls.getCell("F10").value,
      "Erre a napra nincs kompenzációs értesítő.",
    );
    const totals: Record<string, unknown> = {};
    gls.eachRow((row) => {
      const label = row.getCell(4).value;
      if (typeof label === "string") totals[label] = result(row.getCell(5));
    });
    // the monthly lines are the last ones with these labels
    assert.deepEqual(
      [totals["Beszedett"], totals["Kompenzáció"], totals["Utalt"]],
      [83800, 8013, 75787],
    );
    assert.ok("Havi összesen" in totals);

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

  it("sends a letter that disagrees with its COD report, and one with no report, to review", async () => {
    const built = await new GlsMonthlyReportXlsx().build(
      2026,
      9,
      [
        {
          transferDate: new Date("2026-09-10T00:00:00.000Z"),
          fileName: "100031291_HUF_20260910_080212.xlsx",
          total: 28900,
          invoiceNumbers: [],
          unresolvedLines: [],
          compensation: {
            date: new Date("2026-09-10T00:00:00.000Z"),
            fileName: "100031291_20260910.pdf",
            cod: 29900,
            compensated: 18111,
            transferred: 11789,
            references: ["HU00000011"],
          },
        },
      ],
      [],
      [
        {
          date: new Date("2026-09-17T00:00:00.000Z"),
          fileName: "100031291_20260917.pdf",
          cod: 6950,
          compensated: 6950,
          transferred: 0,
          references: ["HU00000012"],
        },
      ],
    );
    const workbook = await workbookOf(built.buffer);
    const gls = workbook.getWorksheet("GLS")!;
    assert.match(String(gls.getCell("F6").value), /^ELTÉRÉS: /);
    const review = workbook.getWorksheet("Ellenőrzendő tételek")!;
    assert.deepEqual(
      [2, 3].map((row) => [
        review.getCell(`B${row}`).value,
        String(review.getCell(`G${row}`).value).slice(0, 20),
      ]),
      [
        ["100031291_20260910.pdf", "ELTÉRÉS: az értesítő"],
        ["100031291_20260917.pdf", "Kompenzációs értesít"],
      ],
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
