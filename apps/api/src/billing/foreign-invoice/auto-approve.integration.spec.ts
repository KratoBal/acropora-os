import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Prisma, prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import type { DocumentPairing } from "../../missing-invoices/missing-invoices.service.js";
import { IncomingReviewService } from "./incoming-review.service.js";

/**
 * AZ AUTOMATIKUS JÓVÁHAGYÁS ÍRÁSA A VALÓDI ADATBÁZISON (acrobot 34633, 34636).
 * Kitalált azonosítók és számok. A banki párosítás a teszt adja (a valódit a
 * `incoming-bank-pairing.integration.spec.ts` méri); itt az a kérdés, mit ír
 * a jóváhagyás: ugyanazt a sort és ugyanazt az Ellenőrzött olvasatot, mint a
 * kézi, szerző nélkül, és a napló mondja meg az alapot.
 *
 * MI PIROSÍT: ha a száraz futás ír; ha a jóváhagyott olvasat a CHECK-en elbukik
 * (egy NAV-ból töltött mező nem kerül az oszlopba); ha a napló nem mondja meg az
 * alapot; ha egy kihagyandó sor jóváhagyódik.
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "auto-approve-it-";
const NAV_NUMBER = `${PREFIX}HU-1`;

async function removeLeftovers() {
  const rows = await prisma.incomingBillingDocument.findMany({
    where: { externalId: { startsWith: PREFIX } },
    select: { id: true },
  });
  await prisma.auditLog.deleteMany({
    where: { entityId: { in: rows.map((row) => row.id) } },
  });
  await prisma.incomingDocumentReading.deleteMany({
    where: { documentId: { startsWith: PREFIX } },
  });
  await prisma.incomingBillingDocument.deleteMany({
    where: { externalId: { startsWith: PREFIX } },
  });
  await prisma.incomingSupplierDocument.deleteMany({
    where: { id: { startsWith: PREFIX } },
  });
  await prisma.navIncomingInvoice.deleteMany({
    where: { navInvoiceNumber: NAV_NUMBER },
  });
}

const document = (id: string, number: string, gross: string) =>
  ({
    id,
    source: "MAILBOX",
    number,
    date: "2026-09-19",
    gross: new Prisma.Decimal(gross),
    currency: "HUF",
    supplierName: "Kitalált",
    supplierAccounts: [],
    kind: "INVOICE",
    payee: "COMPANY",
    hasOriginal: true,
  }) as DocumentPairing["document"];

const pairing = (
  id: string,
  number: string,
  gross: string,
  debit: string,
): DocumentPairing => ({
  payee: "COMPANY",
  kind: "INVOICE",
  paidInFull: true,
  debits: [{ bookingDate: "2026-09-22", amount: `-${debit}`, currency: "HUF" }],
  document: document(id, number, gross),
});

describe(
  "az automatikus jóváhagyás az adatbázisban",
  { skip: gate.mode === "skip" },
  () => {
    const foreign = `${PREFIX}foreign`;
    const hungarian = `${PREFIX}hungarian`;
    const mismatch = `${PREFIX}mismatch`;
    const pairings = new Map<string, DocumentPairing>([
      [foreign, pairing(foreign, `${PREFIX}F-6`, "15900", "15900")],
      [hungarian, pairing(hungarian, NAV_NUMBER, "127000", "127000")],
      [mismatch, pairing(mismatch, `${PREFIX}F-7`, "15900", "15800")],
    ]);
    const reviews = new IncomingReviewService({
      documentPairings: async () => pairings,
    } as never);

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      for (const id of [foreign, hungarian, mismatch])
        await prisma.incomingSupplierDocument.create({
          data: {
            id,
            gmailMessageId: id,
            fileName: "invoice.pdf",
            sizeBytes: 9,
            sha256: id,
            content: new Uint8Array(Buffer.from("%PDF-1.4 ")),
            status: "FAILED",
            kind: "INVOICE",
            origin: "COLLECTED_MAIL",
          },
        });
      const complete = {
        supplierName: "Kitalált Előfizetés Ltd.",
        supplierEuTaxNumber: "IE9999999XX",
        issueDate: new Date("2026-09-19T00:00:00Z"),
        currency: "HUF",
        netAmount: new Prisma.Decimal("15900"),
        vatAmount: new Prisma.Decimal("0"),
        grossAmount: new Prisma.Decimal("15900"),
        sources: { grossAmount: "TEXT" },
        warnings: [],
        hasText: true,
      };
      await prisma.incomingDocumentReading.create({
        data: {
          documentId: foreign,
          documentNumber: `${PREFIX}F-6`,
          ...complete,
        },
      });
      await prisma.incomingDocumentReading.create({
        data: {
          documentId: mismatch,
          documentNumber: `${PREFIX}F-7`,
          ...complete,
        },
      });
      // a Hungarian reading with the number and tax number only; the NAV has the rest
      await prisma.incomingDocumentReading.create({
        data: {
          documentId: hungarian,
          documentNumber: NAV_NUMBER,
          supplierTaxNumber: "88776655-2-13",
          sources: { documentNumber: "TEXT", supplierTaxNumber: "TEXT" },
          warnings: [],
          hasText: true,
        },
      });
      await prisma.navIncomingInvoice.create({
        data: {
          navInvoiceNumber: NAV_NUMBER,
          supplierTaxNumber: "88776655",
          supplierName: "Kitalált Magyar Kft.",
          invoiceIssueDate: new Date("2026-09-18T00:00:00Z"),
          currency: "HUF",
          invoiceNetAmount: 100000,
          invoiceVatAmount: 27000,
          insDate: new Date("2026-09-18T10:00:00Z"),
        },
      });
    });

    after(removeLeftovers);

    it("dry: reports the two approvable rows and the reason of the third, writes nothing", async () => {
      const report = await reviews.autoApprovePending({ apply: false });
      const mine = report.rows.filter((row) =>
        row.documentId.startsWith(PREFIX),
      );
      assert.deepEqual(
        mine
          .map((row) => [row.documentId, row.basis, row.reason, row.written])
          .sort(),
        [
          [foreign, "BANK", null, false],
          [hungarian, "NAV", null, false],
          [
            mismatch,
            null,
            "a terhelés (15800.00 HUF) nem egyezik a bruttóval (15900.00 HUF)",
            false,
          ],
        ].sort(),
      );
      assert.equal(
        await prisma.incomingBillingDocument.count({
          where: { externalId: { startsWith: PREFIX } },
        }),
        0,
      );
    });

    it("apply: the same row and VERIFIED reading as a manual approval, no author, the basis in the log", async () => {
      await reviews.autoApprovePending({ apply: true });
      const readings = await prisma.incomingDocumentReading.findMany({
        where: { documentId: { startsWith: PREFIX } },
        orderBy: { documentId: "asc" },
      });
      assert.deepEqual(
        readings.map((r) => [r.documentId, r.state, r.reviewedByUserId]),
        [
          [foreign, "VERIFIED", null],
          [hungarian, "VERIFIED", null],
          [mismatch, "TO_REVIEW", null],
        ],
      );
      const hu = readings.find((r) => r.documentId === hungarian)!;
      assert.deepEqual(
        [
          hu.supplierName,
          hu.netAmount?.toFixed(2),
          hu.vatAmount?.toFixed(2),
          hu.grossAmount?.toFixed(2),
        ],
        ["Kitalált Magyar Kft.", "100000.00", "27000.00", "127000.00"],
      );
      assert.equal((hu.sources as Record<string, string>).netAmount, "NAV");
      const rows = await prisma.incomingBillingDocument.findMany({
        where: { externalId: { startsWith: PREFIX } },
        select: { id: true, externalId: true, source: true, grossAmount: true },
      });
      assert.deepEqual(
        rows
          .map((row) => [
            row.externalId,
            row.source,
            row.grossAmount.toFixed(2),
          ])
          .sort(),
        [
          [foreign, "MAILBOX", "15900.00"],
          [hungarian, "MAILBOX", "127000.00"],
        ],
      );
      const logs = await prisma.auditLog.findMany({
        where: { entityId: { in: rows.map((row) => row.id) } },
        select: { action: true, userId: true, metadata: true },
      });
      assert.deepEqual(
        logs
          .map((log) => [
            log.action,
            log.userId,
            (log.metadata as { basis: string }).basis,
          ])
          .sort(),
        [
          ["billing.incoming-reading.auto-approved", null, "BANK"],
          ["billing.incoming-reading.auto-approved", null, "NAV"],
        ],
      );
      // once approved, a second run has nothing left to do for them
      const again = await reviews.autoApprovePending({ apply: true });
      assert.equal(
        again.rows.filter(
          (row) => row.written && row.documentId.startsWith(PREFIX),
        ).length,
        0,
      );
    });

    it("a reading a person changes after it was read is not written over (barracuda #1790)", async () => {
      const stale = `${PREFIX}stale`;
      await prisma.incomingSupplierDocument.create({
        data: {
          id: stale,
          gmailMessageId: stale,
          fileName: "invoice.pdf",
          sizeBytes: 9,
          sha256: stale,
          content: new Uint8Array(Buffer.from("%PDF-1.4 ")),
          status: "FAILED",
          kind: "INVOICE",
          origin: "COLLECTED_MAIL",
        },
      });
      await prisma.incomingDocumentReading.create({
        data: {
          documentId: stale,
          documentNumber: `${PREFIX}F-8`,
          supplierName: "Kitalált Előfizetés Ltd.",
          supplierEuTaxNumber: "IE9999999XX",
          issueDate: new Date("2026-09-19T00:00:00Z"),
          currency: "HUF",
          netAmount: new Prisma.Decimal("15900"),
          vatAmount: new Prisma.Decimal("0"),
          grossAmount: new Prisma.Decimal("15900"),
          sources: { grossAmount: "TEXT" },
          warnings: [],
          hasText: true,
        },
      });
      pairings.set(stale, pairing(stale, `${PREFIX}F-8`, "15900", "15900"));
      // the readings are read, and right after that a person corrects this one on the review page
      const human = "Ember javította Kft.";
      const readings = new Proxy(prisma.incomingDocumentReading, {
        get(model, property) {
          if (property === "findMany")
            return async (args: Prisma.IncomingDocumentReadingFindManyArgs) => {
              const rows = await model.findMany(args);
              await prisma.incomingDocumentReading.update({
                where: { documentId: stale },
                data: { supplierName: human },
              });
              return rows;
            };
          const value = Reflect.get(model, property) as unknown;
          return typeof value === "function" ? value.bind(model) : value;
        },
      });
      const database = new Proxy(prisma, {
        get(client, property) {
          if (property === "incomingDocumentReading") return readings;
          const value = Reflect.get(client, property) as unknown;
          return typeof value === "function" ? value.bind(client) : value;
        },
      });
      const racing = new IncomingReviewService({
        documentPairings: async () => pairings,
      } as never);
      Object.assign(racing, { database });
      const report = await racing.autoApprovePending({ apply: true });
      const row = report.rows.find((r) => r.documentId === stale);
      assert.deepEqual(
        [row?.written, row?.reason],
        [
          false,
          "az olvasat közben megváltozott (szerkesztették vagy jóváhagyták): kimarad",
        ],
      );
      const after = await prisma.incomingDocumentReading.findUniqueOrThrow({
        where: { documentId: stale },
      });
      assert.deepEqual([after.state, after.supplierName], ["TO_REVIEW", human]);
      assert.equal(
        await prisma.incomingBillingDocument.count({
          where: { externalId: stale },
        }),
        0,
      );
    });
  },
);
