import "reflect-metadata";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Prisma, prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import { WEBSHOP_ADVANCE_TAG } from "./webshop-order-invoice.rules.js";
import { WebshopOrdersRepository } from "./webshop-orders.repository.js";

/*
  THE LIVE BANK PAIRING'S READS AND ITS ONE WRITE, ON A REAL DATABASE (card d31a66a3, S5). WHAT TURNS RED:
  - a proforma the order replaced, a paid one, or one whose order already has its receipt is a target;
  - a balance target for an order whose receipt was not an advance, or whose balance is in;
  - a credit already recorded in EITHER receipt table, or bound to a document, is offered again;
  - the same bank line records a receipt in one table and then a balance in the other (barracuda 62377), or the other way round;
  - a bank line bound to another document records anything;
  - a manually recorded balance gets a second one from the bank, or that bank line is taken as used;
  - two rounds racing for one bank line both write.
*/
const gate = integrationDatabaseGate(process.env);
const ACCOUNT = "9999000055556666";
const PREFIX = "D-ITLIVE-";
const ORDER = "order_itlive_";
const FILE = "webshop-transfer-pairing-write-it";

async function removeLeftovers() {
  await prisma.webshopBalanceReceipt.deleteMany({
    where: { orderId: { startsWith: ORDER } },
  });
  await prisma.webshopTransferReceipt.deleteMany({
    where: { orderId: { startsWith: ORDER } },
  });
  await prisma.bankTransaction.deleteMany({
    where: { bankAccount: { accountNumber: ACCOUNT } },
  });
  await prisma.bankStatementImport.deleteMany({ where: { fileName: FILE } });
  await prisma.bankAccount.deleteMany({ where: { accountNumber: ACCOUNT } });
  await prisma.invoice.deleteMany({
    where: { sourceId: { startsWith: ORDER } },
  });
}

