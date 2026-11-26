import "reflect-metadata";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Prisma, prisma } from "@acropora/database";

import { BillingDocumentsRepository } from "../../billing/billing-documents.repository.js";
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

    // S4: the billing reads the balance for the final invoice's "paid" and its check
    it("the billing reads the order's balance, and nothing for an order without one", async () => {
      await advanceIn(5);
      await repository.createBalanceReceipt(balance(5));
      const billing = new BillingDocumentsRepository();
      const facts = await billing.webshopBalanceFacts(`${ORDER}5`);
      assert.equal(facts?.amount.toFixed(4), "8200.0000");
      assert.equal(facts?.currency, "HUF");
      assert.equal(await billing.webshopBalanceFacts(`${ORDER}9`), null);
    });

    // S4: the issued final invoice invoices the order (the invoice step, the parcel, the list), a draft does not, an invoice wins
    it("the order's settling invoice: an issued final invoice counts, its draft does not, an invoice comes first", async () => {
      const doc = (
        n: number,
        documentType: "INVOICE" | "FINAL_INVOICE",
        status: "DRAFT" | "ISSUED",
      ) =>
        prisma.invoice.create({
          data: {
            direction: "OUTBOUND",
            source: "MANUAL",
            partnerName: "Kitalalt Vevo",
            documentType,
            status,
            invoiceNumber: status === "ISSUED" ? `${documentType}-${n}` : null,
            sourceType: "WEBSHOP_ORDER",
            sourceId: `${ORDER}${n}`,
            grossAmount: new Prisma.Decimal("13000"),
            currency: "HUF",
          },
        });
      await doc(6, "FINAL_INVOICE", "DRAFT");
      const issued = await doc(7, "FINAL_INVOICE", "ISSUED");
      const invoice = await doc(8, "INVOICE", "DRAFT");
      await doc(8, "FINAL_INVOICE", "ISSUED");
      const settling = await repository.settlingInvoices([
        `${ORDER}6`,
        `${ORDER}7`,
        `${ORDER}8`,
      ]);
      assert.equal(settling.has(`${ORDER}6`), false);
      assert.equal(settling.get(`${ORDER}7`)?.id, issued.id);
      assert.equal(settling.get(`${ORDER}8`)?.id, invoice.id);
    });

    // barracuda on #2980: a final invoice relabelled as MANUAL still counts as the order's, through the advance invoice it deducts
    it("the order's other invoices include a final invoice relabelled as MANUAL, by its advance invoice", async () => {
      const advance = await prisma.invoice.create({
        data: {
          direction: "OUTBOUND",
          source: "MANUAL",
          partnerName: "Kitalalt Vevo",
          documentType: "ADVANCE_INVOICE",
          status: "ISSUED",
          invoiceNumber: "IT-ELO-10",
          sourceType: "WEBSHOP_ORDER",
          sourceId: `${ORDER}10`,
          grossAmount: new Prisma.Decimal("4800"),
          currency: "HUF",
        },
      });
      await prisma.invoice.create({
        data: {
          direction: "OUTBOUND",
          source: "MANUAL",
          partnerName: "Kitalalt Vevo",
          documentType: "FINAL_INVOICE",
          status: "ISSUED",
          invoiceNumber: "IT-VEG-10",
          sourceType: "MANUAL",
          sourceId: `${ORDER}10-relabelled`,
          referencedInvoiceId: advance.id,
          grossAmount: new Prisma.Decimal("13000"),
          currency: "HUF",
        },
      });
      const billing = new BillingDocumentsRepository();
      const others = await billing.webshopOrderInvoices(`${ORDER}10`, "none");
      assert.deepEqual(others.map((row) => row.documentType).sort(), [
        "ADVANCE_INVOICE",
        "FINAL_INVOICE",
      ]);
    });

    after(async () => {
      if (gate.mode === "skip") return;
      await removeLeftovers();
    });
  },
);
