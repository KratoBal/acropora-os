import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { Prisma, prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { IncomingReviewService } from "./foreign-invoice/incoming-review.service.js";
import { loadPurchaseSubjects } from "./purchase-incoming.js";

/**
 * A RÖGZÍTETT BESZERZÉSI SZÁMLA A BEJÖVŐ SZÁMLÁK KÖZÖTT, a valódi adatbázison
 * (kártya 83f31a95). Kitalált beszállítók, számok és összegek.
 */
const gate = integrationDatabaseGate(process.env);
const D = (value: string | number) => new Prisma.Decimal(value);

describe(
  "a rögzített beszerzési számla mint bejövő számla",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = randomUUID().slice(0, 8);
    const tax = `9${suffix.replace(/\D/g, "").padEnd(7, "1").slice(0, 7)}-2-41`;
    const invoiceIds: string[] = [];
    const scanIds: string[] = [];
    let supplierId = "";
    let warehouseId = "";
    let userId = "";
    // a banki párosítás ezen a lapon nem kérdés: üres térkép
    const reviews = new IncomingReviewService({
      documentPairings: async () => new Map(),
    } as never);

    async function purchase(
      number: string,
      options: { scan?: boolean; vatRate?: number | null } = {},
    ) {
      const invoice = await prisma.purchaseInvoice.create({
        data: {
          documentNumber: `PI-${suffix}-${number}`,
          supplierInvoiceNumber: `${number}-${suffix}`,
          source: "HU_MANUAL",
          status: "POSTED",
          supplierId,
          warehouseId,
          invoiceDate: new Date("2026-10-01T00:00:00Z"),
          dueDate: new Date("2026-10-09T00:00:00Z"),
          vatRate: options.vatRate === null ? null : D(options.vatRate ?? 27),
          lines: {
            create: [
              {
                orderedQuantity: D(2),
                actualQuantity: D(2),
                unit: "db",
                unitNet: D(1000),
                sourceDescription: "kitalált tétel",
              },
            ],
          },
        },
        select: { id: true, supplierInvoiceNumber: true },
      });
      invoiceIds.push(invoice.id);
      if (options.scan !== false) {
        const scan = await prisma.incomingSupplierDocument.create({
          data: {
            gmailMessageId: `upload:${suffix}:${number}`,
            fileName: `${number}.pdf`,
            sizeBytes: 9,
            sha256: `${suffix}-${number}`,
            content: new Uint8Array(Buffer.from("%PDF-1.4 ")),
            status: "FAILED",
            kind: "INVOICE",
            origin: "UPLOAD",
            uploadKind: "INVOICE",
            purchaseInvoiceId: invoice.id,
          },
          select: { id: true },
        });
        scanIds.push(scan.id);
      }
      return invoice;
    }

    const listed = async (id: string) =>
      (await loadPurchaseSubjects(prisma, id))[0] ?? null;

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      supplierId = (
        await prisma.supplier.create({
          data: {
            code: `PI-IN-${suffix}`,
            name: `Kitalált Beszállító ${suffix} Kft.`,
            taxNumber: tax,
          },
        })
      ).id;
      warehouseId = (
        await prisma.warehouse.create({
          data: { code: `PI-IN-${suffix}`, name: "Kitalált raktár" },
        })
      ).id;
      userId = (
        await prisma.user.create({
          data: {
            email: `purchase-incoming-${suffix}@example.test`,
            displayName: "Purchase incoming test",
            role: "ADMIN",
          },
        })
      ).id;
    });

    it("an invoice nobody else knows is listed, filled from the recording, with its scan", async () => {
      const invoice = await purchase("A");
      const subject = await listed(invoice.id);
      const review = await reviews.review(`purchase:${invoice.id}`);
      assert.deepEqual(
        [
          subject?.scanIds.length,
          review.state,
          review.item.origin,
          review.item.hasPdf,
          [
            review.values.documentNumber,
            review.values.netAmount,
            review.values.vatAmount,
            review.values.grossAmount,
            review.values.supplierTaxNumber,
          ],
          review.sources.netAmount,
        ],
        [
          1,
          "TO_REVIEW",
          "PURCHASE",
          true,
          [invoice.supplierInvoiceNumber, "2000.00", "540.00", "2540.00", tax],
          "PURCHASE",
        ],
        "PURCHASE-LISTED",
      );
    });

    it("one known from Számlázz.hu or from NAV is not listed", async () => {
      const feed = await purchase("B");
      const nav = await purchase("C");
      await prisma.incomingBillingDocument.create({
        data: {
          source: "SZAMLAZZ",
          externalId: `pi-in-${suffix}-B`,
          feedMessageId: `pi-in-${suffix}-B`,
          feedReceivedAt: new Date(),
          kindCode: "SZ",
          documentNumber: feed.supplierInvoiceNumber,
          electronic: true,
          issueDate: new Date("2026-10-01T00:00:00Z"),
          currency: "HUF",
          supplierName: "Kitalált név a feedben",
          supplierTaxNumber: tax,
          buyerName: "Acropora Kft.",
          netAmount: D(2000),
          vatAmount: D(540),
          grossAmount: D(2540),
          lines: [],
          vatSummary: [],
          payments: [],
          paymentsKnown: false,
          paidAmount: D(0),
          hasPdf: false,
        },
      });
      await prisma.navIncomingInvoice.create({
        data: {
          navInvoiceNumber: nav.supplierInvoiceNumber,
          supplierTaxNumber: tax,
          supplierName: "Kitalált név a NAV-ban",
          invoiceIssueDate: new Date("2026-10-01T00:00:00Z"),
          insDate: new Date(),
        },
      });
      assert.deepEqual(
        [await listed(feed.id), await listed(nav.id)],
        [null, null],
        "PURCHASE-KNOWN-HIDDEN",
      );
    });

    it("an approval makes a PURCHASE row, and the item leaves the list", async () => {
      const invoice = await purchase("E");
      const approved = await reviews.approve(
        `purchase:${invoice.id}`,
        null,
        userId,
      );
      const row = await prisma.incomingBillingDocument.findUnique({
        where: {
          source_externalId: { source: "PURCHASE", externalId: invoice.id },
        },
      });
      const reopened = await reviews.review(`purchase:${invoice.id}`);
      assert.deepEqual(
        [
          approved.state,
          row?.grossAmount.toString(),
          row?.sourceDocumentId === scanIds.at(-1),
          await listed(invoice.id),
          reopened.state,
          reopened.item.origin,
        ],
        ["VERIFIED", "2540", true, null, "VERIFIED", "PURCHASE"],
        "PURCHASE-APPROVED",
      );
    });

    it("one without a scan is listed but cannot be approved", async () => {
      const invoice = await purchase("F", { scan: false });
      const refused = await reviews
        .approve(`purchase:${invoice.id}`, null, userId)
        .then(
          () => null,
          (error: Error) => error.constructor.name,
        );
      assert.deepEqual(
        [
          (await listed(invoice.id))?.scanIds.length,
          refused,
          await prisma.incomingBillingDocument.count({
            where: { source: "PURCHASE", externalId: invoice.id },
          }),
        ],
        [0, "ConflictException", 0],
        "PURCHASE-NO-SCAN-409",
      );
    });

    it("known from Számlázz.hu, NAV or a mailbox reading with a space the recording lacks: not listed; an unknown one is", async () => {
      const feed = await purchase("D9");
      const nav = await purchase("E9");
      const mail = await purchase("F9");
      const free = await purchase("G9");
      const spaced = (number: string) => number.replace(/^(\w)9/, "$1 9");
      await prisma.incomingBillingDocument.create({
        data: {
          source: "SZAMLAZZ",
          externalId: `pi-in-${suffix}-D9`,
          feedMessageId: `pi-in-${suffix}-D9`,
          feedReceivedAt: new Date(),
          kindCode: "SZ",
          documentNumber: spaced(feed.supplierInvoiceNumber),
          electronic: true,
          issueDate: new Date("2026-10-01T00:00:00Z"),
          currency: "HUF",
          supplierName: "Kitalált név a feedben",
          supplierTaxNumber: tax,
          buyerName: "Acropora Kft.",
          netAmount: D(2000),
          vatAmount: D(540),
          grossAmount: D(2540),
          lines: [],
          vatSummary: [],
          payments: [],
          paymentsKnown: false,
          paidAmount: D(0),
          hasPdf: false,
        },
      });
      await prisma.navIncomingInvoice.create({
        data: {
          navInvoiceNumber: spaced(nav.supplierInvoiceNumber),
          supplierTaxNumber: tax,
          supplierName: "Kitalált név a NAV-ban",
          invoiceIssueDate: new Date("2026-10-01T00:00:00Z"),
          insDate: new Date(),
        },
      });
      const document = await prisma.incomingSupplierDocument.create({
        data: {
          gmailMessageId: `mail:${suffix}:F9`,
          fileName: "F9.pdf",
          sizeBytes: 9,
          sha256: `${suffix}-mail-F9`,
          content: new Uint8Array(Buffer.from("%PDF-1.4 ")),
          status: "FAILED",
          kind: "INVOICE",
          origin: "MAILBOX",
          textReading: {
            invoiceNumber: spaced(mail.supplierInvoiceNumber),
            supplierTaxNumber: tax,
          },
        },
        select: { id: true },
      });
      scanIds.push(document.id);
      assert.deepEqual(
        [
          await listed(feed.id),
          await listed(nav.id),
          await listed(mail.id),
          (await listed(free.id))?.purchaseInvoiceId,
        ],
        [null, null, null, free.id],
        "SUBJECTS-NARROW-WS",
      );
    });

    after(async () => {
      if (gate.mode !== "run") return;
      await prisma.incomingDocumentReading.deleteMany({
        where: { documentId: { in: scanIds } },
      });
      await prisma.incomingBillingDocument.deleteMany({
        where: {
          OR: [
            { source: "PURCHASE", externalId: { in: invoiceIds } },
            { externalId: { startsWith: `pi-in-${suffix}` } },
          ],
        },
      });
      await prisma.navIncomingInvoice.deleteMany({
        where: { supplierTaxNumber: tax },
      });
      await prisma.incomingSupplierDocument.deleteMany({
        where: { id: { in: scanIds } },
      });
      await prisma.purchaseInvoiceLine.deleteMany({
        where: { purchaseInvoiceId: { in: invoiceIds } },
      });
      await prisma.purchaseInvoice.deleteMany({
        where: { id: { in: invoiceIds } },
      });
      await prisma.auditLog.deleteMany({ where: { userId } });
      await prisma.supplier.deleteMany({ where: { id: supplierId } });
      await prisma.warehouse.deleteMany({ where: { id: warehouseId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    });
  },
);
