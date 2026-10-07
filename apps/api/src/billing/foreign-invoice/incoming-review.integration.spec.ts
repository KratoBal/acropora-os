import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Prisma, prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import { SzamlazzFeedsRepository } from "../../missing-invoices/szamlazz-feeds.repository.js";

/**
 * A KÜLFÖLDI SZÁMLA ADATA A VALÓDI ADATBÁZISON (kártya e4c3b0fb). Kitalált
 * azonosítók és számok.
 *
 * MI PIROSÍT: ha a migráció CHECK-je hiányozna, és egy „Ellenőrzött” olvasat
 * hiányos számokkal is tárolható lenne; ha a Számlázz.hu vetítése (a
 * `billing:incoming-backfill` és az élő fogadó egyetlen írója) egy jóváhagyott
 * postafiókos sort felülírna, mert a kulcsa csak a külső azonosító lenne.
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "foreign-it-";

async function removeLeftovers() {
  await prisma.incomingDocumentReading.deleteMany({
    where: { documentId: { startsWith: PREFIX } },
  });
  await prisma.incomingBillingDocument.deleteMany({
    where: { externalId: { startsWith: PREFIX } },
  });
  await prisma.szamlazzFeedMessage.deleteMany({
    where: { externalId: { startsWith: PREFIX } },
  });
  await prisma.incomingSupplierDocument.deleteMany({
    where: { gmailMessageId: { startsWith: PREFIX } },
  });
}

const mailboxRow = (externalId: string) => ({
  source: "MAILBOX",
  externalId,
  feedMessageId: externalId,
  feedReceivedAt: new Date("2026-10-04T09:00:00Z"),
  kindCode: "SZ",
  documentNumber: "KIT-POSTAFIOK-1",
  electronic: false,
  issueDate: new Date("2026-10-03T00:00:00Z"),
  currency: "EUR",
  supplierName: "Kitalált Előfizetés Inc.",
  buyerName: "Acropora Kft.",
  netAmount: new Prisma.Decimal("81.30"),
  vatAmount: new Prisma.Decimal("0"),
  grossAmount: new Prisma.Decimal("81.30"),
  lines: [],
  vatSummary: [],
  payments: [],
  paymentsKnown: false,
  paidAmount: new Prisma.Decimal("0"),
  sourceDocumentId: externalId,
  hasPdf: true,
});

describe(
  "a külföldi számla adata az adatbázisban",
  { skip: gate.mode === "skip" },
  () => {
    let documentId = "";

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      ({ id: documentId } = await prisma.incomingSupplierDocument.create({
        data: {
          id: `${PREFIX}doc-1`,
          gmailMessageId: `${PREFIX}msg-1`,
          fileName: "invoice.pdf",
          sizeBytes: 9,
          sha256: `${PREFIX}sha-1`,
          content: new Uint8Array(Buffer.from("%PDF-1.4 ")),
          status: "FAILED",
          kind: "INVOICE",
        },
        select: { id: true },
      }));
    });

    after(async () => {
      await removeLeftovers();
      nincsMaradek([
        {
          nev: "az olvasat-sorok bent maradtak",
          darab: await prisma.incomingDocumentReading.count({
            where: { documentId: { startsWith: PREFIX } },
          }),
        },
        {
          nev: "a bejövő számla sorai bent maradtak",
          darab: await prisma.incomingBillingDocument.count({
            where: { externalId: { startsWith: PREFIX } },
          }),
        },
        {
          nev: "a postafiókos dokumentum bent maradt",
          darab: await prisma.incomingSupplierDocument.count({
            where: { gmailMessageId: { startsWith: PREFIX } },
          }),
        },
      ]);
    });

    it("a verified reading needs every required figure (the CHECK)", async () => {
      await assert.rejects(
        prisma.incomingDocumentReading.create({
          data: {
            documentId,
            state: "VERIFIED",
            supplierName: "Kitalált Előfizetés Inc.",
            documentNumber: "KIT-POSTAFIOK-1",
            issueDate: new Date("2026-10-03T00:00:00Z"),
            currency: "EUR",
            grossAmount: new Prisma.Decimal("81.30"),
            // nettó és ÁFA nélkül
            reviewedAt: new Date(),
            sources: {},
            warnings: [],
            hasText: true,
          },
        }),
        /IncomingDocumentReading_verified_complete/,
      );
      // ellenőrizetlenül a hiányos olvasat tárolható
      await prisma.incomingDocumentReading.create({
        data: { documentId, sources: {}, warnings: [], hasText: false },
      });
      await prisma.incomingDocumentReading.delete({ where: { documentId } });
    });

    it("the Számlázz.hu projection never touches a MAILBOX row with the same external id", async () => {
      const externalId = `${PREFIX}ugyanaz`;
      await prisma.incomingBillingDocument.create({
        data: mailboxRow(externalId),
      });
      const repository = new SzamlazzFeedsRepository();
      await repository.storeRaw({
        kind: "SZAMLABE",
        externalId,
        sha256: "egy",
        body: "<szamlabe/>",
      });
      const outcome = await repository.projectIncoming({
        externalId,
        sha256: "egy",
        projection: {
          externalId,
          kindCode: "SZ",
          documentNumber: "MASIK-SZAMLA",
          electronic: true,
          issueDate: "2026-09-28",
          fulfillmentDate: null,
          dueDate: null,
          paymentMethod: null,
          currency: "HUF",
          exchangeRate: null,
          exchangeBank: null,
          supplierName: "Kitalált Kft.",
          supplierTaxNumber: null,
          supplierEuTaxNumber: null,
          supplierAddress: null,
          supplierBankAccount: null,
          buyerName: "Acropora Kft.",
          buyerTaxNumber: null,
          netAmount: "1000",
          vatAmount: "270",
          grossAmount: "1270",
          lines: [],
          vatSummary: [],
          paymentsKnown: false,
          payments: [],
          note: null,
          orderNumber: null,
          referencedInvoiceNumber: null,
          referencedProformaNumber: null,
          cancelled: false,
        },
      });
      assert.equal(outcome, "PROJECTED");
      const rows = await prisma.incomingBillingDocument.findMany({
        where: { externalId },
        orderBy: { source: "asc" },
        select: { source: true, documentNumber: true, currency: true },
      });
      assert.deepEqual(rows, [
        {
          source: "MAILBOX",
          documentNumber: "KIT-POSTAFIOK-1",
          currency: "EUR",
        },
        { source: "SZAMLAZZ", documentNumber: "MASIK-SZAMLA", currency: "HUF" },
      ]);
    });
  },
);
