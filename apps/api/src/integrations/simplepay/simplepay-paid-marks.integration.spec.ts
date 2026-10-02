import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Prisma, prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import {
  dryRunReport,
  loadSimplePayOrders,
} from "./simplepay-paid-marks.dry-run.js";
import {
  loadRefundsAfterMarks,
  loadSimplePayMarkedBefore,
  loadWrittenSimplePayMarks,
} from "./simplepay-paid-marks.live.js";
import { decideSimplePayOrder } from "./simplepay-paid-marks.js";

const gate = integrationDatabaseGate(process.env);
const PREFIX = "spaymark-it-";
// unique 6 digits, so that no other test's lines mix in
const BASE = Number(`8${String(Date.now()).slice(-5)}`);
const KEY = { paid: String(BASE), refunded: String(BASE + 1) };
const D = (value: number) => new Prisma.Decimal(value);

async function removeLeftovers() {
  await prisma.outgoingPaymentMark.deleteMany({
    where: { invoiceNumber: { startsWith: PREFIX } },
  });
  await prisma.simplePayReport.deleteMany({
    where: { fileName: { startsWith: PREFIX } },
  });
  await prisma.externalBillingDocument.deleteMany({
    where: { externalId: { startsWith: PREFIX } },
  });
}

/*
  A SZÁRAZ FUTÁS BEMENETE AZ ADATBÁZISBÓL. MI PIROSÍT: ha a számla nem a
  rendelésszámon („47679-NNNNNN”) kötne a sor `orderKeySuffix` mezőjére; ha a
  `from` ELŐTTI visszatérítés kimaradna (akkor a teljesen visszatérített rendelés
  jelölhető lenne); ha a díjbekérő számlának számítana a rendelésen; ha a
  rendelésszám nélküli teljesült sor elveszne a listából.
*/
describe(
  "the SimplePay paid marks dry run reads",
  { skip: gate.mode === "skip" },
  () => {
    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      const line = (
        rowNumber: number,
        orderKeySuffix: string | null,
        transactionStatus: string,
        amount: number,
        day: string,
      ) => ({
        rowNumber,
        transactionStatus,
        simplePayTransactionId: `${PREFIX}${BASE}-${rowNumber}`,
        merchantTransactionId: `T${orderKeySuffix ?? "x"}`,
        orderKeySuffix,
        transactionAt: `${day} 10:00:00`,
        transactionDate: new Date(`${day}T00:00:00.000Z`),
        amount: D(amount),
        commission: D(0),
        netAmount: D(amount),
        status: "RESOLVED" as const,
      });
      await prisma.simplePayReport.create({
        data: {
          fileName: `${PREFIX}report.csv`,
          sha256: `${PREFIX}${BASE}`,
          content: new Uint8Array(Buffer.from("teszt")),
          contentKey: `${PREFIX}${BASE}`,
          amountTotal: D(0),
          commissionTotal: D(0),
          netTotal: D(0),
          lineCount: 4,
          warnings: [],
          status: "COMPLETED",
          lines: {
            create: [
              line(1, KEY.paid, "COMPLETED", 29210, "2099-03-17"),
              // the refund booked BEFORE `from`: it must still count
              line(2, KEY.refunded, "REFUND", 8000, "2099-03-10"),
              line(3, KEY.refunded, "COMPLETED", 8000, "2099-03-17"),
              line(4, null, "COMPLETED", 1500, "2099-03-17"),
            ],
          },
        },
      });
      const document = (
        id: string,
        kindCode: string,
        orderKey: string,
        gross: number,
      ) =>
        prisma.externalBillingDocument.create({
          data: {
            externalId: `${PREFIX}${id}`,
            feedMessageId: `${PREFIX}${id}`,
            feedReceivedAt: new Date("2099-03-17T10:00:00.000Z"),
            kindCode,
            documentNumber: `${PREFIX}${id}`,
            electronic: true,
            issueDate: new Date("2099-03-16T00:00:00.000Z"),
            paymentMethod: "",
            paymentMethodUnified: "bankkártya",
            orderNumber: `47679-${orderKey}`,
            currency: "HUF",
            customerName: PREFIX,
            netAmount: D(gross),
            vatAmount: D(0),
            grossAmount: D(gross),
            lines: [],
            paymentsKnown: false,
            paidAmount: D(0),
          },
        });
      await document("1", "SZ", KEY.paid, 29210);
      // a proforma on the same order is not a second invoice
      await document("2", "D", KEY.paid, 29210);
      await document("3", "SZ", KEY.refunded, 8000);
    });

    after(async () => {
      if (gate.mode !== "run") return;
      await removeLeftovers();
      nincsMaradek([
        {
          nev: "a SimplePay teszt-kimutatás bent maradt",
          darab: await prisma.simplePayReport.count({
            where: { fileName: { startsWith: PREFIX } },
          }),
        },
        {
          nev: "a teszt-jelölés bent maradt a naplóban",
          darab: await prisma.outgoingPaymentMark.count({
            where: { invoiceNumber: { startsWith: PREFIX } },
          }),
        },
        {
          nev: "a külső teszt-számla bent maradt",
          darab: await prisma.externalBillingDocument.count({
            where: { externalId: { startsWith: PREFIX } },
          }),
        },
      ]);
    });

    it("the orders by their number, every line of them, and the invoices only", async () => {
      const { orders, unkeyed } = await loadSimplePayOrders("2099-03-15");
      const ours = orders.filter((o) =>
        [KEY.paid, KEY.refunded].includes(o.orderKey),
      );
      assert.deepEqual(
        ours.map((o) => [
          o.orderKey,
          o.lines.map((l) => l.transactionStatus),
          o.invoices.map((i) => i.invoiceNumber),
        ]),
        [
          [KEY.paid, ["COMPLETED"], [`${PREFIX}1`]],
          [KEY.refunded, ["REFUND", "COMPLETED"], [`${PREFIX}3`]],
        ],
      );
      assert.ok(unkeyed >= 1);
      const report = dryRunReport(ours.map(decideSimplePayOrder), unkeyed);
      assert.match(
        report,
        new RegExp(
          `^${PREFIX}1\\t29210 Ft\\t2099-03-17\\tbankkártya\\tSimplePay, 2099-03-17, tranzakció: ${PREFIX}${BASE}-1$`,
          "m",
        ),
      );
      assert.match(
        report,
        new RegExp(`^${PREFIX}3\\t.*kimarad: visszatérítve`, "m"),
      );
      assert.match(report, /összesen: 1 számla jelölhető, 2 rendelésből/);
    });

    it("a written mark whose order got a refund is reported through the invoice's order number", async () => {
      const rows = await loadRefundsAfterMarks([
        { invoiceNumber: `${PREFIX}1`, date: "2099-03-17", amount: "29210" },
        { invoiceNumber: `${PREFIX}3`, date: "2099-03-17", amount: "8000" },
      ]);
      assert.deepEqual(
        rows.map((r) => [r.invoiceNumber, r.orderKey, r.refunded, r.full]),
        [[`${PREFIX}3`, KEY.refunded, "8000", true]],
      );
    });

    it("the shared log: a FAILED row does not count as marked, a WRITTEN one does and feeds the refund list", async () => {
      const row = (invoice: string, state: "WRITTEN" | "FAILED") =>
        prisma.outgoingPaymentMark.create({
          data: {
            source: "SIMPLEPAY",
            invoiceNumber: `${PREFIX}${invoice}`,
            markDate: new Date("2099-03-17T00:00:00.000Z"),
            amount: D(8000),
            sourceRef: `${PREFIX}${invoice}`,
            state,
          },
        });
      await row("1", "FAILED");
      await row("3", "WRITTEN");
      assert.deepEqual(
        [
          ...(await loadSimplePayMarkedBefore(
            new Set([`${PREFIX}1`, `${PREFIX}3`]),
          )),
        ],
        [`${PREFIX}3`],
      );
      const written = (await loadWrittenSimplePayMarks()).filter((w) =>
        w.invoiceNumber.startsWith(PREFIX),
      );
      assert.deepEqual(written, [
        { invoiceNumber: `${PREFIX}3`, date: "2099-03-17", amount: "8000" },
      ]);
      assert.deepEqual(
        (await loadRefundsAfterMarks(written)).map((r) => r.invoiceNumber),
        [`${PREFIX}3`],
      );
    });
  },
);
