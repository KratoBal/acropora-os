import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@acropora/database";
import ExcelJS from "exceljs";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import { SimplePayMonthlyReportXlsx } from "./simplepay-monthly-report.xlsx.js";
import { SimplePaySettlementRepository } from "./simplepay-settlement.repository.js";
import { SimplePaySettlementService } from "./simplepay-settlement.service.js";

// What only a database can prove: a weekly report is stored once, even when
// its bytes differ; each payment is tied to its order ("UNAS-47679-<the six
// digits after the T>") and that order's outgoing invoice; a missing order,
// an order without an invoice and an order with another total are told
// apart; an order invoiced later resolves on reprocess; a person's decision
// is kept. The buyer's name and e-mail never reach a line.
const gate = integrationDatabaseGate(process.env);

const FILE_PREFIX = "spit-";
const INVOICE_PREFIX = "SPIT";

const HEADER =
  "Tranzakció státusz;Fizetés típusa;SimplePay tranzakció ID;Kereskedői tranzakció ID;Tranzakció dátuma;Teljesítés dátuma;Devizanem;Tranzakciós jutalék;Bankközi díj / Kedvezményalap díj;Kártyatársasági díj és ONUS tranzakció feldolgozási díj / Rendszerhasználati díj;Kereskedői díj;Tranzakció összege;Jutalékkal csökkentett összeg;Partner;Fiók név;Fiók URL;Vásárló;E-mail cím;";

