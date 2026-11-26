import "reflect-metadata";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Prisma, prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { WEBSHOP_ADVANCE_TAG } from "./webshop-order-invoice.rules.js";
import { WebshopOrdersRepository } from "./webshop-orders.repository.js";

/*
  AZ ELŐLEG UTÁNI HÁTRALÉK BEÉRKEZÉSE, VALÓDI ADATBÁZISON (kártya d31a66a3, S3). MI PIROSÍT: hátralék rögzíthető egy olyan rendelésre,
  aminek nincs (előleg-)beérkezése (az idegen kulcs nem fog); a második hátralék is beíródik, vagy kivétellel áll meg a `false`
  helyett; ugyanaz a banki jóváírás két hátralékhoz is párosítható; a tár nem a rögzített összeget, napot, hivatkozást és rögzítőt
  adja vissza.
*/
const gate = integrationDatabaseGate(process.env);
const ORDER = "order_itbalance_";

async function removeLeftovers() {
  await prisma.webshopBalanceReceipt.deleteMany({
    where: { orderId: { startsWith: ORDER } },
  });
  await prisma.webshopTransferReceipt.deleteMany({
    where: { orderId: { startsWith: ORDER } },
  });
  await prisma.invoice.deleteMany({
    where: { sourceId: { startsWith: ORDER } },
  });
}

/** An issued advance proforma and its received transfer, as S2 leaves them. */
async function advanceIn(n: number) {
  const proforma = await prisma.invoice.create({
    data: {
      direction: "OUTBOUND",
      source: "MANUAL",
      partnerName: "Kitalalt Vevo",
      documentType: "PROFORMA",
      status: "ISSUED",
      sourceType: "WEBSHOP_ORDER",
      sourceId: `${ORDER}${n}`,
      grossAmount: new Prisma.Decimal("4800"),
      currency: "HUF",
      tags: [WEBSHOP_ADVANCE_TAG],
    },
  });
  await prisma.webshopTransferReceipt.create({
    data: {
      orderId: `${ORDER}${n}`,
      proformaId: proforma.id,
      source: "BANK_PAIRING",
      reference: `IT-ELOLEG-${n}`,
      receivedOn: new Date("2026-11-20T00:00:00Z"),
      amount: new Prisma.Decimal("4800"),
      currency: "HUF",
    },
  });
}

const balance = (n: number, over: { bankTransactionId?: string } = {}) => ({
  orderId: `${ORDER}${n}`,
  source: over.bankTransactionId
    ? ("BANK_PAIRING" as const)
    : ("MANUAL" as const),
  bankTransactionId: over.bankTransactionId ?? null,
  reference: `IT-HATRALEK-${n}`,
  receivedOn: "2026-11-26",
  amount: new Prisma.Decimal("8200"),
  currency: "HUF",
  recordedByUserId: null,
});

describe(
  "the balance receipt after an advance",
  { skip: gate.mode === "skip" },
  () => {
    const repository = new WebshopOrdersRepository();

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
    });

    it("is written once after the order's receipt, a second one answers false and changes nothing", async () => {
      await advanceIn(1);
      assert.equal(await repository.createBalanceReceipt(balance(1)), true);
      assert.equal(
        await repository.createBalanceReceipt({
          ...balance(1),
          reference: "masodik",
          amount: new Prisma.Decimal("1"),
        }),
        false,
      );
      const read = (await repository.balanceReceipts([`${ORDER}1`])).get(
        `${ORDER}1`,
      );
      assert.deepEqual(read, {
        source: "MANUAL",
        receivedOn: "2026-11-26",
        reference: "IT-HATRALEK-1",
        amount: "8200.0000",
        currency: "HUF",
        recordedBy: null,
      });
    });

    it("cannot be written for an order with no receipt (the foreign key)", async () => {
      await assert.rejects(
        repository.createBalanceReceipt(balance(2)),
        (error: unknown) =>
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2003",
      );
      assert.equal(
        await prisma.webshopBalanceReceipt.count({
          where: { orderId: `${ORDER}2` },
        }),
        0,
      );
    });

    it("one bank credit pairs with one balance only", async () => {
      await advanceIn(3);
      await advanceIn(4);
      const credit = `bt_${ORDER}x`;
      assert.equal(
        await repository.createBalanceReceipt(
          balance(3, { bankTransactionId: credit }),
        ),
        true,
      );
      // the unique credit answers as a second write does: false, nothing written
      assert.equal(
        await repository.createBalanceReceipt(
          balance(4, { bankTransactionId: credit }),
        ),
        false,
      );
      assert.equal(
        (await repository.balanceReceipts([`${ORDER}4`])).has(`${ORDER}4`),
        false,
      );
    });

    after(async () => {
      if (gate.mode === "skip") return;
      await removeLeftovers();
    });
  },
);
