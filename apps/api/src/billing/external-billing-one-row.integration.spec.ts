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
import type { NavInvoiceDigestItem } from "../integrations/nav/nav-online-invoice.client.js";
import {
  NavOutboundBackfill,
  prismaNavOutboundPresent,
  prismaNavOutboundWriter,
} from "./nav-outbound-backfill.js";
import { prismaFeedBackfillStore } from "./paid-marks/feed-backfill.service.js";
import { mailPdfCandidates } from "./external-invoice-mail-pdf.js";

/**
 * ONE OWN INVOICE NUMBER, ONE ROW, ON THE REAL DATABASE (acrobot 26208), in
 * both orders of arrival. WHAT TURNS IT RED: a second row for the number;
 * the row not being Számlázz.hu's (its payments) once Számlázz.hu knows it;
 * the eBIZ PDF lost in the takeover; a later eBIZ run creating a row again
 * or overwriting Számlázz.hu's data; the one-off merge leaving both rows.
 * NAV, THE THIRD SOURCE (card 785dfea6): a rerun of the NAV writer adding a
 * row; a storno cancelling anything but a NAV original; Számlázz.hu or eBIZ
 * adding a second row beside a NAV row instead of taking it over (same id).
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
  await prisma.invoice.deleteMany({
    where: { invoiceNumber: { startsWith: NUMBER } },
  });
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

const navItem = (
  invoiceNumber: string,
  over: Partial<NavInvoiceDigestItem> = {},
): NavInvoiceDigestItem => ({
  invoiceNumber,
  invoiceOperation: "CREATE",
  invoiceIssueDate: "2026-05-04",
  insDate: "2026-05-05T08:00:00.000Z",
  currency: "HUF",
  invoiceNetAmount: "100",
  invoiceVatAmount: "27",
  customerName: "Teszt Vevő Kft.",
  invoiceAppearance: "ELECTRONIC",
  transactionId: "IT",
  index: 1,
  ...over,
});

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

    it("NAV writer: the missing rows once, a rerun adds none, a storno cancels only a NAV original", async () => {
      // a Számlázz.hu original: its storno is the feed's, the NAV writer leaves it alone. Its externalId is the number's key ON
      // PURPOSE (a feed id never is): so only the source condition keeps the writer off it, and the test sees that condition
      await prisma.externalBillingDocument.create({
        data: {
          source: "SZAMLAZZ",
          externalId: `${NUMBER}F`,
          feedMessageId: "x",
          feedReceivedAt: new Date(),
          kindCode: "SZ",
          documentNumber: `${NUMBER}F`,
          electronic: true,
          issueDate: new Date("2026-05-01T00:00:00Z"),
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
      const batch = [
        navItem(`${NUMBER}N1`),
        navItem(`${NUMBER}N2`, { invoiceNetAmount: undefined }),
        navItem(`${NUMBER}N3`, {
          invoiceOperation: "STORNO",
          originalInvoiceNumber: ` ${NUMBER.toLowerCase()}n1`,
          invoiceNetAmount: "-100",
          invoiceVatAmount: "-27",
        }),
        navItem(`${NUMBER}N4`, {
          invoiceOperation: "STORNO",
          originalInvoiceNumber: `${NUMBER}F`,
          invoiceNetAmount: "-100",
          invoiceVatAmount: "-27",
        }),
      ];
      assert.deepEqual(await prismaNavOutboundWriter.write(batch), {
        created: 3,
        cancelled: 1,
        skippedNoAmount: 1,
      });
      assert.deepEqual(await prismaNavOutboundWriter.write(batch), {
        created: 0,
        cancelled: 0,
        skippedNoAmount: 1,
      });
      const rows = await prisma.externalBillingDocument.findMany({
        where: {
          documentNumber: {
            in: [`${NUMBER}N1`, `${NUMBER}N3`, `${NUMBER}N4`, `${NUMBER}F`],
          },
        },
        orderBy: { documentNumber: "asc" },
        select: {
          documentNumber: true,
          source: true,
          kindCode: true,
          cancelled: true,
          grossAmount: true,
        },
      });
      assert.deepEqual(
        rows.map((r) => [
          r.documentNumber,
          r.source,
          r.kindCode,
          r.cancelled,
          r.grossAmount.toFixed(2),
        ]),
        [
          [`${NUMBER}F`, "SZAMLAZZ", "SZ", false, "127.00"],
          [`${NUMBER}N1`, "NAV", "SZ", true, "127.00"],
          [`${NUMBER}N3`, "NAV", "SS", false, "-127.00"],
          [`${NUMBER}N4`, "NAV", "SS", false, "-127.00"],
        ],
      );
      // the NAV rows count as present from now on, and the feed backfill does not ask Számlázz.hu for them again
      const present = await prismaNavOutboundPresent.present([
        `${NUMBER}N1`,
        `${NUMBER}N2`,
      ]);
      assert.deepEqual([...present.external], [`${NUMBER}N1`]);
    });

    it("--apply: a number stored in another spelling (case, spaces), external or own, is present: no NAV row beside it", async () => {
      await prisma.externalBillingDocument.create({
        data: {
          source: "SZAMLAZZ",
          externalId: `${PREFIX}k`,
          feedMessageId: "x",
          feedReceivedAt: new Date(),
          kindCode: "SZ",
          documentNumber: `${NUMBER}k 1`,
          electronic: true,
          issueDate: new Date("2026-05-04T00:00:00Z"),
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
      await prisma.invoice.create({
        data: {
          direction: "OUTBOUND",
          source: "SZAMLAZZ",
          partnerName: "Teszt Vevő Kft.",
          invoiceNumber: `${NUMBER}k 2`,
        },
      });
      const client = {
        queryInvoiceDigest: async () => ({
          currentPage: 1,
          availablePage: 1,
          items: [navItem(`${NUMBER}K1`), navItem(`${NUMBER}K2`)],
        }),
      } as never;
      const credentials = {
        resolve: async () => ({ technicalUser: {}, software: {} }),
      } as never;
      const [result] = await new NavOutboundBackfill(
        client,
        credentials,
        prismaNavOutboundPresent,
        prismaNavOutboundWriter,
        async () => undefined,
      ).run({
        from: new Date("2026-05-01T00:00:00Z"),
        to: new Date("2026-05-10T00:00:00Z"),
        apply: true,
      });
      assert.deepEqual(
        [
          result!.presentExternal,
          result!.presentOwn,
          result!.missing,
          result!.created,
        ],
        [1, 1, 0, 0],
      );
      assert.equal(
        await prisma.externalBillingDocument.count({
          where: {
            source: "NAV",
            externalId: { in: [`${NUMBER}K1`, `${NUMBER}K2`] },
          },
        }),
        0,
      );
    });

    it("NAV first: Számlázz.hu takes the NAV row over, the same row, and its PDF reason goes", async () => {
      await prismaNavOutboundWriter.write([navItem(`${NUMBER}D`)]);
      const [navRow] = await rowsOf(`${NUMBER}D`);
      assert.equal(navRow!.source, "NAV");
      assert.equal(await szamlazz(`${PREFIX}d`, `${NUMBER}D`), "PROJECTED");
      // the feed again (a resend): still the one row below
      await szamlazz(`${PREFIX}d`, `${NUMBER}D`);
      const rows = await prisma.externalBillingDocument.findMany({
        where: { documentNumber: `${NUMBER}D` },
        select: {
          id: true,
          source: true,
          externalId: true,
          pdfMissingReason: true,
          paymentsKnown: true,
          feedMessageId: true,
        },
      });
      assert.deepEqual(rows, [
        {
          id: navRow!.id,
          source: "SZAMLAZZ",
          externalId: `${PREFIX}d`,
          pdfMissingReason: null,
          paymentsKnown: true,
          feedMessageId: rows[0]!.feedMessageId,
        },
      ]);
      assert.doesNotMatch(rows[0]!.feedMessageId, /^NAV:/);
    });

    it("NAV first: eBIZ takes the NAV row over, the same row, and the next eBIZ run adds none", async () => {
      await prismaNavOutboundWriter.write([navItem(`${NUMBER}E`)]);
      const [navRow] = await rowsOf(`${NUMBER}E`);
      const sync = ebiz([item(990005, `${NUMBER}E`)]);
      await sync();
      await sync();
      const rows = await rowsOf(`${NUMBER}E`);
      assert.deepEqual(
        rows.map((r) => [r.id, r.source, r.externalId, r.pdfStorageKey]),
        [
          [
            navRow!.id,
            "EBIZ",
            "990005",
            `external-invoices/${navRow!.id}/ebiz.pdf`,
          ],
        ],
      );
    });

    it("the feed backfill counts a NAV row as stored", async () => {
      await prismaNavOutboundWriter.write([navItem(`${NUMBER}2026/00077`)]);
      const stored = await prismaFeedBackfillStore.storedNumbers(2026);
      assert.ok(
        stored.some((row) => row.documentNumber === `${NUMBER}2026/00077`),
      );
    });

    it("a NAV row without a PDF is a candidate of the cmfx letter fill, with its gross", async () => {
      await prismaNavOutboundWriter.write([
        navItem(`${NUMBER}M1`, { invoiceIssueDate: "2026-03-10" }),
      ]);
      const candidates = (await mailPdfCandidates("2026-03")).filter((row) =>
        row.documentNumber.startsWith(NUMBER),
      );
      assert.deepEqual(
        candidates.map((row) => [row.documentNumber, row.grossAmount]),
        [[`${NUMBER}M1`, "127"]],
      );
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
