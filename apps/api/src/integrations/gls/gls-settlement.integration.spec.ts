import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@acropora/database";
import { ConflictException } from "@nestjs/common";
import ExcelJS from "exceljs";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import { glsXlsx } from "../../testing/gls-xlsx.fixture.js";
import { GlsSettlementRepository } from "./gls-settlement.repository.js";
import { GlsMonthlyReportXlsx } from "./gls-monthly-report.xlsx.js";
import { GlsSettlementService } from "./gls-settlement.service.js";

// What only a database can prove: a report that arrives twice (even with
// other bytes) is stored once, a person's decision survives a re-resolution,
// and an approval against a stale line is refused.
//
// Writes and deletes rows, so it runs only against a database named for
// testing; see integrationDatabaseGate.
const gate = integrationDatabaseGate(process.env);

// Every row this suite creates carries one of these, so an aborted run does
// not poison the next one.
const PARCEL_PREFIX = "9913";
const INVOICE_PREFIX = "GLSIT";
const TEST_EMAIL_DOMAIN = "gls-integration.invalid";

describe("GLS settlement integration", { skip: gate.mode === "skip" }, () => {
  const suffix = String(Date.now()).slice(-6);
  const service = new GlsSettlementService(
    new GlsSettlementRepository(),
    new GlsMonthlyReportXlsx(),
  );
  const invoiceNumber = `${INVOICE_PREFIX}-2026/${suffix.slice(-5)}`;
  const parcel = (n: number) => `${PARCEL_PREFIX}${suffix}${n}`;
  let userId: string;

  function codReport(title: string) {
    return glsXlsx({
      WeeklyThu: [
        [title],
        ["Utalás dátuma: 2026. 09. 03."],
        [
          "Jelentés szám",
          "Csomagszám",
          "Utánvét hivatkozás",
          "Kiszállítási dátum",
          "Utánvét összeg",
          "",
        ],
        ["1", parcel(1), invoiceNumber, "2026-08-28", 1000, "HUF"],
        ["1", parcel(2), "2026/00002", "2026-08-28", 500, "HUF"],
        [null, null, null, null, 1500, "HUF"],
      ],
    });
  }

  before(async () => {
    if (gate.mode === "refuse") throw new Error(gate.reason);
    await removeLeftovers();
    userId = (
      await prisma.user.create({
        data: {
          email: `gls-${suffix}@${TEST_EMAIL_DOMAIN}`,
          displayName: "GLS Integration",
          role: "OWNER",
          isActive: true,
        },
      })
    ).id;
    await prisma.invoice.create({
      data: {
        direction: "OUTBOUND",
        source: "MANUAL",
        invoiceNumber,
        partnerName: "Kitalalt Vevo",
      },
    });
  });

  after(async () => {
    if (gate.mode !== "run") return;
    await removeLeftovers();
    nincsMaradek([
      {
        nev: "GlsCodReportLine by parcel prefix",
        darab: await prisma.glsCodReportLine.count({
          where: { parcelNumber: { startsWith: PARCEL_PREFIX } },
        }),
      },
      {
        nev: "Invoice by number prefix",
        darab: await prisma.invoice.count({
          where: { invoiceNumber: { startsWith: `${INVOICE_PREFIX}-` } },
        }),
      },
      {
        nev: "GlsCompensationLetter by file name prefix",
        darab: await prisma.glsCompensationLetter.count({
          where: { fileName: { startsWith: `${INVOICE_PREFIX}-` } },
        }),
      },
      {
        nev: "User by test domain",
        darab: await prisma.user.count({
          where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } },
        }),
      },
    ]);
  });

  async function removeLeftovers() {
    const reports = await prisma.glsCodReportLine.findMany({
      where: { parcelNumber: { startsWith: PARCEL_PREFIX } },
      select: { reportId: true },
    });
    await prisma.glsCodReport.deleteMany({
      where: { id: { in: [...new Set(reports.map((r) => r.reportId))] } },
    });
    await prisma.invoice.deleteMany({
      where: { invoiceNumber: { startsWith: `${INVOICE_PREFIX}-` } },
    });
    await prisma.glsCompensationLetter.deleteMany({
      where: { fileName: { startsWith: `${INVOICE_PREFIX}-` } },
    });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } },
    });
  }

  let reportId: string;

  it("stores a report, resolves the invoice number, sends the bare one to review", async () => {
    const result = await service.upload(
      codReport("GLS General Logistics Systems Hungary Kft."),
      "report.xlsx",
      userId,
    );
    assert.equal(result.kind, "COD_REPORT");
    assert.equal(result.duplicate, false);
    assert.equal(result.newlyResolvedLineCount, 1);
    reportId = result.id;
    const detail = await service.reportDetail(reportId);
    assert.equal(detail.status, "NEEDS_REVIEW");
    assert.deepEqual(
      detail.lines.map((line) => [
        line.status,
        line.invoiceNumbers,
        line.errorCode,
        line.suggestedInvoiceNumber,
      ]),
      [
        ["RESOLVED", [invoiceNumber], undefined, undefined],
        ["NEEDS_REVIEW", [], "PREFIX_MISSING", "ACRW-2026/00002"],
      ],
    );
  });

  it("stores a report that arrives again with other bytes only once", async () => {
    const again = await service.upload(
      codReport("GLS General Logistics Systems Hungary Kft. (ujrakuldve)"),
      "report-again.xlsx",
      userId,
    );
    assert.deepEqual([again.id, again.duplicate], [reportId, true]);
    assert.equal(
      await prisma.glsCodReport.count({ where: { id: reportId } }),
      1,
    );
  });

  it("refuses an approval against a stale line, then keeps the person's decision", async () => {
    const open = (await service.reportDetail(reportId)).lines[1]!;
    await assert.rejects(
      service.approveLine(
        reportId,
        open.id,
        {
          invoiceNumber: "ACRW-2026/00002",
          expectedUpdatedAt: "2020-01-01T00:00:00.000Z",
        },
        userId,
      ),
      ConflictException,
    );
    const approved = await service.approveLine(
      reportId,
      open.id,
      { invoiceNumber: "ACRW-2026/00002", expectedUpdatedAt: open.updatedAt },
      userId,
    );
    assert.equal(approved.status, "COMPLETED");
    assert.equal(approved.lines[1]!.resolutionSource, "MANUAL");

    const reprocessed = await service.reprocess(reportId);
    assert.deepEqual(reprocessed.lines[1]!.invoiceNumbers, ["ACRW-2026/00002"]);
    assert.equal(reprocessed.lines[1]!.resolutionSource, "MANUAL");
    assert.equal(
      reprocessed.lines[1]!.manualApprovedByDisplayName,
      "GLS Integration",
    );
  });

  it("puts the month's transfer and its invoice into the accountant's file, and not the next month's", async () => {
    const september = await service.monthlyReport(2026, 9);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(september.buffer as unknown as ExcelJS.Buffer);
    const column: unknown[] = [];
    workbook
      .getWorksheet("GLS")!
      .eachRow((row) => column.push(row.getCell(2).value));
    assert.ok(column.includes(invoiceNumber));

    const october = await service.monthlyReport(2026, 10);
    const empty = new ExcelJS.Workbook();
    await empty.xlsx.load(october.buffer as unknown as ExcelJS.Buffer);
    const none: unknown[] = [];
    empty
      .getWorksheet("GLS")!
      .eachRow((row) => none.push(row.getCell(2).value));
    assert.ok(!none.includes(invoiceNumber));
  });

  it("stores a compensation letter once, and sets it off in its day's block", async () => {
    const repository = new GlsSettlementRepository();
    const source = {
      fileName: `${INVOICE_PREFIX}-${suffix}.pdf`,
      sha256: `${INVOICE_PREFIX}-${suffix}`,
      content: Buffer.from("%PDF"),
      uploadedByUserId: userId,
    };
    const letter = {
      // the day of the stored COD report above, whose total is 1 500
      date: "2026-09-03",
      clientNumber: "3480031291",
      cod: 1500,
      compensated: 500,
      transferred: 1000,
      references: [`HU${suffix}00`],
      debt: 700,
      remaining: 200,
    };
    const first = await repository.createCompensationLetter(source, letter);
    const again = await repository.createCompensationLetter(source, letter);
    assert.deepEqual(
      [first.duplicate, again.duplicate, again.id],
      [false, true, first.id],
    );

    const september = await service.monthlyReport(2026, 9);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(september.buffer as unknown as ExcelJS.Buffer);
    const gls = workbook.getWorksheet("GLS")!;
    let collectedRow = 0;
    gls.eachRow((row, number) => {
      if (row.getCell(4).value === "Beszedett" && row.getCell(5).value === 1500)
        collectedRow = number;
    });
    assert.ok(collectedRow > 0, "the day's block is in the file");
    const cell = (row: number, column: number) => {
      const value = gls.getCell(row, column).value as
        { result?: unknown } | unknown;
      return value && typeof value === "object" && "result" in value
        ? value.result
        : value;
    };
    assert.deepEqual(
      [
        cell(collectedRow + 1, 4),
        cell(collectedRow + 1, 5),
        cell(collectedRow + 2, 4),
        cell(collectedRow + 2, 5),
      ],
      ["Kompenzáció", 500, "Utalt", 1000],
    );
    assert.match(String(cell(collectedRow + 2, 6)), /^Egyezik az értesítővel/);
  });
});
