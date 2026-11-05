import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Prisma, prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import {
  decideBankTransfer,
  loadBankTransfers,
} from "./bank-transfer-paid-marks.js";

/**
 * THE BANK-TRANSFER SOURCE'S READ, on a real Postgres (card aeddb2c3). WHAT TURNS THIS RED: a select or where field
 * the database refuses (a made-up one compiles); a debit, a marked duplicate or an earlier credit read; an older feed
 * version used instead of the latest; the feed's payments not reaching the decision, so Balázs's transfer is not
 * marked, or the invoice Számlázz.hu already paid is marked again.
 */
const gate = integrationDatabaseGate(process.env);
const MARK = `BTPM-${Date.now() % 1_000_000}`;
const DAY = "2099-03-17";
const D = (value: number | string) => new Prisma.Decimal(value);
const ids: Record<string, string> = {};

async function removeLeftovers() {
  await prisma.bankTransaction.deleteMany({
    where: { transactionKey: { startsWith: "BTPM-" } },
  });
  await prisma.bankStatementImport.deleteMany({
    where: { fileName: { startsWith: "BTPM-" } },
  });
  await prisma.bankAccount.deleteMany({
    where: { accountNumber: { startsWith: "BTPM-" } },
  });
  await prisma.externalBillingDocument.deleteMany({
    where: { customerName: { startsWith: "BTPM-" } },
  });
}

describe(
  "the bank-transfer paid marks' read",
  { skip: gate.mode === "skip" },
  () => {
    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      const account = await prisma.bankAccount.create({
        data: { accountNumber: MARK, currency: "HUF" },
      });
      const imported = await prisma.bankStatementImport.create({
        data: {
          fileName: MARK,
          sha256: MARK,
          rowCount: 4,
          createdCount: 4,
          skippedCount: 0,
          rejectedCount: 0,
        },
      });
      const transaction = (
        key: string,
        over: Partial<Prisma.BankTransactionUncheckedCreateInput> = {},
      ) =>
        prisma.bankTransaction.create({
          data: {
            bankAccountId: account.id,
            importId: imported.id,
            direction: "CREDIT",
            amount: D(100000),
            currency: "HUF",
            bookingDate: new Date(`${DAY}T00:00:00Z`),
            // the customer's extra zero: 000083 is 00083 (Balázs's live run 2026-11-05: 2026/000436)
            narrative: "2099/000083,86,85,84",
            transactionKey: `${MARK}-${key}`,
            ...over,
          },
          select: { id: true },
        });
      ids.credit = (await transaction("credit")).id;
      ids.debit = (await transaction("debit", { direction: "DEBIT" })).id;
      ids.earlier = (
        await transaction("earlier", {
          bookingDate: new Date("2099-03-01T00:00:00Z"),
        })
      ).id;
      ids.duplicate = (
        await transaction("duplicate", { duplicateMarkedAt: new Date() })
      ).id;

      const document = (
        number: string,
        gross: number,
        over: Partial<Prisma.ExternalBillingDocumentCreateInput> = {},
      ) =>
        prisma.externalBillingDocument.create({
          data: {
            externalId: `${MARK}-${number}-${over.feedMessageId ?? "v"}`,
            documentNumber: `ACRW-2099/${number}`,
            feedMessageId: `${MARK}-${number}`,
            feedReceivedAt: new Date(`${DAY}T10:00:00Z`),
            kindCode: "SZ",
            electronic: true,
            issueDate: new Date("2099-03-01T00:00:00Z"),
            currency: "HUF",
            customerName: `${MARK} Állatkert`,
            customerTaxNumber: "15490658-2-42",
            netAmount: D(gross),
            vatAmount: D(0),
            grossAmount: D(gross),
            lines: [],
            paymentsKnown: true,
            ...over,
          },
        });
      // Számlázz.hu paired the transfer with 00083 by itself
      await document("00083", 10000, {
        paidAmount: D(10000),
        payments: [
          {
            date: DAY,
            amount: "10000",
            title: "átutalás",
            bankTransactionId: "szhu-1",
          },
        ],
      });
      await document("00084", 20000);
      // an older feed version of 00084 with another gross: the latest one counts
      await document("00084", 99999, {
        feedMessageId: "old",
        feedReceivedAt: new Date("2099-03-02T10:00:00Z"),
      });
      /*
        OUR SERIES WITHOUT A PREFIX (Balázs's live run 2026-11-05 11:05: every 2026/000xx transfer "nincs"). 00085 and
        00086 are numbered the real way, `2099/00085`; an ACRW 00085 also exists, paid long ago, so the bare number
        names two invoices and only the open one can be this transfer's. 00185 shares the digits' end: loaded by the
        query, never matched.
      */
      await document("00085", 30000, { documentNumber: "2099/00085" });
      await document("00085", 5000, {
        externalId: `${MARK}-acrw-00085`,
        paidAmount: D(5000),
        payments: [{ date: "2099-01-10", amount: "5000", title: "átutalás" }],
      });
      await document("00086", 40000, { documentNumber: "2099/00086" });
      await document("00185", 30000);
    });

    after(async () => {
      if (gate.mode === "run") await removeLeftovers();
    });

    it("reads the credits since the day, and decides Balázs's transfer from the latest feed rows", async () => {
      const { credits, invoices } = await loadBankTransfers("2099-03-10");
      const ours = credits.filter((c) => Object.values(ids).includes(c.id));
      assert.deepEqual(
        ours.map((c) => c.id),
        [ids.credit],
      );
      const decision = decideBankTransfer(ours[0]!, invoices);
      assert.equal(decision.markable, true);
      if (!decision.markable) return;
      assert.deepEqual(
        decision.marks.map((m) => [m.invoiceNumber, m.amount]),
        [
          ["2099/00086", "40000.00"],
          ["2099/00085", "30000.00"],
          ["ACRW-2099/00084", "20000.00"],
        ],
      );
      assert.deepEqual(decision.paidBefore, ["ACRW-2099/00083"]);
    });
  },
);
