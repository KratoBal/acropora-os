import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Prisma, prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { prismaPaymentMarkStore as store } from "./outgoing-payment-marks.js";

const gate = integrationDatabaseGate(process.env);
const MARK = "payment-mark-it";
const NUMBER = `${MARK}/00479`;

async function removeLeftovers() {
  await prisma.outgoingPaymentMark.deleteMany({
    where: { invoiceNumber: { startsWith: MARK } },
  });
  await prisma.externalBillingDocument.deleteMany({
    where: { customerName: MARK },
  });
}

/*
  A NAPLÓ ÉS A SZÁMLA AZ ADATBÁZISBÓL (acrobot 25989, 26001). MI PIROSÍT: ha
  ugyanarra a forrásra, számlára és forrás-oldali azonosítóra egy második sor is
  létrejöhetne; ha egy MÁSIK azonosító (másik utalás) nem kaphatna sort (a jóváírás nem
  idempotens); ha az ütközés kivételt dobna a „foglalt” jelzés helyett; ha a még
  nem újravetített (null) számla ismert kifizetésűnek számítana.
*/
describe(
  "the outgoing payment marks store",
  { skip: gate.mode === "skip" },
  () => {
    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      await prisma.externalBillingDocument.create({
        data: {
          externalId: "9979",
          documentNumber: NUMBER,
          feedMessageId: `${MARK}-9979`,
          feedReceivedAt: new Date("2099-03-17T10:00:00Z"),
          kindCode: "SZ",
          electronic: true,
          issueDate: new Date("2099-03-01T00:00:00Z"),
          currency: "HUF",
          customerName: MARK,
          netAmount: new Prisma.Decimal(27450),
          vatAmount: new Prisma.Decimal(0),
          grossAmount: new Prisma.Decimal(27450),
          lines: [],
          paymentsKnown: null,
        },
      });
    });

    after(async () => {
      if (gate.mode === "run") await removeLeftovers();
    });

    it("one row per source, invoice and source-side reference; the second create is refused, not thrown", async () => {
      const row = {
        source: "GLS_COD" as const,
        invoiceNumber: NUMBER,
        markDate: "2099-03-17",
        amount: "27450",
        sourceRef: "bt-1",
        state: "PLANNED" as const,
        requestSha256: "a".repeat(64),
      };
      const first = await store.create(row);
      assert.ok(first);
      assert.equal(await store.create(row), null);
      // another transfer of the same invoice, and another source: their own rows
      assert.ok(await store.create({ ...row, sourceRef: "bt-2" }));
      assert.ok(await store.create({ ...row, source: "SIMPLEPAY" }));
      await store.update(first.id, { state: "WRITTEN", outstanding: "0" });
      assert.deepEqual(await store.logRow("GLS_COD", NUMBER, "bt-1"), {
        id: first.id,
        state: "WRITTEN",
      });
      assert.equal(await store.logRow("FOXPOST", NUMBER, "bt-1"), null);
    });

    it("an invoice not yet re-projected is not known to be unpaid", async () => {
      assert.deepEqual(await store.invoice(NUMBER), {
        paymentsKnown: false,
        paidAmount: "0.0000",
        grossAmount: "27450.0000",
        currency: "HUF",
      });
      assert.equal(await store.invoice(`${MARK}/nincs`), null);
    });
  },
);
