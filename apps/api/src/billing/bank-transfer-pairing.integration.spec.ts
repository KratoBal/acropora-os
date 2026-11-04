import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { ConflictException } from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { prismaPaymentMarkStore } from "../integrations/szamlazz/outgoing-payment-marks.js";
import {
  BankTransferPairingRepository,
  BankTransferPairingService,
} from "./bank-transfer-pairing.service.js";

/**
 * THE BANKI ÁTUTALÁSOK PAGE'S SERVICE, on a real Postgres, Számlázz.hu in stub mode (card aeddb2c3, slice 3). WHAT
 * TURNS THIS RED: a credit naming our invoices missing from the list; a check that writes; a pairing written on a
 * wrong amount; the invoice Számlázz.hu already paid marked again; a second pairing writing twice; no audit row; the
 * list not showing what the credit wrote.
 */
const gate = integrationDatabaseGate(process.env);
const MARK = `BTPP-${Date.now() % 1_000_000}`;
const DAY = "2099-04-17";
const D = (value: number | string) => new Prisma.Decimal(value);
const ids: Record<string, string> = {};
let user: AuthenticatedUser;

async function removeLeftovers() {
  await prisma.outgoingPaymentMark.deleteMany({
    where: {
      invoiceNumber: { startsWith: "ACRW-2099/" },
      source: "BANK_TRANSFER",
    },
  });
  await prisma.auditLog.deleteMany({
    where: {
      action: "billing.bank-transfer.paired",
      entityId: ids.credit ?? "",
    },
  });
  await prisma.bankTransaction.deleteMany({
    where: { transactionKey: { startsWith: "BTPP-" } },
  });
  await prisma.bankStatementImport.deleteMany({
    where: { fileName: { startsWith: "BTPP-" } },
  });
  await prisma.bankAccount.deleteMany({
    where: { accountNumber: { startsWith: "BTPP-" } },
  });
  await prisma.externalBillingDocument.deleteMany({
    where: { customerName: { startsWith: "BTPP-" } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: "btpp-" } },
  });
}

const service = () =>
  new BankTransferPairingService(
    { resolve: async () => ({ agentKey: "unused" }) } as never,
    new BankTransferPairingRepository(),
    prismaPaymentMarkStore,
    undefined,
    { SZAMLAZZ_AGENT_MODE: "stub" },
  );

describe(
  "the Banki átutalások page's service",
  { skip: gate.mode === "skip" },
  () => {
    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      const row = await prisma.user.create({
        data: {
          email: `btpp-${MARK.toLowerCase()}@example.invalid`,
          displayName: "BTPP aktor",
          role: "OWNER",
        },
        select: { id: true },
      });
      user = { id: row.id, displayName: "BTPP aktor" } as AuthenticatedUser;
      const account = await prisma.bankAccount.create({
        data: { accountNumber: MARK, currency: "HUF" },
      });
      const imported = await prisma.bankStatementImport.create({
        data: {
          fileName: MARK,
          sha256: MARK,
          rowCount: 1,
          createdCount: 1,
          skippedCount: 0,
          rejectedCount: 0,
        },
      });
      // the bank wrote the remittance in a way the reader does not know: a person types the numbers
      ids.credit = (
        await prisma.bankTransaction.create({
          data: {
            bankAccountId: account.id,
            importId: imported.id,
            direction: "CREDIT",
            amount: D(100000),
            currency: "HUF",
            bookingDate: new Date(`${DAY}T00:00:00Z`),
            counterpartyName: "Állatkert",
            narrative: "szla 83 84 85 86",
            transactionKey: `${MARK}-credit`,
          },
          select: { id: true },
        })
      ).id;
      const document = (
        number: string,
        gross: number,
        over: Partial<Prisma.ExternalBillingDocumentCreateInput> = {},
      ) =>
        prisma.externalBillingDocument.create({
          data: {
            externalId: `${MARK}-${number}`,
            documentNumber: `ACRW-2099/${number}`,
            feedMessageId: `${MARK}-${number}`,
            feedReceivedAt: new Date(`${DAY}T10:00:00Z`),
            kindCode: "SZ",
            electronic: true,
            issueDate: new Date("2099-04-01T00:00:00Z"),
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
      await document("00083", 10000, {
        paidAmount: D(10000),
        payments: [{ date: DAY, amount: "10000" }],
      });
      await document("00084", 20000);
      await document("00085", 30000);
      await document("00086", 40000);
    });

    after(async () => {
      if (gate.mode === "run") await removeLeftovers();
    });

    it("lists the credit only with `all`: its text names none of ours", async () => {
      const visible = (list: { id: string }[]) =>
        list.some((credit) => credit.id === ids.credit);
      assert.equal(visible(await service().list("2099-04-10")), false);
      assert.equal(visible(await service().list("2099-04-10", true)), true);
    });

    it("a check decides and writes nothing; a wrong amount is refused with no mark", async () => {
      const short = await service().check(ids.credit!, "2099/00084,85");
      assert.equal(short.markable, false);
      assert.equal(!short.markable && short.refusal, "AMOUNT_MISMATCH");
      await assert.rejects(
        () => service().pair(ids.credit!, "2099/00084,85", user),
        ConflictException,
      );
      assert.equal(
        await prisma.outgoingPaymentMark.count({
          where: { sourceRef: ids.credit!, source: "BANK_TRANSFER" },
        }),
        0,
      );
    });

    it("the exact pairing writes the three open invoices, once, with an audit row, and the list shows them", async () => {
      const first = await service().pair(ids.credit!, "2099/00083-86", user);
      assert.deepEqual(
        first.lines.map((l) => [l.invoiceNumber, l.outcome]),
        [
          ["ACRW-2099/00084", "WRITTEN"],
          ["ACRW-2099/00085", "WRITTEN"],
          ["ACRW-2099/00086", "WRITTEN"],
        ],
      );
      const again = await service().pair(ids.credit!, "2099/00083-86", user);
      assert.ok(
        again.lines.every((l) => l.outcome === "LOGGED_BEFORE"),
        JSON.stringify(again.lines),
      );
      assert.equal(
        await prisma.outgoingPaymentMark.count({
          where: { sourceRef: ids.credit!, source: "BANK_TRANSFER" },
        }),
        3,
      );
      assert.equal(
        await prisma.auditLog.count({
          where: {
            action: "billing.bank-transfer.paired",
            entityId: ids.credit!,
          },
        }),
        2,
      );
      const listed = (await service().list("2099-04-10", true)).find(
        (credit) => credit.id === ids.credit,
      );
      assert.deepEqual(listed?.written, [
        "ACRW-2099/00084",
        "ACRW-2099/00085",
        "ACRW-2099/00086",
      ]);
    });
  },
);
