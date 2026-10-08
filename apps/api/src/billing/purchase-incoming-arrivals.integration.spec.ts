import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { Prisma, prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { InvoiceCollectionRepository } from "../missing-invoices/collection/invoice-collection.repository.js";
import { SzamlazzFeedsRepository } from "../missing-invoices/szamlazz-feeds.repository.js";
import { incomingKey } from "./billing-duplicates.js";
import { IncomingReviewService } from "./foreign-invoice/incoming-review.service.js";
import {
  incomingListItems,
  loadPurchaseSubjects,
  lockIncomingKey,
} from "./purchase-incoming.js";

/**
 * A BESZERZÉSBŐL JÖTT SZÁMLA KÉSŐBB ÉRKEZŐ PÉLDÁNYAI (kártya 83f31a95, PR 2),
 * a valódi adatbázison. Kitalált beszállító, számok és összegek.
 */
const gate = integrationDatabaseGate(process.env);
const D = (value: string | number) => new Prisma.Decimal(value);

describe(
  "a beszerzésből jött számla később érkező példányai",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = randomUUID().slice(0, 8);
    const tax = `8${suffix.replace(/\D/g, "").padEnd(7, "2").slice(0, 7)}-2-41`;
    const invoiceIds: string[] = [];
    const feedIds: string[] = [];
    let supplierId = "";
    let warehouseId = "";
    let userId = "";
    const reviews = new IncomingReviewService({
      documentPairings: async () => new Map(),
    } as never);

    async function purchase(number: string) {
      const invoice = await prisma.purchaseInvoice.create({
        data: {
          documentNumber: `PA-${suffix}-${number}`,
          supplierInvoiceNumber: `${number}-${suffix}`,
          source: "HU_MANUAL",
          status: "POSTED",
          supplierId,
          warehouseId,
          invoiceDate: new Date("2026-10-01T00:00:00Z"),
          vatRate: D(27),
          lines: {
            create: [
              {
                orderedQuantity: D(1),
                actualQuantity: D(1),
                unit: "db",
                unitNet: D(1000),
                sourceDescription: "kitalált tétel",
              },
            ],
          },
          scanDocuments: {
            create: {
              gmailMessageId: `upload:${suffix}:${number}`,
              fileName: `${number}.pdf`,
              sizeBytes: 9,
              sha256: `${suffix}-${number}`,
              content: new Uint8Array(Buffer.from("%PDF-1.4 ")),
              status: "FAILED",
              kind: "INVOICE",
              origin: "UPLOAD",
              uploadKind: "INVOICE",
            },
          },
        },
        select: { id: true, supplierInvoiceNumber: true },
      });
      invoiceIds.push(invoice.id);
      return invoice;
    }

    async function feed(documentNumber: string, tag: string) {
      const externalId = `pa-${suffix}-${tag}`;
      feedIds.push(externalId);
      const repository = new SzamlazzFeedsRepository();
      await repository.storeRaw({
        kind: "SZAMLABE",
        externalId,
        sha256: `${suffix}-${tag}`,
        body: "<szamlabe/>",
      });
      return repository.projectIncoming({
        externalId,
        sha256: `${suffix}-${tag}`,
        projection: {
          externalId,
          kindCode: "SZ",
          documentNumber,
          electronic: true,
          issueDate: "2026-10-01",
          fulfillmentDate: null,
          dueDate: null,
          paymentMethod: null,
          currency: "HUF",
          exchangeRate: null,
          exchangeBank: null,
          supplierName: "Kitalált név a feedben",
          supplierTaxNumber: tax,
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
    }

    /**
     * Fogja a számla zárját, amíg a `release` nem hívódik; addig a többi író
     * vár. A `beforeRelease` a zárat tartó tranzakcióban fut, közvetlenül a
     * véglegesítés előtt: így írható egy sor, amit a várakozó a zár után lát.
     */
    async function holdLock(
      documentNumber: string,
      beforeRelease?: (tx: Prisma.TransactionClient) => Promise<unknown>,
    ) {
      let release!: () => void;
      const released = new Promise<void>((resolve) => (release = resolve));
      let held!: () => void;
      const isHeld = new Promise<void>((resolve) => (held = resolve));
      const holder = prisma.$transaction(
        async (tx) => {
          await lockIncomingKey(tx, {
            documentNumber,
            supplierTaxNumber: tax,
            supplierEuTaxNumber: null,
            supplierName: "",
          });
          held();
          await released;
          await beforeRelease?.(tx);
        },
        { timeout: 30_000 },
      );
      await isHeld;
      return async () => {
        release();
        await holder;
      };
    }

    /**
     * Vár-e valaki a számla zárjára: a `pg_locks` nem megadott tanácsadó zára
     * pontosan ezen a kulcson (a 64 bites kulcs két 32 bites fele). Nem alvás,
     * tehát nem függ a futó gép sebességétől; 10 másodperc után feladja.
     */
    async function someoneWaits(documentNumber: string): Promise<boolean> {
      const name = `incoming-key:${incomingKey(documentNumber, tax, "")}`;
      for (let i = 0; i < 200; i += 1) {
        const [row] = await prisma.$queryRaw<{ waiting: bigint }[]>`
          SELECT count(*) AS waiting FROM pg_locks
          WHERE locktype = 'advisory' AND NOT granted
            AND classid::bigint = (hashtextextended(${name}, 0) >> 32) & 4294967295
            AND objid::bigint = hashtextextended(${name}, 0) & 4294967295`;
        if (row && row.waiting > 0n) return true;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return false;
    }

    /** Vár-e a művelet a zárra, és a zár elengedése után végez-e. */
    async function waitsForLock(
      documentNumber: string,
      run: () => Promise<unknown>,
    ) {
      const release = await holdLock(documentNumber);
      const running = run();
      const waited = await someoneWaits(documentNumber);
      await release();
      await running;
      return waited;
    }

    const collected = (externalId: string, invoiceNumber: string) =>
      new InvoiceCollectionRepository().store({
        source: "INFO_MAIL",
        externalId: `${suffix}-${externalId}`,
        fileName: `${externalId}.pdf`,
        sender: "szamla@example.test",
        subject: "Számla",
        receivedAt: new Date(),
        content: Buffer.from(`%PDF-1.4 ${externalId}`),
        sha256: `${suffix}-mail-${externalId}`,
        read: false,
        kind: "INVOICE",
        importResult: null,
        textReading: {
          invoiceNumber,
          numberFrom: "LABEL",
          supplierTaxNumber: tax,
        },
        payee: "COMPANY",
      });

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      supplierId = (
        await prisma.supplier.create({
          data: {
            code: `PA-${suffix}`,
            name: `Kitalált Érkező ${suffix} Kft.`,
            taxNumber: tax,
          },
        })
      ).id;
      warehouseId = (
        await prisma.warehouse.create({
          data: { code: `PA-${suffix}`, name: "Kitalált raktár" },
        })
      ).id;
      userId = (
        await prisma.user.create({
          data: {
            email: `purchase-arrivals-${suffix}@example.test`,
            displayName: "Purchase arrivals test",
            role: "ADMIN",
          },
        })
      ).id;
    });

    it("a copy collected from the mailbox links to the purchase, which stays one row", async () => {
      const invoice = await purchase("M");
      const linked = await collected("same", invoice.supplierInvoiceNumber);
      const other = await collected("other", `MASIK-${suffix}`);
      const documents = await prisma.incomingSupplierDocument.findMany({
        where: { id: { in: [linked, other] } },
        select: { id: true, purchaseInvoiceId: true },
      });
      const subject = (await loadPurchaseSubjects(prisma, invoice.id))[0];
      const known = await new InvoiceCollectionRepository().knownNumbers();
      assert.deepEqual(
        [
          documents.find((d) => d.id === linked)?.purchaseInvoiceId,
          documents.find((d) => d.id === other)?.purchaseInvoiceId,
          subject?.scanIds.length,
          known.some((k) => k.number === invoice.supplierInvoiceNumber),
        ],
        [invoice.id, null, 2, true],
        "ARRIVAL-LINKED",
      );
    });

    it("a Számlázz.hu row after an approved PURCHASE row replaces it: one row for the invoice", async () => {
      const invoice = await purchase("F");
      await reviews.approve(`purchase:${invoice.id}`, null, userId);
      const outcome = await feed(invoice.supplierInvoiceNumber, "feed");
      const rows = await prisma.incomingBillingDocument.findMany({
        where: { documentNumber: invoice.supplierInvoiceNumber },
        select: { source: true },
      });
      const reading = await prisma.incomingDocumentReading.findFirst({
        where: { document: { purchaseInvoiceId: invoice.id } },
        select: { state: true, incomingBillingDocumentId: true },
      });
      assert.deepEqual(
        [outcome, rows.map((r) => r.source), reading],
        [
          "PROJECTED",
          ["SZAMLAZZ"],
          { state: "VERIFIED", incomingBillingDocumentId: null },
        ],
        "FEED-SUPERSEDES-PURCHASE",
      );
    });

    /**
     * A verseny: a jóváhagyás a zárra vár, a zártartó közben beír egy
     * Számlázz.hu sort a megadott (tárolt) számmal, és véglegesít.
     */
    async function approvalRacingFeedRow(
      invoice: { id: string; supplierInvoiceNumber: string },
      storedNumber: string,
      tag: string,
    ) {
      const externalId = `pa-${suffix}-${tag}`;
      feedIds.push(externalId);
      // the feed's write, inside the lock the approval is waiting for
      const release = await holdLock(invoice.supplierInvoiceNumber, (tx) =>
        tx.incomingBillingDocument.create({
          data: {
            source: "SZAMLAZZ",
            externalId,
            feedMessageId: externalId,
            feedReceivedAt: new Date(),
            kindCode: "SZ",
            documentNumber: storedNumber,
            electronic: true,
            issueDate: new Date("2026-10-01T00:00:00Z"),
            currency: "HUF",
            supplierName: "Kitalált név a feedben",
            supplierTaxNumber: tax,
            buyerName: "Acropora Kft.",
            netAmount: D(1000),
            vatAmount: D(270),
            grossAmount: D(1270),
            lines: [],
            vatSummary: [],
            payments: [],
            paymentsKnown: false,
            paidAmount: D(0),
          },
        }),
      );
      const approving = reviews
        .approve(`purchase:${invoice.id}`, null, userId)
        .then(
          () => null,
          (error: unknown) => (error as { status?: number }).status,
        );
      const waited = await someoneWaits(invoice.supplierInvoiceNumber);
      await release();
      const refused = await approving;
      const rows = await prisma.incomingBillingDocument.findMany({
        where: {
          documentNumber: { in: [invoice.supplierInvoiceNumber, storedNumber] },
        },
        select: { source: true },
      });
      return [waited, refused, rows.map((r) => r.source)];
    }

    it("a Számlázz.hu row committed while the approval waits for the lock: 409, no PURCHASE row", async () => {
      const invoice = await purchase("E");
      assert.deepEqual(
        await approvalRacingFeedRow(
          invoice,
          invoice.supplierInvoiceNumber,
          "race",
        ),
        [true, 409, ["SZAMLAZZ"]],
        "FEED-FIRST-409",
      );
    });

    it("the same, with the Számlázz.hu number stored with a space the recorded one lacks: still 409", async () => {
      const invoice = await purchase("S9");
      assert.deepEqual(
        await approvalRacingFeedRow(
          invoice,
          invoice.supplierInvoiceNumber.replace(/^S9/, "S 9"),
          "race-ws",
        ),
        [true, 409, ["SZAMLAZZ"]],
        "WS-409",
      );
    });

    it("a copy whose number differs only by a space links to the purchase", async () => {
      const invoice = await purchase("W 7");
      const linked = await collected(
        "ws",
        invoice.supplierInvoiceNumber.replace(/\s/g, ""),
      );
      const document = await prisma.incomingSupplierDocument.findUniqueOrThrow({
        where: { id: linked },
        select: { purchaseInvoiceId: true },
      });
      assert.equal(document.purchaseInvoiceId, invoice.id, "WS-ARRIVAL");
    });

    it("the approval waits for the invoice's lock", async () => {
      const invoice = await purchase("LA");
      const waited = await waitsForLock(invoice.supplierInvoiceNumber, () =>
        reviews.approve(`purchase:${invoice.id}`, null, userId),
      );
      const rows = await prisma.incomingBillingDocument.findMany({
        where: { documentNumber: invoice.supplierInvoiceNumber },
        select: { source: true },
      });
      assert.deepEqual(
        [waited, rows.map((r) => r.source)],
        [true, ["PURCHASE"]],
        "LOCK-APPROVAL",
      );
    });

    it("the feed write waits for the same lock", async () => {
      const invoice = await purchase("LF");
      const waited = await waitsForLock(invoice.supplierInvoiceNumber, () =>
        feed(invoice.supplierInvoiceNumber, "locked"),
      );
      const rows = await prisma.incomingBillingDocument.findMany({
        where: { documentNumber: invoice.supplierInvoiceNumber },
        select: { source: true },
      });
      assert.deepEqual(
        [waited, rows.map((r) => r.source)],
        [true, ["SZAMLAZZ"]],
        "LOCK-FEED",
      );
    });

    it("an approved purchase whose scan is paired and paid is one row on the list", async () => {
      const invoice = await purchase("P");
      await reviews.approve(`purchase:${invoice.id}`, null, userId);
      const scan = await prisma.incomingSupplierDocument.findFirstOrThrow({
        where: { purchaseInvoiceId: invoice.id },
        select: { id: true },
      });
      const pairings = new Map([
        [
          scan.id,
          {
            payee: "COMPANY" as const,
            kind: "INVOICE" as const,
            debits: [
              { bookingDate: "2026-10-02", amount: "1270", currency: "HUF" },
            ],
            paidInFull: true,
            document: {
              id: scan.id,
              source: "UPLOAD" as const,
              number: invoice.supplierInvoiceNumber,
              date: "2026-10-01",
              gross: D(1270),
              currency: "HUF",
              supplierName: `Kitalált Érkező ${suffix} Kft.`,
              supplierAccounts: [],
              kind: "INVOICE" as const,
              payee: "COMPANY" as const,
              hasOriginal: true,
            },
          },
        ],
      ]);
      const items = incomingListItems({
        rows: await prisma.incomingBillingDocument.findMany({
          where: { documentNumber: invoice.supplierInvoiceNumber },
        }),
        pairings,
        hasCollectedPdf: () => false,
        readings: new Map(),
        purchases: await loadPurchaseSubjects(prisma, invoice.id),
      });
      assert.deepEqual(
        items.map((item) => item.origin),
        ["PURCHASE"],
        "APPROVED-PAIRED-ONE-ROW",
      );
    });

    after(async () => {
      if (gate.mode !== "run") return;
      const documents = (
        await prisma.incomingSupplierDocument.findMany({
          where: {
            OR: [
              { purchaseInvoiceId: { in: invoiceIds } },
              { sha256: { startsWith: `${suffix}-` } },
            ],
          },
          select: { id: true },
        })
      ).map((d) => d.id);
      await prisma.incomingDocumentReading.deleteMany({
        where: { documentId: { in: documents } },
      });
      await prisma.incomingBillingDocument.deleteMany({
        where: {
          OR: [
            { source: "PURCHASE", externalId: { in: invoiceIds } },
            { externalId: { in: feedIds } },
          ],
        },
      });
      await prisma.szamlazzFeedMessage.deleteMany({
        where: { externalId: { in: feedIds } },
      });
      await prisma.invoiceCollectionItem.deleteMany({
        where: { externalId: { startsWith: `${suffix}-` } },
      });
      await prisma.incomingSupplierDocument.deleteMany({
        where: { id: { in: documents } },
      });
      await prisma.purchaseInvoiceLine.deleteMany({
        where: { purchaseInvoiceId: { in: invoiceIds } },
      });
      await prisma.purchaseInvoice.deleteMany({
        where: { id: { in: invoiceIds } },
      });
      await prisma.auditLog.deleteMany({ where: { userId } });
      await prisma.auditLog.deleteMany({
        where: {
          action: "billing.incoming-purchase.superseded",
          entityType: "IncomingBillingDocument",
          metadata: {
            path: ["feedExternalId"],
            string_starts_with: `pa-${suffix}`,
          },
        },
      });
      await prisma.supplier.deleteMany({ where: { id: supplierId } });
      await prisma.warehouse.deleteMany({ where: { id: warehouseId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    });
  },
);
