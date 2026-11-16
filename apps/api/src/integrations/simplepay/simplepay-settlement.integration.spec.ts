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

    const row = (
      n: number,
      merchantId: string,
      amount: number,
      status = "COMPLETED",
    ) =>
      [
        status,
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
          nev: "ExternalBillingDocument by test prefix",
          darab: await prisma.externalBillingDocument.count({
            where: { documentNumber: { startsWith: INVOICE_PREFIX } },
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
      await prisma.externalBillingDocument.deleteMany({
        where: { documentNumber: { startsWith: INVOICE_PREFIX } },
      });
      // a storno points at its invoice: it goes first
      await prisma.invoice.deleteMany({
        where: {
          invoiceNumber: { startsWith: INVOICE_PREFIX },
          referencedInvoiceId: { not: null },
        },
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

    /*
      AN ORDER WITH A REFUND, DECIDED AS A WHOLE ACROSS REPORTS (c03e9896).
      The payment is in one week's report, the refund in the next, as
      measured live. Only a database proves: the refund report reads the
      earlier week's payment; the earlier week resolves on reprocess; the
      feed's corrective and our own storno (the correction chain) settle it.
    */
    it("an order with a refund is decided by all its lines, from any report, with its invoices", async () => {
      for (const [lead, total] of [
        ["4", 5000], // full refund, never invoiced
        ["3", 19968], // partial: paid 30958, refunded 10990, order reduced
        ["2", 7007], // full refund over a live invoice of ours
        ["1", 9000], // a refund the order does not show
      ] as const)
        await prisma.salesOrder.create({
          data: {
            orderNumber: order(lead),
            channel: "UNAS",
            totalGross: total,
          },
        });
      const full = await prisma.salesOrder.findUniqueOrThrow({
        where: { orderNumber: order("2") },
      });
      const live = await prisma.invoice.create({
        data: {
          direction: "OUTBOUND",
          source: "MANUAL",
          invoiceNumber: `${INVOICE_PREFIX}-2026/F${s5}`,
          partnerName: "Kitalalt Vevo",
          salesOrderId: full.id,
          grossAmount: 7007,
        },
      });
      const feed = (number: string, kindCode: string, gross: number) =>
        prisma.externalBillingDocument.create({
          data: {
            externalId: number,
            feedMessageId: number,
            feedReceivedAt: new Date("2026-10-08T10:00:00.000Z"),
            kindCode,
            documentNumber: number,
            electronic: true,
            issueDate: new Date("2026-10-08T00:00:00.000Z"),
            orderNumber: `47679-${key("3")}`,
            currency: "HUF",
            customerName: "Kitalalt Vevo",
            netAmount: gross,
            vatAmount: 0,
            grossAmount: gross,
            lines: [],
          },
        });
      const partInvoice = `${INVOICE_PREFIX}-2026/P${s5}`;
      const partCorrective = `${INVOICE_PREFIX}-2026/PH${s5}`;
      await feed(partInvoice, "SZ", 30958);
      // the corrective by its kind, not its sign: as an invoice this would bill 41 948
      await feed(partCorrective, "HS", 10990);

      const csvOf = (rows: string[]) =>
        Buffer.from("\uFEFF" + [HEADER, ...rows].join("\r\n") + "\r\n", "utf8");
      const ingest = (rows: string[], date: string) =>
        service.ingest(csvOf(rows), `${FILE_PREFIX}report_${date}.csv`, {
          actorUserId: null,
          gmailMessageId: null,
          mailBody: null,
        });
      const states = async (id: string) =>
        (await service.reportDetail(id)).lines.map((line) => [
          line.status,
          line.errorCode ?? null,
          line.invoiceNumbers,
        ]);

      // week 1: two payments, no refund yet, so each is judged by itself
      const week1 = await ingest(
        [row(11, `111T${key("4")}`, 5000), row(12, `111T${key("3")}`, 30958)],
        "20261007",
      );
      assert.deepEqual(await states(week1.id), [
        ["NEEDS_REVIEW", "ORDER_NOT_INVOICED", []],
        ["NEEDS_REVIEW", "AMOUNT_MISMATCH", []],
      ]);

      // week 2: the refunds, two of them over week 1's payments
      const week2 = await ingest(
        [
          row(13, `111T${key("4")}`, -5000, "REFUND"),
          row(14, `111T${key("3")}`, -10990, "REFUND"),
          row(15, `111T${key("2")}`, 7007),
          row(16, `111T${key("2")}`, -7007, "REFUND"),
          row(17, `111T${key("1")}`, 9000),
          row(18, `111T${key("1")}`, -1000, "REFUND"),
        ],
        "20261014",
      );
      const notCancelled = ["NEEDS_REVIEW", "REFUND_INVOICE_NOT_CANCELLED", []];
      const unexplained = ["NEEDS_REVIEW", "REFUND_AMOUNT_UNEXPLAINED", []];
      assert.deepEqual(await states(week2.id), [
        ["RESOLVED", null, []],
        ["RESOLVED", null, [partInvoice, partCorrective]],
        notCancelled,
        notCancelled,
        unexplained,
        unexplained,
      ]);

      // week 1 resolves on reprocess, against the refund a week later
      await service.reprocess(week1.id);
      assert.deepEqual(await states(week1.id), [
        ["RESOLVED", null, []],
        ["RESOLVED", null, [partInvoice, partCorrective]],
      ]);

      // our own storno of the live invoice (the correction chain) settles the full refund
      const storno = `${INVOICE_PREFIX}-2026/FS${s5}`;
      await prisma.invoice.create({
        data: {
          direction: "OUTBOUND",
          source: "MANUAL",
          documentType: "STORNO",
          invoiceNumber: storno,
          partnerName: "Kitalalt Vevo",
          salesOrderId: full.id,
          referencedInvoiceId: live.id,
          grossAmount: -7007,
        },
      });
      await service.reprocess(week2.id);
      const settled = ["RESOLVED", null, [live.invoiceNumber, storno]];
      assert.deepEqual((await states(week2.id)).slice(2, 4), [
        settled,
        settled,
      ]);
    });
  },
);
