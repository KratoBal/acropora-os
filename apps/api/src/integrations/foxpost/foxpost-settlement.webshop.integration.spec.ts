import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import { FoxpostSettlementRepository } from "./foxpost-settlement.repository.js";

/**
 * THE WEBSHOP-REFERENCE LOOKUP ON A REAL DATABASE. A mocked repository only
 * proves that the service asks in the right order; what the query itself
 * leaves out (another carrier's parcel, a draft or proforma, an invoice a
 * storno has taken out) only the database can show.
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "FXWIT-";
const ORDER = "order_fxwit_";

async function removeLeftovers() {
  await prisma.invoice.deleteMany({
    where: { invoiceNumber: { startsWith: PREFIX } },
  });
  await prisma.webshopParcel.deleteMany({
    where: { commerceOrderId: { startsWith: ORDER } },
  });
}

describe(
  "FoxpostSettlementRepository.resolveWebshop",
  { skip: gate.mode === "skip" },
  () => {
    const repository = new FoxpostSettlementRepository();
    const ids: Record<string, string> = {};

    const parcel = (
      order: string,
      reference: string,
      over: { carrier?: string; status?: "ACTIVE" | "CANCELLED" } = {},
    ) =>
      prisma.webshopParcel.create({
        data: {
          commerceOrderId: `${ORDER}${order}`,
          carrier: over.carrier ?? "foxpost",
          reference,
          status: over.status ?? "ACTIVE",
        },
      });
    const invoice = async (
      key: string,
      order: string,
      over: {
        documentType?: "INVOICE" | "PROFORMA" | "STORNO";
        status?: "DRAFT" | "ISSUING" | "ISSUED";
        direction?: "OUTBOUND" | "INBOUND";
        referencedInvoiceId?: string;
      } = {},
    ) => {
      const row = await prisma.invoice.create({
        data: {
          direction: over.direction ?? "OUTBOUND",
          source: "MANUAL",
          partnerName: "Kitalalt Vevo",
          invoiceNumber: `${PREFIX}${key}`,
          documentType: over.documentType ?? "INVOICE",
          status: over.status ?? "ISSUED",
          sourceType: "WEBSHOP_ORDER",
          sourceId: `${ORDER}${order}`,
          referencedInvoiceId: over.referencedInvoiceId,
        },
        select: { id: true },
      });
      ids[key] = row.id;
      return row.id;
    };

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      // A: one live invoice
      await parcel("A", "FXWIT-A");
      await invoice("A", "A");
      // B: a cancelled parcel and its replacement share the reference: ONE order
      await parcel("B", "FXWIT-B", { status: "CANCELLED" });
      await prisma.webshopParcel.create({
        data: {
          commerceOrderId: `${ORDER}B`,
          carrier: "foxpost",
          reference: "FXWIT-B",
        },
      });
      await invoice("B", "B");
      // C: the invoice was cancelled by an issued storno; a draft is no invoice yet
      await parcel("C", "FXWIT-C");
      const cancelled = await invoice("C", "C");
      await invoice("C-STORNO", "C", {
        documentType: "STORNO",
        referencedInvoiceId: cancelled,
      });
      // D: only a proforma and a draft: nothing live
      await parcel("D", "FXWIT-D");
      await invoice("D-PRO", "D", { documentType: "PROFORMA" });
      await invoice("D-DRAFT", "D", { status: "DRAFT" });
      // E: a GLS parcel with the same kind of reference is not a Foxpost line
      await parcel("E", "FXWIT-E", { carrier: "gls" });
      await invoice("E", "E");
      // F: one reference on two orders; G: a draft storno does not cancel
      await parcel("F1", "FXWIT-F");
      await parcel("F2", "FXWIT-F");
      await parcel("G", "FXWIT-G");
      const live = await invoice("G", "G");
      await invoice("G-STORNO", "G", {
        documentType: "STORNO",
        status: "DRAFT",
        referencedInvoiceId: live,
      });
      // H: an incoming document never counts as our invoice
      await parcel("H", "FXWIT-H");
      await invoice("H", "H", { direction: "INBOUND" });
    });

    after(async () => {
      if (gate.mode !== "run") return;
      await removeLeftovers();
      nincsMaradek([
        {
          nev: "the suite's invoices survived the cleanup",
          darab: await prisma.invoice.count({
            where: { invoiceNumber: { startsWith: PREFIX } },
          }),
        },
        {
          nev: "the suite's parcels survived the cleanup",
          darab: await prisma.webshopParcel.count({
            where: { commerceOrderId: { startsWith: ORDER } },
          }),
        },
      ]);
    });

    it("finds the order and only its live outgoing invoice, per reference", async () => {
      const found = await repository.resolveWebshop(
        ["A", "B", "C", "D", "E", "F", "G", "H", "X"].map((k) => `FXWIT-${k}`),
      );
      const by = new Map(found.map((row) => [row.referenceCode, row]));
      const numbers = (key: string) =>
        by.get(`FXWIT-${key}`)?.invoices.map((i) => i.invoiceNumber);

      assert.deepEqual(by.get("FXWIT-A")?.webshopOrderIds, [`${ORDER}A`]);
      assert.deepEqual(numbers("A"), [`${PREFIX}A`]);
      assert.equal(by.get("FXWIT-A")?.invoices[0]?.id, ids["A"]);
      // the cancelled parcel and its replacement are one order
      assert.deepEqual(by.get("FXWIT-B")?.webshopOrderIds, [`${ORDER}B`]);
      assert.deepEqual(numbers("B"), [`${PREFIX}B`]);
      // order known, nothing live
      assert.deepEqual(numbers("C"), []);
      assert.deepEqual(numbers("D"), []);
      assert.equal(by.get("FXWIT-C")?.webshopOrderIds.length, 1);
      // another carrier's parcel: not found at all
      assert.equal(by.has("FXWIT-E"), false);
      // two orders for one reference are both reported, never picked
      assert.deepEqual([...(by.get("FXWIT-F")?.webshopOrderIds ?? [])].sort(), [
        `${ORDER}F1`,
        `${ORDER}F2`,
      ]);
      // a draft storno has cancelled nothing
      assert.deepEqual(numbers("G"), [`${PREFIX}G`]);
      assert.deepEqual(numbers("H"), []);
      // a reference with no parcel is simply absent
      assert.equal(by.has("FXWIT-X"), false);
    });

    it("answers an empty list without a query", async () => {
      assert.deepEqual(await repository.resolveWebshop([]), []);
    });
  },
);