describe(
  "the live bank pairing on the database",
  { skip: gate.mode === "skip" },
  () => {
    const repository = new WebshopOrdersRepository();
    const credit: Record<string, string> = {};
    const proformaIds: Record<string, string> = {};

    const proforma = async (
      key: string,
      order: number,
      over: { isPaid?: boolean; createdAt?: string; advance?: boolean } = {},
    ) => {
      const row = await prisma.invoice.create({
        data: {
          direction: "OUTBOUND",
          source: "MANUAL",
          partnerName: "Kitalalt Vevo",
          invoiceNumber: `${PREFIX}${key}`,
          documentType: "PROFORMA",
          status: "ISSUED",
          sourceType: "WEBSHOP_ORDER",
          sourceId: `${ORDER}${order}`,
          grossAmount: new Prisma.Decimal("4800"),
          currency: "HUF",
          isPaid: over.isPaid ?? false,
          tags: over.advance ? [WEBSHOP_ADVANCE_TAG] : [],
          createdAt: new Date(over.createdAt ?? "2026-11-20T09:00:00Z"),
        },
      });
      proformaIds[key] = row.id;
      return row;
    };
    const receipt = (order: number, key: string) =>
      prisma.webshopTransferReceipt.create({
        data: {
          orderId: `${ORDER}${order}`,
          proformaId: proformaIds[key]!,
          source: "MANUAL",
          reference: `IT-${key}`,
          receivedOn: new Date("2026-11-21T00:00:00Z"),
          amount: new Prisma.Decimal("4800"),
          currency: "HUF",
        },
      });
    const write = (
      kind: "transfer" | "balance",
      order: number,
      line: string,
      key = "1",
    ) =>
      repository.recordPairedReceipt({
        ...(kind === "transfer"
          ? { kind, proformaId: proformaIds[key]! }
          : { kind }),
        orderId: `${ORDER}${order}`,
        bankTransactionId: credit[line]!,
        reference: `IT-${line}`,
        receivedOn: "2026-11-25",
        amount: new Prisma.Decimal("4800"),
        currency: "HUF",
      });

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      // order 1: an older proforma replaced by a newer one; only the newer is a target
      await proforma("1old", 1, { createdAt: "2026-11-19T09:00:00Z" });
      await proforma("1", 1);
      // order 2: paid; order 3: its receipt is in (a whole-order proforma)
      await proforma("2", 2, { isPaid: true });
      await proforma("3", 3);
      await receipt(3, "3");
      // orders 4 to 7: advances received; 5 has its balance in by hand
      for (const order of [4, 5, 6, 7]) {
        await proforma(String(order), order, { advance: true });
        await receipt(order, String(order));
      }
      await prisma.webshopBalanceReceipt.create({
        data: {
          orderId: `${ORDER}5`,
          source: "MANUAL",
          reference: "IT-KEZI-HATRALEK",
          receivedOn: new Date("2026-11-24T00:00:00Z"),
          amount: new Prisma.Decimal("8200"),
          currency: "HUF",
        },
      });
      // order 8, 9: open proformas for the cross-check
      await proforma("8", 8);
      await proforma("9", 9);

      const account = await prisma.bankAccount.create({
        data: { accountNumber: ACCOUNT, currency: "HUF" },
      });
      const statement = await prisma.bankStatementImport.create({
        data: {
          fileName: FILE,
          sha256: "1".repeat(64),
          rowCount: 6,
          createdCount: 6,
          skippedCount: 0,
          rejectedCount: 0,
        },
      });
      for (const line of ["a", "b", "c", "d", "e", "f"])
        credit[line] = (
          await prisma.bankTransaction.create({
            data: {
              bankAccountId: account.id,
              importId: statement.id,
              direction: "CREDIT",
              amount: new Prisma.Decimal("4800"),
              currency: "HUF",
              bookingDate: new Date("2026-11-25T00:00:00Z"),
              narrative: `${PREFIX}${line}`,
              transactionKey: `itlive-${line}`,
            },
          })
        ).id;
      await prisma.bankTransactionMatch.create({
        data: {
          bankTransactionId: credit.f!,
          documentSource: "ITLIVE",
          documentId: "itlive-doc",
        },
      });
    });

    after(async () => {
      if (gate.mode !== "run") return;
      await removeLeftovers();
      nincsMaradek([
        {
          nev: "Invoice of the suite's orders",
          darab: await prisma.invoice.count({
            where: { sourceId: { startsWith: ORDER } },
          }),
        },
        {
          nev: "WebshopTransferReceipt of the suite's orders",
          darab: await prisma.webshopTransferReceipt.count({
            where: { orderId: { startsWith: ORDER } },
          }),
        },
        {
          nev: "BankAccount of the suite",
          darab: await prisma.bankAccount.count({
            where: { accountNumber: ACCOUNT },
          }),
        },
      ]);
    });

    it("the proforma targets: the order's latest, issued, unpaid, without a receipt", async () => {
      const rows = (await repository.pairingProformas()).filter((row) =>
        row.orderId.startsWith(ORDER),
      );
      assert.deepEqual(rows.map((row) => row.number).sort(), [
        `${PREFIX}1`,
        `${PREFIX}8`,
        `${PREFIX}9`,
      ]);
    });

    it("the balance targets: an advance received, its balance not, with the advance proforma's number", async () => {
      const rows = (await repository.pairingBalances()).filter((row) =>
        row.orderId.startsWith(ORDER),
      );
      assert.deepEqual(
        rows.map((row) => [
          row.orderId,
          row.number,
          row.advanceAmount.toFixed(4),
          row.advanceReceivedOn,
        ]),
        [4, 6, 7].map((order) => [
          `${ORDER}${order}`,
          `${PREFIX}${order}`,
          "4800.0000",
          "2026-11-21",
        ]),
      );
    });

    it("one bank line records one receipt across the two tables, and a bound line none", async () => {
      // a: the order's receipt, then the same line cannot be a balance
      assert.equal(await write("transfer", 8, "a", "8"), "recorded");
      assert.equal(await write("balance", 4, "a"), "credit-used");
      // b: a balance, then the same line cannot be an order's receipt
      assert.equal(await write("balance", 6, "b"), "recorded");
      assert.equal(await write("transfer", 9, "b", "9"), "credit-used");
      // f: bound to another document
      assert.equal(await write("transfer", 9, "f", "9"), "credit-used");
      const stored = await prisma.webshopTransferReceipt.findUnique({
        where: { orderId: `${ORDER}8` },
      });
      assert.deepEqual(
        {
          source: stored?.source,
          bankTransactionId: stored?.bankTransactionId,
          proformaId: stored?.proformaId,
          receivedOn: stored?.receivedOn.toISOString().slice(0, 10),
          recordedByUserId: stored?.recordedByUserId,
        },
        {
          source: "BANK_PAIRING",
          bankTransactionId: credit.a,
          proformaId: proformaIds["8"],
          receivedOn: "2026-11-25",
          recordedByUserId: null,
        },
      );
      assert.equal(
        await prisma.webshopBalanceReceipt.count({
          where: { orderId: `${ORDER}4` },
        }),
        0,
      );
      // the used and the bound lines are not offered again; the free ones are
      const offered = new Set(
        (await repository.pairingCredits(new Date("2026-11-01T00:00:00Z"))).map(
          (row) => row.id,
        ),
      );
      assert.deepEqual(
        ["a", "b", "c", "d", "e", "f"].filter((line) =>
          offered.has(credit[line]!),
        ),
        ["c", "d", "e"],
      );
    });

    it("a manually recorded balance gets no second one, and the bank line stays free", async () => {
      assert.equal(await write("balance", 5, "c"), "order-recorded");
      const balance = await prisma.webshopBalanceReceipt.findUnique({
        where: { orderId: `${ORDER}5` },
      });
      assert.equal(balance?.source, "MANUAL");
      assert.equal(balance?.bankTransactionId, null);
      const offered = await repository.pairingCredits(
        new Date("2026-11-01T00:00:00Z"),
      );
      assert.ok(offered.some((row) => row.id === credit.c));
    });

    it("two rounds racing for one bank line: one writes, the other finds it used", async () => {
      const results = await Promise.all([
        write("balance", 7, "d"),
        write("transfer", 9, "d", "9"),
      ]);
      assert.deepEqual([...results].sort(), ["credit-used", "recorded"]);
      const tables =
        (await prisma.webshopTransferReceipt.count({
          where: { bankTransactionId: credit.d },
        })) +
        (await prisma.webshopBalanceReceipt.count({
          where: { bankTransactionId: credit.d },
        }));
      assert.equal(tables, 1);
    });
  },
);
