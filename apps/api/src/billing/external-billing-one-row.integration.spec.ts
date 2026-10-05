import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { nincsMaradek } from "../common/takaritas-leltar.js";
import type {
  EbizClient,
  EbizInvoiceListItem,
} from "../integrations/ebiz/ebiz.client.js";
import {
  EbizSyncService,
  PrismaEbizSyncStore,
} from "../integrations/ebiz/ebiz-sync.service.js";
import { SzamlazzFeedsRepository } from "../missing-invoices/szamlazz-feeds.repository.js";
import { BillingDocumentListRepository } from "./billing-document-list.repository.js";
import { mergeExternalDuplicates } from "./external-billing-merge.cli.js";

/**
 * ONE OWN INVOICE NUMBER, ONE ROW, ON THE REAL DATABASE (acrobot 26208), in
 * both orders of arrival. WHAT TURNS IT RED: a second row for the number;
 * the row not being Számlázz.hu's (its payments) once Számlázz.hu knows it;
 * the eBIZ PDF lost in the takeover; a later eBIZ run creating a row again
 * or overwriting Számlázz.hu's data; the one-off merge leaving both rows.
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "egy-sor-it-";
const NUMBER = "ITDUP-";
const runIds: string[] = [];

async function removeLeftovers() {
  await prisma.externalBillingDocument.deleteMany({
    where: { documentNumber: { startsWith: NUMBER } },
  });
  await prisma.szamlazzFeedMessage.deleteMany({
    where: { externalId: { startsWith: PREFIX } },
  });
  await prisma.ebizSyncRun.deleteMany({ where: { id: { in: runIds } } });
}

const item = (id: number, invoiceNumber: string): EbizInvoiceListItem =>
  ({
    id,
    invoiceNumber,
    type: "INVOICE",
    cancelled: false,
    currencyCode: "HUF",
    customerName: "Teszt Vevő Kft.",
    issueDate: "2026-10-01",
    dueDate: "2026-10-08",
    deliveryDate: "2026-10-01",
    paymentMethod: "TRANSFER",
    paymentStatus: "WAITING_FOR_PAYMENT",
    summary: { netAmount: 100, vatAmount: 27, grossAmount: 127 },
  }) as EbizInvoiceListItem;

/** eBIZ with these invoices; the PDFs land in a map, not on disk. */
function ebiz(invoices: EbizInvoiceListItem[]) {
  const client = {
    configured: () => true,
    listInvoices: async () => ({
      data: invoices,
      pager: { total: invoices.length, limit: 50, offset: 0 },
    }),
    getInvoice: async (id: number) => ({ id, items: [] }),
    downloadInvoicePdf: async (id: number) =>
      new TextEncoder().encode(`%PDF-${id}`),
  };
  const documents = { put: async () => undefined };
  return async () => {
    const result = await new EbizSyncService(
      client as unknown as EbizClient,
      new PrismaEbizSyncStore(),
      documents as never,
      { DOCUMENT_STORE_ROOT: "/kitalalt/tar", OTP_EBIZ_SINCE: "2026-10-01" },
    ).run("MANUAL");
    if (result.state === "APPLIED") runIds.push(result.runId);
    return result;
  };
}

const feeds = new SzamlazzFeedsRepository();
async function szamlazz(externalId: string, documentNumber: string) {
  await feeds.storeRaw({
    kind: "SZAMLAKI",
    externalId,
    sha256: "v1",
    body: "<szamla/>",
  });
  return feeds.projectOutgoing({
    externalId,
    sha256: "v1",
    projection: {
      externalId,
      kindCode: "SZ",
      documentNumber,
      electronic: true,
      issueDate: "2026-10-01",
      fulfillmentDate: null,
      dueDate: "2026-10-08",
      paymentMethod: "Átutalás",
      paymentMethodUnified: "átutalás",
      orderNumber: null,
      currency: "HUF",
      customerName: "Teszt Vevő Kft.",
      customerTaxNumber: null,
      customerAddress: null,
      netAmount: "100",
      vatAmount: "27",
      grossAmount: "127",
      lines: [],
      cancelled: false,
      payments: [
        {
          date: "2026-10-02",
          title: "átutalás",
          amount: "127",
          note: "",
          bankTransactionId: null,
        },
      ],
      paymentsKnown: true,
      paidAmount: "127.00",
      lastPaymentDate: "2026-10-02",
    },
  });
}

const rowsOf = (documentNumber: string) =>
  prisma.externalBillingDocument.findMany({
    where: { documentNumber },
    select: {
      id: true,
      source: true,
      externalId: true,
      ebizExternalId: true,
      pdfStorageKey: true,
      paidAmount: true,
      externalPaymentStatus: true,
    },
  });

