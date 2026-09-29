import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@acropora/database";
import { ConflictException } from "@nestjs/common";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import { glsXlsx } from "../../testing/gls-xlsx.fixture.js";
import { GlsSettlementRepository } from "./gls-settlement.repository.js";
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
  const service = new GlsSettlementService(new GlsSettlementRepository());
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
});
