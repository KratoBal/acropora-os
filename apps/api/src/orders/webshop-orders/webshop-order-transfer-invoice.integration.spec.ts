import "reflect-metadata";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Prisma, prisma } from "@acropora/database";

import { BillingDocumentsRepository } from "../../billing/billing-documents.repository.js";
import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import { WEBSHOP_ADVANCE_TAG } from "./webshop-order-invoice.rules.js";
import { WebshopOrdersRepository } from "./webshop-orders.repository.js";

/*
  AZ ELŐRE UTALÁS SZÁMLÁJÁNAK OLVASÁSAI, VALÓDI ADATBÁZISON (kártya d31a66a3, S1). MI PIROSÍT:
  - az Autokassza-őrző nem látja a rendelésszámmal vagy a díjbekérő számával kötődő Számlázz.hu-számlát, vagy megállít a sztornózotton,
    a díjbekérőn magán, a díjbekérő előtt keltén, egy hosszabb díjbekérő-számot említő üzeneten, vagy az OS saját számlájának ikrén;
  - a díjbekérő-kötés egy kiállított számlát is átír, vagy változatlan kötésnél is ír (a vázlat `updatedAt`-je elmozdul);
  - a beérkezés előleg-jele, a beérkezés tényei a számlázásnak, vagy a rendelés többi bizonylata rossz sort ad.
*/
const gate = integrationDatabaseGate(process.env);
const ORDER = "order_ittrinv_";
const FEED = "ittrinv-";

async function removeLeftovers() {
  await prisma.webshopTransferReceipt.deleteMany({
    where: { orderId: { startsWith: ORDER } },
  });
  // the stornos first: they point at the invoices of the orders
  await prisma.invoice.deleteMany({
    where: { documentType: "STORNO", reference: { startsWith: FEED } },
  });
  await prisma.invoice.deleteMany({
    where: { sourceId: { startsWith: ORDER } },
  });
  await prisma.externalBillingDocument.deleteMany({
    where: { externalId: { startsWith: FEED } },
  });
  await prisma.szamlazzFeedMessage.deleteMany({
    where: { externalId: { startsWith: FEED } },
  });
}

const invoice = (
  n: number,
  data: {
    documentType:
      | "PROFORMA"
      | "INVOICE"
      | "ADVANCE_INVOICE"
      | "FINAL_INVOICE"
      | "DELIVERY_NOTE";
    status: "DRAFT" | "ISSUING" | "ISSUED";
    invoiceNumber?: string | null;
    reference?: string | null;
    tags?: string[];
    createdAt?: Date;
  },
) =>
  prisma.invoice.create({
    data: {
      direction: "OUTBOUND",
      source: "MANUAL",
      partnerName: "Kitalalt Vevo",
      sourceType: "WEBSHOP_ORDER",
      sourceId: `${ORDER}${n}`,
      grossAmount: new Prisma.Decimal("1600"),
      currency: "HUF",
      documentType: data.documentType,
      status: data.status,
      invoiceNumber: data.invoiceNumber ?? null,
      reference: data.reference ?? null,
      tags: data.tags ?? [],
      ...(data.createdAt ? { createdAt: data.createdAt } : {}),
    },
  });

const feedDocument = (
  key: string,
  data: {
    kindCode: string;
    documentNumber: string;
    orderNumber?: string | null;
    issueDate: string;
    cancelled?: boolean;
  },
) =>
  prisma.externalBillingDocument.create({
    data: {
      externalId: `${FEED}${key}`,
      feedMessageId: `${FEED}msg-${key}`,
      feedReceivedAt: new Date(`${data.issueDate}T10:00:00Z`),
      kindCode: data.kindCode,
      documentNumber: data.documentNumber,
      electronic: true,
      issueDate: new Date(`${data.issueDate}T00:00:00Z`),
      orderNumber: data.orderNumber ?? null,
      currency: "HUF",
      customerName: "Kitalalt Vevo",
      netAmount: new Prisma.Decimal("1259.84"),
      vatAmount: new Prisma.Decimal("340.16"),
      grossAmount: new Prisma.Decimal("1600"),
      lines: [],
      cancelled: data.cancelled ?? false,
    },
  });

const feedMessage = (key: string, body: string, receivedAt: string) =>
  prisma.szamlazzFeedMessage.create({
    data: {
      kind: "SZAMLAKI",
      externalId: `${FEED}${key}`,
      sha256: `${FEED}${key}`,
      body,
      receivedAt: new Date(receivedAt),
    },
  });

