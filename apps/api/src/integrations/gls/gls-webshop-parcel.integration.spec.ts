import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import { GlsSettlementRepository } from "./gls-settlement.repository.js";

// What only a database can prove: a GLS parcel number leads, through WebshopParcel, to the webshop order and its LIVE outgoing
// invoice (issued, an invoice, no issued or in-flight storno); a cancelled and re-created parcel of one order is one order; two
// orders for one parcel number are both returned (the resolution does not pick); a Foxpost parcel and a parcel that is not ours
// are not found.
const gate = integrationDatabaseGate(process.env);

const PARCEL_PREFIX = "9914";
const INVOICE_PREFIX = "GLSWP";

describe(
  "GLS webshop parcel integration",
  { skip: gate.mode === "skip" },
  () => {
    const repository = new GlsSettlementRepository();
    const suffix = String(Date.now()).slice(-6);
    const parcel = (n: number) => `${PARCEL_PREFIX}${suffix}${n}`;
    const orderId = (n: number) => `order_glswp${suffix}${n}`;
    const invoiceNumber = (n: number) =>
      `${INVOICE_PREFIX}-2026/${suffix.slice(-4)}${n}`;

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
    });

    after(async () => {
      if (gate.mode !== "run") return;
      await removeLeftovers();
      nincsMaradek([
        {
          nev: "WebshopParcel by test parcel prefix",
          darab: await prisma.webshopParcel.count({
            where: { parcelNumber: { startsWith: PARCEL_PREFIX } },
          }),
        },
        {
          nev: "Invoice by test prefix",
          darab: await prisma.invoice.count({
            where: { invoiceNumber: { startsWith: `${INVOICE_PREFIX}-` } },
          }),
        },
      ]);
    });

    async function removeLeftovers() {
      await prisma.webshopParcel.deleteMany({
        where: { parcelNumber: { startsWith: PARCEL_PREFIX } },
      });
      // a storno points at its invoice: it goes first
      await prisma.invoice.deleteMany({
        where: {
          invoiceNumber: { startsWith: `${INVOICE_PREFIX}-` },
          referencedInvoiceId: { not: null },
        },
      });
      await prisma.invoice.deleteMany({
        where: { invoiceNumber: { startsWith: `${INVOICE_PREFIX}-` } },
      });
    }

    const webshopParcel = (
      n: number,
      order: number,
      extra: { carrier?: string; status?: "ACTIVE" | "CANCELLED" } = {},
    ) =>
      prisma.webshopParcel.create({
        data: {
          commerceOrderId: orderId(order),
          carrier: extra.carrier ?? "gls",
          reference: String(70 + order),
          parcelNumber: parcel(n),
          ...(extra.status ? { status: extra.status } : {}),
        },
      });
    const invoice = (
      n: number,
      order: number,
      extra: Record<string, unknown> = {},
    ) =>
      prisma.invoice.create({
        data: {
          direction: "OUTBOUND",
          source: "MANUAL",
          partnerName: "Kitalalt Vevo",
          sourceType: "WEBSHOP_ORDER",
          sourceId: orderId(order),
          invoiceNumber: invoiceNumber(n),
          ...extra,
        },
      });

    it("leads a parcel number to its order and the order's live invoice", async () => {
      await webshopParcel(1, 1);
      await invoice(1, 1);
      const found = await repository.webshopParcels([parcel(1)]);
      assert.deepEqual(found.get(parcel(1)), {
        orderIds: [orderId(1)],
        invoiceNumbers: [invoiceNumber(1)],
      });
    });

    it("an order with no invoice is found, with an empty invoice list", async () => {
      await webshopParcel(2, 2);
      assert.deepEqual(
        (await repository.webshopParcels([parcel(2)])).get(parcel(2)),
        {
          orderIds: [orderId(2)],
          invoiceNumbers: [],
        },
      );
    });

    it("a draft, a stornoed invoice and an invoice with a storno in flight are not live", async () => {
      await webshopParcel(3, 3);
      await invoice(3, 3, { status: "DRAFT" });
      await webshopParcel(4, 4);
      const stornoed = await invoice(4, 4);
      await invoice(5, 4, {
        invoiceNumber: `${invoiceNumber(4)}S`,
        documentType: "STORNO",
        status: "ISSUED",
        referencedInvoiceId: stornoed.id,
      });
      await webshopParcel(5, 5);
      const inFlight = await invoice(6, 5);
      await invoice(7, 5, {
        invoiceNumber: `${invoiceNumber(5)}S`,
        documentType: "STORNO",
        status: "ISSUING",
        referencedInvoiceId: inFlight.id,
      });
      const found = await repository.webshopParcels([
        parcel(3),
        parcel(4),
        parcel(5),
      ]);
      assert.deepEqual(found.get(parcel(3))?.invoiceNumbers, []);
      assert.deepEqual(found.get(parcel(4))?.invoiceNumbers, []);
      assert.deepEqual(found.get(parcel(5))?.invoiceNumbers, []);
    });

    it("a cancelled and a re-created parcel of one order is still one order; one parcel number on two orders is two", async () => {
      await prisma.webshopParcel.create({
        data: {
          commerceOrderId: orderId(6),
          carrier: "gls",
          reference: "76",
          parcelNumber: parcel(6),
          status: "CANCELLED",
        },
      });
      await prisma.webshopParcel.create({
        data: {
          commerceOrderId: orderId(6),
          carrier: "gls",
          reference: "76",
          parcelNumber: parcel(6),
        },
      });
      await webshopParcel(7, 7);
      await prisma.webshopParcel.create({
        data: {
          commerceOrderId: orderId(8),
          carrier: "gls",
          reference: "78",
          parcelNumber: parcel(7),
        },
      });
      const found = await repository.webshopParcels([parcel(6), parcel(7)]);
      assert.deepEqual(found.get(parcel(6))?.orderIds, [orderId(6)]);
      assert.deepEqual([...(found.get(parcel(7))?.orderIds ?? [])].sort(), [
        orderId(7),
        orderId(8),
      ]);
    });

    it("a Foxpost parcel, a parcel that is not ours and an empty question are not found", async () => {
      await webshopParcel(8, 9, { carrier: "foxpost" });
      const found = await repository.webshopParcels([
        parcel(8),
        `${PARCEL_PREFIX}0000000`,
      ]);
      assert.equal(found.size, 0);
      assert.equal((await repository.webshopParcels([])).size, 0);
    });
  },
);