describe(
  "SimplePay settlement integration",
  { skip: gate.mode === "skip" },
  () => {
    const service = new SimplePaySettlementService(
      new SimplePaySettlementRepository(),
      new SimplePayMonthlyReportXlsx(),
    );
    const s5 = String(Date.now()).slice(-5);
    const key = (lead: string) => `${lead}${s5}`;
    const order = (lead: string) => `UNAS-47679-${key(lead)}`;
    const invoiceNumber = `${INVOICE_PREFIX}-2026/${s5}`;
    const laterInvoice = `${INVOICE_PREFIX}-2026/L${s5}`;
    const spId = (n: number) => `9${s5}${n}`;

    const row = (n: number, merchantId: string, amount: number) =>
      [
        "COMPLETED",
        "Bankkártyás fizetés",
        spId(n),
        merchantId,
        "2026-09-22 14:14:26",
        "2026-09-22 14:16:32",
        "HUF",
        "100,00",
        "10,00",
        "20,00",
        "70,00",
        `${amount},00`,
        `${amount - 100},00`,
        "KITALALT Kft.",
        "KITALALT Kft.",
        "https://example.com",
        "Kitalalt Vevo",
        "vevo@example.com",
        "",
      ].join(";");

    const csv = (extra = "") =>
      Buffer.from(
        "\uFEFF" +
          [
            HEADER,
            row(1, `111T${key("8")}`, 38477), // invoiced order
            row(2, `111T${key("7")}`, 7693), // order, no invoice yet
            row(3, `111T${key("6")}`, 8330), // order with another total
            row(4, `111T${key("5")}`, 1000), // no such order
            row(5, "KEZI-0001", 500), // no order key at all
          ].join("\r\n") +
          "\r\n" +
          extra,
        "utf8",
      );

    const BODY =
      "megküldjük a https://example.com elfogadóhelyen 2026.09.21 - 2026.09.27 forgalmi időszakról készült kimutatást. Tranzakciók száma: 4 Tranzakciók végösszege: 56 000 HUF Tranzakciós jutalék: 500 HUF ";

    let reportId = "";
    let userId = "";

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      userId = (
        await prisma.user.create({
          data: {
            email: `simplepay-${s5}@simplepay-integration.invalid`,
            displayName: "SimplePay integration",
            role: "OWNER",
            isActive: true,
          },
        })
      ).id;
      for (const [lead, total] of [
        ["8", 38477],
        ["7", 7693],
        ["6", 9000],
      ] as const)
        await prisma.salesOrder.create({
          data: {
            orderNumber: order(lead),
            channel: "UNAS",
            totalGross: total,
          },
        });
      const invoiced = await prisma.salesOrder.findUniqueOrThrow({
        where: { orderNumber: order("8") },
      });
      await prisma.invoice.create({
        data: {
          direction: "OUTBOUND",
          source: "MANUAL",
          invoiceNumber,
          partnerName: "Kitalalt Vevo",
          salesOrderId: invoiced.id,
        },
      });
    });

    after(async () => {
      if (gate.mode !== "run") return;
      await removeLeftovers();
      nincsMaradek([
        {
          nev: "SimplePayReport by file prefix",
          darab: await prisma.simplePayReport.count({
            where: { fileName: { startsWith: FILE_PREFIX } },
          }),
        },
        {
          nev: "SalesOrder by test order key",
          darab: await prisma.salesOrder.count({
            where: { orderNumber: { endsWith: s5, startsWith: "UNAS-47679-" } },
          }),
        },
        {
          nev: "Invoice by test prefix",
          darab: await prisma.invoice.count({
            where: { invoiceNumber: { startsWith: INVOICE_PREFIX } },
          }),
        },
        {
          nev: "User by test domain",
          darab: await prisma.user.count({
            where: { email: { endsWith: "@simplepay-integration.invalid" } },
          }),
        },
      ]);
    });

    async function removeLeftovers() {
      await prisma.simplePayReport.deleteMany({
        where: { fileName: { startsWith: FILE_PREFIX } },
      });
      await prisma.invoice.deleteMany({
        where: { invoiceNumber: { startsWith: INVOICE_PREFIX } },
      });
      await prisma.salesOrder.deleteMany({
        where: { orderNumber: { endsWith: s5, startsWith: "UNAS-47679-" } },
      });
      await prisma.user.deleteMany({
        where: { email: { endsWith: "@simplepay-integration.invalid" } },
      });
    }

    it("stores the report once, ties each payment to its order and invoice, and says why not", async () => {
      const result = await service.ingest(
        csv(),
        `${FILE_PREFIX}report_20260930.csv`,
        { actorUserId: null, gmailMessageId: null, mailBody: BODY },
      );
      assert.deepEqual(
        [result.duplicate, result.lineCount, result.resolvedLineCount],
        [false, 5, 1],
      );
      reportId = result.id;

      const detail = await service.reportDetail(reportId);
      assert.deepEqual(
        [
          detail.reportDate,
          detail.periodStart,
          detail.periodEnd,
          detail.status,
        ],
        ["2026-09-30", "2026-09-21", "2026-09-27", "NEEDS_REVIEW"],
      );
      // the mail says 4 payments and 56 000; the file has 5 and 56 000
      assert.match(detail.warnings.join(" "), /4 tranzakciót ír/);
      assert.deepEqual(
        detail.lines.map((line) => [
          line.status,
          line.errorCode ?? null,
          line.orderNumber ?? null,
          line.invoiceNumbers,
        ]),
        [
          ["RESOLVED", null, order("8"), [invoiceNumber]],
          ["NEEDS_REVIEW", "ORDER_NOT_INVOICED", order("7"), []],
          ["NEEDS_REVIEW", "AMOUNT_MISMATCH", order("6"), []],
          ["NEEDS_REVIEW", "ORDER_NOT_FOUND", null, []],
          ["NEEDS_REVIEW", "REFERENCE_UNKNOWN", null, []],
        ],
      );
      assert.equal(detail.lines[2]!.orderTotal, "9000");
      assert.ok(!JSON.stringify(detail).includes("Kitalalt Vevo"));
      assert.ok(!JSON.stringify(detail).includes("vevo@example.com"));
    });

    it("knows the same report again, also with other bytes", async () => {
      const same = await service.ingest(
        csv(),
        `${FILE_PREFIX}report_20260930-copy.csv`,
        { actorUserId: null, gmailMessageId: null, mailBody: null },
      );
      assert.deepEqual([same.duplicate, same.id], [true, reportId]);
      const otherBytes = await service.ingest(
        csv("\r\n"),
        `${FILE_PREFIX}report_20260930.csv`,
        { actorUserId: null, gmailMessageId: null, mailBody: null },
      );
      assert.deepEqual([otherBytes.duplicate, otherBytes.id], [true, reportId]);
      assert.equal(
        await prisma.simplePayReport.count({
          where: { fileName: { startsWith: FILE_PREFIX } },
        }),
        1,
      );
    });

    it("an order invoiced later resolves on reprocess; a person's decision is kept", async () => {
      const detail = await service.reportDetail(reportId);
      const mismatch = detail.lines[2]!;
      await service.approveLine(
        reportId,
        mismatch.id,
        {
          invoiceNumber: "ACRW-2026/99999",
          expectedUpdatedAt: mismatch.updatedAt,
        },
        userId,
      );

      const later = await prisma.salesOrder.findUniqueOrThrow({
        where: { orderNumber: order("7") },
      });
      await prisma.invoice.create({
        data: {
          direction: "OUTBOUND",
          source: "MANUAL",
          invoiceNumber: laterInvoice,
          partnerName: "Kitalalt Vevo",
          salesOrderId: later.id,
        },
      });

      const again = await service.reprocess(reportId);
      assert.deepEqual(
        again.lines.map((line) => [
          line.status,
          line.resolutionSource ?? null,
          line.invoiceNumbers,
        ]),
        [
          ["RESOLVED", "ORDER_KEY", [invoiceNumber]],
          ["RESOLVED", "ORDER_KEY", [laterInvoice]],
          ["RESOLVED", "MANUAL", ["ACRW-2026/99999"]],
          ["NEEDS_REVIEW", null, []],
          ["NEEDS_REVIEW", null, []],
        ],
      );
      assert.equal(again.status, "NEEDS_REVIEW");
      assert.equal(again.resolvedLineCount, 3);

      // the month's file, in Luca's shape: the week's invoices, and the
      // payments still open on their own sheet
      const { buffer } = await service.monthlyReport(2026, 9);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
      const values = (name: string) =>
        workbook
          .getWorksheet(name)!
          .getSheetValues()
          .flat()
          .map((cell) => String(cell ?? ""));
      assert.ok(values("SimplePay").includes(invoiceNumber));
      assert.ok(values("SimplePay").includes(laterInvoice));
      assert.ok(
        values("Ellenőrzendő fizetések").includes(
          "A rendelés nincs a rendszerben",
        ),
      );

      // a stale version is refused, not applied over the newer state
      await assert.rejects(
        () =>
          service.approveLine(
            reportId,
            mismatch.id,
            {
              invoiceNumber: "ACRW-2026/00001",
              expectedUpdatedAt: mismatch.updatedAt,
            },
            userId,
          ),
        /SIMPLEPAY_LINE_CHANGED/,
      );
    });
  },
);