describe(
  "egy saját számlaszám egy sor (Számlázz.hu és eBIZ)",
  { skip: gate.mode === "skip" },
  () => {
    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
    });

    after(async () => {
      await removeLeftovers();
      nincsMaradek([
        {
          nev: "a kimenő számla teszt-sorai bent maradtak",
          darab: await prisma.externalBillingDocument.count({
            where: { documentNumber: { startsWith: NUMBER } },
          }),
        },
      ]);
    });

    it("Számlázz.hu first: eBIZ links its id and the PDF to that row, and adds none", async () => {
      assert.equal(await szamlazz(`${PREFIX}a`, `${NUMBER}A`), "PROJECTED");
      const sync = ebiz([item(990001, `${NUMBER}A`)]);
      await sync();
      await sync();
      const rows = await rowsOf(`${NUMBER}A`);
      assert.equal(rows.length, 1);
      assert.deepEqual(
        [
          rows[0]!.source,
          rows[0]!.externalId,
          rows[0]!.ebizExternalId,
          rows[0]!.pdfStorageKey,
          rows[0]!.paidAmount.toFixed(2),
          rows[0]!.externalPaymentStatus,
        ],
        [
          "SZAMLAZZ",
          `${PREFIX}a`,
          "990001",
          `external-invoices/${rows[0]!.id}/ebiz.pdf`,
          "127.00",
          null,
        ],
      );
    });

    it("eBIZ first: Számlázz.hu takes the row over, with its PDF, and the next eBIZ run adds none", async () => {
      const sync = ebiz([item(990002, `${NUMBER}B`)]);
      await sync();
      const [ebizRow] = await rowsOf(`${NUMBER}B`);
      assert.equal(ebizRow!.source, "EBIZ");
      assert.equal(await szamlazz(`${PREFIX}b`, `${NUMBER}B`), "PROJECTED");
      await sync();
      const rows = await rowsOf(`${NUMBER}B`);
      assert.equal(rows.length, 1);
      assert.deepEqual(
        [
          rows[0]!.id,
          rows[0]!.source,
          rows[0]!.externalId,
          rows[0]!.ebizExternalId,
          rows[0]!.pdfStorageKey,
          rows[0]!.paidAmount.toFixed(2),
          rows[0]!.externalPaymentStatus,
        ],
        [
          ebizRow!.id,
          "SZAMLAZZ",
          `${PREFIX}b`,
          "990002",
          ebizRow!.pdfStorageKey,
          "127.00",
          null,
        ],
      );
      // the list shows each number once
      const list = await new BillingDocumentListRepository().list({
        page: 1,
        pageSize: 100,
        q: NUMBER,
        origin: "EXTERNAL",
      });
      assert.deepEqual(list.items.map((i) => i.documentNumber).sort(), [
        `${NUMBER}A`,
        `${NUMBER}B`,
      ]);
    });

    it("the one-off merge folds an existing pair into the eBIZ row, dry run first", async () => {
      // the pre-fix state: both rows already stored
      const sync = ebiz([item(990003, `${NUMBER}C`)]);
      await sync();
      const [ebizRow] = await rowsOf(`${NUMBER}C`);
      await prisma.externalBillingDocument.create({
        data: {
          source: "SZAMLAZZ",
          externalId: `${PREFIX}c`,
          feedMessageId: "x",
          feedReceivedAt: new Date(),
          kindCode: "SZ",
          documentNumber: `${NUMBER}C`,
          electronic: true,
          issueDate: new Date("2026-10-01T00:00:00Z"),
          currency: "HUF",
          customerName: "Teszt Vevő Kft.",
          netAmount: "100",
          vatAmount: "27",
          grossAmount: "127",
          lines: [],
          payments: [],
          paymentsKnown: true,
          paidAmount: "127.00",
        },
      });
      const scope = { documentNumber: { startsWith: NUMBER } };
      const dry = await mergeExternalDuplicates(false, scope);
      assert.equal(dry.merged, 0);
      assert.match(dry.report, /összevonható 1,/);
      assert.equal((await rowsOf(`${NUMBER}C`)).length, 2);

      const applied = await mergeExternalDuplicates(true, scope);
      assert.equal(applied.merged, 1);
      const rows = await rowsOf(`${NUMBER}C`);
      assert.deepEqual(
        rows.map((r) => [
          r.id,
          r.source,
          r.externalId,
          r.ebizExternalId,
          r.pdfStorageKey,
          r.paidAmount.toFixed(2),
        ]),
        [
          [
            ebizRow!.id,
            "SZAMLAZZ",
            `${PREFIX}c`,
            "990003",
            ebizRow!.pdfStorageKey,
            "127.00",
          ],
        ],
      );
      assert.equal((await mergeExternalDuplicates(true, scope)).merged, 0);
    });
  },
);
