import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Prisma, prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { prismaGlsPaidMarkStore as store } from "./gls-cod-paid-marks.apply.js";

const gate = integrationDatabaseGate(process.env);
const MARK = "gls-apply-it";
const NUMBER = `${MARK}/00479`;

async function removeLeftovers() {
  await prisma.glsCodPaymentMark.deleteMany({
    where: { invoiceNumber: { startsWith: MARK } },
  });
  await prisma.externalBillingDocument.deleteMany({
    where: { customerName: MARK },
  });
}

/*
  A NAPLÓ ÉS A SZÁMLA AZ ADATBÁZISBÓL (acrobot 25989). MI PIROSÍT: ha ugyanarra
  a számlára és utalásra egy második sor is létrejöhetne (a jóváírás nem
  idempotens); ha az ütközés kivételt dobna a „foglalt” jelzés helyett; ha a még
  nem újravetített (null) számla ismert kifizetésűnek számítana.
*/
describe("the GLS paid marks store", { skip: gate.mode === "skip" }, () => {
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

  it("one row per invoice and transfer day; the second create is refused, not thrown", async () => {
    const row = {
      invoiceNumber: NUMBER,
      transferDate: "2099-03-17",
      amount: "27450",
      creditId: "bt",
      state: "PLANNED" as const,
      requestSha256: "a".repeat(64),
    };
    const first = await store.create(row);
    assert.ok(first);
    assert.equal(await store.create(row), null);
    await store.update(first.id, { state: "WRITTEN", outstanding: "0" });
    assert.deepEqual(await store.logRow(NUMBER, "2099-03-17"), {
      id: first.id,
      state: "WRITTEN",
    });
    assert.equal(await store.logRow(NUMBER, "2099-03-18"), null);
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
});