describe(
  "the prepaid order's invoice reads",
  { skip: gate.mode === "skip" },
  () => {
    const orders = new WebshopOrdersRepository();
    const billing = new BillingDocumentsRepository();

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
    });

    it("the Autokassza check sees the order's foreign invoices, and only those", async () => {
      const reference = `${FEED}Webshop rendelés #1`;
      const proforma = await invoice(1, {
        documentType: "PROFORMA",
        status: "ISSUED",
        invoiceNumber: "D-ITTRINV-1",
        reference,
        createdAt: new Date("2026-11-20T09:00:00Z"),
      });
      // the OS's own invoice of the order: its twin comes back through the feed
      await invoice(1, {
        documentType: "INVOICE",
        status: "ISSUED",
        invoiceNumber: "E-ITTRINV-OWN",
      });
      await feedDocument("by-order", {
        kindCode: "SZ",
        documentNumber: "E-ITTRINV-A",
        orderNumber: reference,
        issueDate: "2026-11-21",
      });
      await feedDocument("by-mention", {
        kindCode: "ES",
        documentNumber: "E-ITTRINV-B",
        issueDate: "2026-11-22",
      });
      await feedMessage(
        "by-mention",
        "<dijbekeroSzamlaszam>D-ITTRINV-1</dijbekeroSzamlaszam>",
        "2026-11-22T10:00:00Z",
      );
      await feedDocument("cancelled", {
        kindCode: "SZ",
        documentNumber: "E-ITTRINV-C",
        orderNumber: reference,
        issueDate: "2026-11-21",
        cancelled: true,
      });
      await feedDocument("proforma-itself", {
        kindCode: "D",
        documentNumber: "D-ITTRINV-1",
        orderNumber: reference,
        issueDate: "2026-11-20",
      });
      // a Számlázz.hu storno (SS) and a second proforma (D) carry the order number too: neither is an invoice of the order
      await feedDocument("storno-kind", {
        kindCode: "SS",
        documentNumber: "E-ITTRINV-S",
        orderNumber: reference,
        issueDate: "2026-11-22",
      });
      await feedDocument("second-proforma", {
        kindCode: "D",
        documentNumber: "D-ITTRINV-1B",
        orderNumber: reference,
        issueDate: "2026-11-22",
      });
      await feedDocument("before", {
        kindCode: "SZ",
        documentNumber: "E-ITTRINV-D",
        orderNumber: reference,
        issueDate: "2026-11-19",
      });
      await feedDocument("longer-number", {
        kindCode: "SZ",
        documentNumber: "E-ITTRINV-E",
        issueDate: "2026-11-22",
      });
      await feedMessage(
        "longer-number",
        "<dijbekeroSzamlaszam>D-ITTRINV-12</dijbekeroSzamlaszam>",
        "2026-11-22T10:00:00Z",
      );
      await feedDocument("own-twin", {
        kindCode: "SZ",
        documentNumber: "E-ITTRINV-OWN",
        orderNumber: reference,
        issueDate: "2026-11-23",
      });

      assert.deepEqual(
        await orders.foreignFeedInvoices(`${ORDER}1`, {
          number: "D-ITTRINV-1",
          reference,
          issuedOn: proforma.createdAt,
        }),
        ["E-ITTRINV-A", "E-ITTRINV-B"],
      );
      // the shared billing issue asks the same question by the proforma's id, and gets the same answer
      assert.deepEqual(
        await billing.webshopForeignFeedInvoices(`${ORDER}1`, proforma.id),
        ["E-ITTRINV-A", "E-ITTRINV-B"],
      );
      // another order's proforma, with no reference and no mention: nothing
      assert.deepEqual(
        await orders.foreignFeedInvoices(`${ORDER}2`, {
          number: "D-ITTRINV-2",
          reference: null,
          issuedOn: proforma.createdAt,
        }),
        [],
      );
    });

    it("the invoice draft is linked to its proforma once; an issued invoice is not changed", async () => {
      const proforma = await invoice(3, {
        documentType: "PROFORMA",
        status: "ISSUED",
        invoiceNumber: "D-ITTRINV-3",
      });
      const draft = await invoice(3, {
        documentType: "INVOICE",
        status: "DRAFT",
      });
      assert.equal(
        await orders.linkInvoiceProforma(draft.id, proforma.id),
        true,
      );
      const linked = await prisma.invoice.findUniqueOrThrow({
        where: { id: draft.id },
      });
      assert.equal(linked.proformaInvoiceId, proforma.id);
      assert.equal(
        await orders.linkInvoiceProforma(draft.id, proforma.id),
        false,
      );
      assert.deepEqual(
        (await prisma.invoice.findUniqueOrThrow({ where: { id: draft.id } }))
          .updatedAt,
        linked.updatedAt,
      );
      const issued = await invoice(4, {
        documentType: "INVOICE",
        status: "ISSUED",
        invoiceNumber: "E-ITTRINV-4",
      });
      assert.equal(
        await orders.linkInvoiceProforma(issued.id, proforma.id),
        false,
      );
      assert.equal(
        (await prisma.invoice.findUniqueOrThrow({ where: { id: issued.id } }))
          .proformaInvoiceId,
        null,
      );
    });

    it("the receipt tells the advance apart, and the billing reads it only for the proforma it paid", async () => {
      const advance = await invoice(5, {
        documentType: "PROFORMA",
        status: "ISSUED",
        tags: [WEBSHOP_ADVANCE_TAG],
      });
      const full = await invoice(6, {
        documentType: "PROFORMA",
        status: "ISSUED",
      });
      for (const [n, paid] of [
        [5, advance],
        [6, full],
      ] as const)
        await prisma.webshopTransferReceipt.create({
          data: {
            orderId: `${ORDER}${n}`,
            proformaId: paid.id,
            source: "MANUAL",
            reference: `IT-${n}`,
            receivedOn: new Date("2026-11-25T00:00:00Z"),
            amount: new Prisma.Decimal("1600"),
            currency: "HUF",
          },
        });
      const receipts = await orders.transferReceipts([
        `${ORDER}5`,
        `${ORDER}6`,
      ]);
      assert.equal(receipts.get(`${ORDER}5`)?.advance, true);
      assert.equal(receipts.get(`${ORDER}6`)?.advance, false);
      assert.equal(
        (await orders.transferReceiptProforma(`${ORDER}6`))?.id,
        full.id,
      );
      assert.equal(await orders.transferReceiptProforma(`${ORDER}9`), null);

      const facts = await billing.webshopTransferFacts(`${ORDER}6`, full.id);
      assert.deepEqual(
        facts && {
          amount: facts.amount.toFixed(2),
          currency: facts.currency,
          advance: facts.advance,
        },
        { amount: "1600.00", currency: "HUF", advance: false },
      );
      assert.equal(
        (await billing.webshopTransferFacts(`${ORDER}5`, advance.id))?.advance,
        true,
      );
      // the receipt paid another proforma than the one asked about
      assert.equal(
        await billing.webshopTransferFacts(`${ORDER}6`, advance.id),
        null,
      );
    });

    it("the order's other invoices: issued and issuing count, drafts and other types do not, the cancelled ones are marked", async () => {
      const own = await invoice(7, {
        documentType: "INVOICE",
        status: "DRAFT",
      });
      await invoice(7, {
        documentType: "ADVANCE_INVOICE",
        status: "ISSUED",
        invoiceNumber: "E-ITTRINV-71",
      });
      await invoice(7, { documentType: "FINAL_INVOICE", status: "ISSUING" });
      await invoice(7, { documentType: "FINAL_INVOICE", status: "DRAFT" });
      await invoice(7, {
        documentType: "DELIVERY_NOTE",
        status: "ISSUED",
        invoiceNumber: "SZL-ITTRINV-7",
      });
      const stornoed = await invoice(7, {
        documentType: "INVOICE",
        status: "ISSUED",
        invoiceNumber: "E-ITTRINV-72",
      });
      await prisma.invoice.create({
        data: {
          direction: "OUTBOUND",
          source: "MANUAL",
          partnerName: "Kitalalt Vevo",
          documentType: "STORNO",
          status: "ISSUED",
          invoiceNumber: "S-ITTRINV-72",
          reference: `${FEED}storno`,
          referencedInvoiceId: stornoed.id,
          currency: "HUF",
        },
      });
      await invoice(7, {
        documentType: "INVOICE",
        status: "ISSUED",
        invoiceNumber: "E-ITTRINV-73",
      });
      await feedDocument("site-cancelled", {
        kindCode: "SZ",
        documentNumber: "E-ITTRINV-73",
        issueDate: "2026-11-24",
        cancelled: true,
      });

      const others = await billing.webshopOrderInvoices(`${ORDER}7`, own.id);
      assert.deepEqual(
        others
          .map((row) => [
            row.documentType,
            row.status,
            row.number,
            row.cancelled,
          ])
          .sort((a, b) => String(a[2]).localeCompare(String(b[2]))),
        [
          ["ADVANCE_INVOICE", "ISSUED", "E-ITTRINV-71", false],
          ["INVOICE", "ISSUED", "E-ITTRINV-72", true],
          ["INVOICE", "ISSUED", "E-ITTRINV-73", true],
          ["FINAL_INVOICE", "ISSUING", null, false],
        ],
      );
    });

    /*
      S2: AZ OS SAJÁT ELŐLEGSZÁMLÁJA NEM „KÜLSŐ” SZÁMLA. MI PIROSÍT: az OS előlegszámlájának feed-ikre a rendeléshez kötődik (a lépés
      késznek, a csomag feladhatónak látszana); a kötött idegen számla fajtája nem jön át; a vázlat napjai kiállított bizonylatot is
      átírnak, vagy változatlan napnál is írnak.
    */
    it("the order's own advance twin is not linked as external; a foreign one carries its kind", async () => {
      const reference = `${FEED}Webshop rendelés #8`;
      await invoice(8, {
        documentType: "PROFORMA",
        status: "ISSUED",
        invoiceNumber: "D-ITTRINV-8",
        reference,
        createdAt: new Date("2026-11-20T09:00:00Z"),
      });
      await invoice(8, {
        documentType: "ADVANCE_INVOICE",
        status: "ISSUED",
        invoiceNumber: "E-ITTRINV-8-OWN",
      });
      await feedDocument("own-advance", {
        kindCode: "ES",
        documentNumber: "E-ITTRINV-8-OWN",
        orderNumber: reference,
        issueDate: "2026-11-21",
      });
      assert.equal(
        (await orders.externalInvoices([`${ORDER}8`])).get(`${ORDER}8`),
        undefined,
      );

      const reference9 = `${FEED}Webshop rendelés #9`;
      await invoice(9, {
        documentType: "PROFORMA",
        status: "ISSUED",
        invoiceNumber: "D-ITTRINV-9",
        reference: reference9,
        createdAt: new Date("2026-11-20T09:00:00Z"),
      });
      await feedDocument("foreign-advance", {
        kindCode: "ES",
        documentNumber: "E-ITTRINV-9",
        orderNumber: reference9,
        issueDate: "2026-11-21",
      });
      const linked = (await orders.externalInvoices([`${ORDER}9`])).get(
        `${ORDER}9`,
      );
      assert.deepEqual(linked && [linked.number, linked.kindCode], [
        "E-ITTRINV-9",
        "ES",
      ]);
    });

    it("the advance draft's days are set once, on a draft only", async () => {
      const draft = await invoice(10, {
        documentType: "ADVANCE_INVOICE",
        status: "DRAFT",
      });
      assert.equal(await orders.setDraftDays(draft.id, "2026-11-22"), true);
      const set = await prisma.invoice.findUniqueOrThrow({
        where: { id: draft.id },
      });
      assert.deepEqual(
        [set.fulfillmentDate?.toISOString(), set.dueDate?.toISOString()],
        ["2026-11-22T00:00:00.000Z", "2026-11-22T00:00:00.000Z"],
      );
      assert.equal(await orders.setDraftDays(draft.id, "2026-11-22"), false);
      assert.deepEqual(
        (await prisma.invoice.findUniqueOrThrow({ where: { id: draft.id } }))
          .updatedAt,
        set.updatedAt,
      );
      const issued = await invoice(11, {
        documentType: "ADVANCE_INVOICE",
        status: "ISSUED",
        invoiceNumber: "E-ITTRINV-11",
      });
      assert.equal(await orders.setDraftDays(issued.id, "2026-11-22"), false);
    });

    after(async () => {
      if (gate.mode !== "run") return;
      await removeLeftovers();
      nincsMaradek([
        {
          nev: "Invoice by sourceId prefix",
          darab: await prisma.invoice.count({
            where: { sourceId: { startsWith: ORDER } },
          }),
        },
        {
          nev: "Storno by reference prefix",
          darab: await prisma.invoice.count({
            where: { reference: { startsWith: FEED } },
          }),
        },
        {
          nev: "WebshopTransferReceipt by orderId prefix",
          darab: await prisma.webshopTransferReceipt.count({
            where: { orderId: { startsWith: ORDER } },
          }),
        },
        {
          nev: "ExternalBillingDocument by externalId prefix",
          darab: await prisma.externalBillingDocument.count({
            where: { externalId: { startsWith: FEED } },
          }),
        },
        {
          nev: "SzamlazzFeedMessage by externalId prefix",
          darab: await prisma.szamlazzFeedMessage.count({
            where: { externalId: { startsWith: FEED } },
          }),
        },
      ]);
    });
  },
);
