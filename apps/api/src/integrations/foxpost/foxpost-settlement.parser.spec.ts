import assert from "node:assert/strict";
import { describe, it } from "node:test";
import ExcelJS from "exceljs";

import {
  FoxpostParseError,
  FoxpostSettlementParser,
  parseFoxpostInvoiceTokens,
  validateFoxpostPair,
} from "./foxpost-settlement.parser.js";

async function sampleXlsx(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const summary = workbook.addWorksheet("összesítés");
  summary.getCell("A1").value = "26H31";
  summary.getCell("D1").value = "W0166840";
  summary.getRow(14).values = [
    "Elszámolási időszak:",
    "2026-07-27",
    "-",
    "2026-08-02",
  ];
  summary.getRow(26).values = ["Beszedett összeg:", 97_500];
  summary.getRow(44).values = [
    "FOXPOST által számlázandó bruttó összeg:",
    8_317,
  ];
  summary.getRow(47).values = ["FOXPOST által utalandó összeg:", 89_183];
  workbook.addWorksheet("szolgáltatások");
  const cod = workbook.addWorksheet("utánvétek");
  cod.getRow(9).values = [
    "Megrendelés száma",
    "Megrendelés dátuma",
    "Küldemény vonalkódja",
    "Külső vonalkód",
    "Referencia kód",
    "Tranzakció dátuma",
    "Címzett neve",
    "Beszedett összeg",
  ];
  cod.getRow(10).values = [
    "ÖSSZESEN:",
    "",
    "",
    "",
    "ÖSSZESEN:",
    "",
    "",
    97_500,
  ];
  cod.getRow(11).values = [
    1,
    "20260715",
    "CLFOX1",
    "",
    "47679-174059",
    "20260731",
    "Gábor Kerekes",
    36_800,
  ];
  cod.getRow(12).values = [
    2,
    "20260723",
    "CLFOX2",
    "",
    "47679-103520",
    "20260727",
    "Körmendi Tamás",
    60_700,
  ];
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/**
 * A week without cash on delivery, in the shape of the real 26H30 file
 * (production, 2026-07): the COD sheet has only its header and its
 * "ÖSSZESEN:" row, and Acropora pays the fee. The second "Beszedett összeg:"
 * row of the real file holds a dash; the first one holds the number.
 */
async function weekWithoutCod(collected = 0): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const summary = workbook.addWorksheet("összesítés");
  summary.getCell("A1").value = "26H30";
  summary.getCell("D1").value = "W0166840";
  summary.getRow(14).values = [
    "Elszámolási időszak:",
    "2026-07-20",
    "-",
    "2026-07-26",
  ];
  summary.getRow(26).values = ["Beszedett összeg:", collected];
  summary.getRow(33).values = ["Beszedett összeg:", "-"];
  summary.getRow(44).values = [
    "FOXPOST által számlázandó bruttó összeg:",
    2_283,
  ];
  summary.getRow(46).values = [
    "PARTNER által utalandó összeg (számlázott):",
    2_283,
  ];
  summary.getRow(47).values = ["FOXPOST által utalandó összeg:", 0];
  workbook.addWorksheet("szolgáltatások");
  const cod = workbook.addWorksheet("utánvétek");
  cod.getRow(9).values = [
    "Megrendelés száma",
    "Megrendelés dátuma",
    "Küldemény vonalkódja",
    "Külső vonalkód",
    "Referencia kód",
    "Tranzakció dátuma",
    "Címzett neve",
    "Beszedett összeg",
  ];
  cod.getRow(10).values = [
    "ÖSSZESEN:",
    "ÖSSZESEN:",
    "ÖSSZESEN:",
    "ÖSSZESEN:",
    "ÖSSZESEN:",
    "ÖSSZESEN:",
    "ÖSSZESEN:",
    0,
  ];
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const pdfTokens = [
  "FoxPost Kft.",
  "FX01015386",
  "Invoice No.",
  "/ Számlaszám",
  "2026. Aug 06.",
  "Invoice date",
  "W0166840",
  "Partner code",
  "Expressz postai szolgáltatás Elszámolási időszak: 2026-07-27 - 2026-08-02 26H31",
  "8,317 HUF",
  "Invoice total",
];

describe("FoxpostSettlementParser", () => {
  it("parses the Foxpost utánvétek sheet and uses the summary transfer total", async () => {
    const parsed = await new FoxpostSettlementParser().parseXlsx(
      await sampleXlsx(),
    );
    assert.equal(parsed.partnerCode, "W0166840");
    assert.equal(parsed.settlementCode, "26H31");
    assert.equal(parsed.collectedAmount, 97_500);
    assert.equal(parsed.invoiceGrossAmount, 8_317);
    assert.equal(parsed.transferredAmount, 89_183);
    assert.deepEqual(
      parsed.lines.map((line) => line.referenceCode),
      ["47679-174059", "47679-103520"],
    );
  });

  it("parses the PDF tokens even when values precede their labels", () => {
    const parsed = parseFoxpostInvoiceTokens(pdfTokens);
    assert.equal(parsed.invoiceNumber, "FX01015386");
    assert.equal(
      parsed.invoiceIssueDate.toISOString(),
      "2026-08-06T00:00:00.000Z",
    );
    assert.equal(parsed.invoiceGrossAmount, 8_317);
  });

  it("rejects an XLSX/PDF identity mismatch", async () => {
    const xlsx = await new FoxpostSettlementParser().parseXlsx(
      await sampleXlsx(),
    );
    const pdf = {
      ...parseFoxpostInvoiceTokens(pdfTokens),
      partnerCode: "W9999999",
    };
    assert.throws(
      () => validateFoxpostPair(xlsx, pdf),
      (error) =>
        error instanceof FoxpostParseError &&
        error.code === "FOXPOST_PARTNER_CODE_MISMATCH",
    );
  });

  it("reads a week without cash on delivery as a settlement Acropora pays", async () => {
    const parsed = await new FoxpostSettlementParser().parseXlsx(
      await weekWithoutCod(),
    );
    assert.deepEqual(parsed.lines, []);
    assert.deepEqual(
      [
        parsed.collectedAmount,
        parsed.invoiceGrossAmount,
        parsed.transferredAmount,
        parsed.partnerPaysAmount,
      ],
      [0, 2_283, 0, 2_283],
    );
    // the pair check holds: 0 - 2283 = 0 - 2283
    validateFoxpostPair(parsed, {
      ...parseFoxpostInvoiceTokens(pdfTokens),
      settlementCode: "26H30",
      periodStart: new Date("2026-07-20T00:00:00.000Z"),
      periodEnd: new Date("2026-07-26T00:00:00.000Z"),
      invoiceGrossAmount: 2_283,
    });
  });

  it("still refuses a week whose summary collected money but whose sheet has no line", async () => {
    await assert.rejects(
      new FoxpostSettlementParser().parseXlsx(await weekWithoutCod(5_000)),
      (error: unknown) =>
        error instanceof FoxpostParseError &&
        error.message === "FOXPOST_XLSX_COD_LINES_MISSING",
    );
  });

  it("reads 0 for what Acropora pays when a normal week's file does not carry the row", async () => {
    const parsed = await new FoxpostSettlementParser().parseXlsx(
      await sampleXlsx(),
    );
    assert.equal(parsed.partnerPaysAmount, 0);
  });
});
