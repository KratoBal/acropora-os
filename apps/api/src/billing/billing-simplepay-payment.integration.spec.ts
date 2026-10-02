import "reflect-metadata";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Prisma, prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { nincsMaradek } from "../common/takaritas-leltar.js";
import { BillingDocumentListRepository } from "./billing-document-list.repository.js";

/**
 * A KÁRTYÁS KÜLSŐ SZÁMLA KIFIZETÉSE A SIMPLEPAY-SORBÓL, A VALÓDI ADATBÁZISON
 * (acrobot 25964, 25979). Amit csak adatbázis bizonyít: a lista a számla
 * rendelésszámából („47679-NNNNNN”) a SimplePay-sor `orderKeySuffix` mezőjére
 * köt, és a COMPLETED és a REFUND sort is behozza. MI PIROSÍT: ha a kötés nem
 * a 6 számjegyre menne; ha a lekérdezés nem hozná a sorokat (a forrás a
 * kártyás feltevés maradna); ha a visszatérítés nem csökkentené az összeget.
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "spayit-";
// egyedi 6 számjegy, hogy más teszt sorai ne keveredjenek ide
const SUFFIX = `9${String(Date.now()).slice(-5)}`;
const ORDER = `47679-${SUFFIX}`;

async function removeLeftovers() {
  await prisma.simplePayReport.deleteMany({
    where: { fileName: { startsWith: PREFIX } },
  });
  await prisma.externalBillingDocument.deleteMany({
    where: { externalId: { startsWith: PREFIX } },
  });
}

describe(
  "a kártyás külső számla kifizetése a SimplePay-sorból",
  { skip: gate.mode === "skip" },
  () => {
    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
    });

    after(async () => {
      await removeLeftovers();
      nincsMaradek([
        {
          nev: "a SimplePay teszt-kimutatás bent maradt",
          darab: await prisma.simplePayReport.count({
            where: { fileName: { startsWith: PREFIX } },
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

    it("a card invoice reads its SimplePay payment and refund by the order number", async () => {
      const D = (value: string) => new Prisma.Decimal(value);
      const line = (
        rowNumber: number,
        transactionStatus: string,
        amount: string,
        day: string,
      ) => ({
        rowNumber,
        transactionStatus,
        simplePayTransactionId: `${PREFIX}${SUFFIX}-${rowNumber}`,
        merchantTransactionId: `T${SUFFIX}`,
        orderKeySuffix: SUFFIX,
        transactionAt: `${day} 10:00:00`,
        transactionDate: new Date(`${day}T00:00:00.000Z`),
        amount: D(amount),
        commission: D("0"),
        netAmount: D(amount),
        status: "RESOLVED" as const,
      });
      await prisma.simplePayReport.create({
        data: {
          fileName: `${PREFIX}report.csv`,
          sha256: `${PREFIX}${SUFFIX}`,
          content: new Uint8Array(Buffer.from("teszt")),
          contentKey: `${PREFIX}${SUFFIX}`,
          amountTotal: D("29210"),
          commissionTotal: D("0"),
          netTotal: D("29210"),
          lineCount: 2,
          warnings: [],
          status: "COMPLETED",
          lines: {
            create: [
              line(1, "COMPLETED", "29210", "2026-09-28"),
              line(2, "REFUND", "10000", "2026-09-30"),
            ],
          },
        },
      });
      await prisma.externalBillingDocument.create({
        data: {
          externalId: `${PREFIX}1`,
          feedMessageId: `${PREFIX}msg`,
          feedReceivedAt: new Date("2026-10-01T10:00:00.000Z"),
          kindCode: "SZ",
          documentNumber: `${PREFIX}ACRW-1`,
          electronic: true,
          issueDate: new Date("2026-09-28T00:00:00.000Z"),
          paymentMethod: "",
          paymentMethodUnified: "bankkártya",
          orderNumber: ORDER,
          currency: "HUF",
          customerName: "Teszt Akvárium Bt.",
          netAmount: D("23000"),
          vatAmount: D("6210"),
          grossAmount: D("29210"),
          lines: [],
          paymentsKnown: false,
        },
      });

      const list = await new BillingDocumentListRepository().list({
        page: 1,
        pageSize: 10,
        q: ORDER,
        origin: "EXTERNAL",
      });
      assert.deepEqual(
        list.items.map((item) => [
          item.documentNumber,
          item.paymentState,
          item.paidAmount,
          item.lastPaymentDate,
          item.paymentSource,
        ]),
        [
          [
            `${PREFIX}ACRW-1`,
            "PARTIAL",
            "19210",
            "2026-09-28",
            "SIMPLEPAY_REFUNDED",
          ],
        ],
      );
    });
  },
);
