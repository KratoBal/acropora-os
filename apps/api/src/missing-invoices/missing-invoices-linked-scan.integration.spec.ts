import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { PurchaseInvoiceScanService } from "../purchasing/purchase-invoice-scan.service.js";
import { MissingInvoicesRepository } from "./missing-invoices.repository.js";

const gate = integrationDatabaseGate(process.env);

/** A 2×1 pixel PNG (no binary fixture in the repo). */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4z8DwHwQYGBgAKfwF+yHbvgAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * A SCAN ATTACHED TO A PURCHASE INVOICE IN THE HIÁNYZÓ SZÁMLÁK (acrobot 28111).
 * The scan is the recorded invoice's original, not an upload waiting for a
 * debit. It has to show as that invoice (its number, date and supplier, in
 * the invoice's month), and when the invoice came from a NAV row, as part of
 * that row. Before the fix it was a loose upload: dated the day of the
 * upload, and among the candidates of every month.
 */
describe(
  "a scan attached to a purchase invoice among the Hiányzó számlák candidates",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = randomUUID();
    const scans = new PurchaseInvoiceScanService();
    const repository = new MissingInvoicesRepository();
    let userId: string, warehouseId: string;
    const supplierIds: string[] = [];

    async function invoiceWithScan(label: string, taxNumber: string | null) {
      const supplier = await prisma.supplier.create({
        data: {
          code: `MI-SCAN-${label}-${suffix}`,
          name: `Csatolt kép ${label}`,
          taxNumber,
        },
      });
      supplierIds.push(supplier.id);
      const invoice = await prisma.purchaseInvoice.create({
        data: {
          documentNumber: `MI-SCAN-${label}-${suffix}`,
          supplierInvoiceNumber: `MI-${label}-${suffix}`,
          source: taxNumber ? "HU_MANUAL" : "EU",
          supplierId: supplier.id,
          warehouseId,
          invoiceDate: new Date("2026-09-15T00:00:00Z"),
        },
      });
      const [scan] = await scans.attach(
        invoice.id,
        {
          buffer: PNG,
          mimetype: "image/png",
          originalname: `${label}.png`,
        },
        userId,
      );
      return { supplier, invoice, scanId: scan!.id };
    }

    const holding = (
      candidates: Awaited<ReturnType<MissingInvoicesRepository["candidates"]>>,
      id: string,
    ) => candidates.find((d) => d.id === id || d.aliasIds?.includes(id));

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      userId = (
        await prisma.user.create({
          data: {
            email: `mi-scan-${suffix}@example.test`,
            displayName: "Linked scan test",
            role: "ADMIN",
          },
        })
      ).id;
      warehouseId = (
        await prisma.warehouse.create({
          data: { code: `MI-SCAN-${suffix}`, name: "Linked scan warehouse" },
        })
      ).id;
    });

    it("a foreign invoice's scan stands as the invoice, on the invoice's date", async () => {
      const { invoice, supplier, scanId } = await invoiceWithScan("eu", null);
      const found = holding(
        await repository.candidates("2026-09-01", "2026-09-30"),
        scanId,
      );
      assert.deepEqual(
        [found?.number, found?.date, found?.supplierName, found?.hasOriginal],
        [invoice.supplierInvoiceNumber, "2026-09-15", supplier.name, true],
        "LINKED-AS-INVOICE",
      );
    });

    it("the scan is not a candidate of a month its invoice is not in", async () => {
      const { scanId } = await invoiceWithScan("month", null);
      assert.equal(
        holding(
          await repository.candidates("2026-08-01", "2026-08-31"),
          scanId,
        ),
        undefined,
        "LINKED-OUT-OF-MONTH",
      );
    });

    it("a scan of an invoice recorded from a NAV row is that row's original", async () => {
      const { invoice, scanId } = await invoiceWithScan("nav", "99999997-2-42");
      // the recorded number was corrected afterwards; the NAV row keeps its own
      const navRow = await prisma.navIncomingInvoice.create({
        data: {
          navInvoiceNumber: `NAV-${suffix}`,
          supplierTaxNumber: "99999997-2-42",
          supplierName: "Csatolt kép nav",
          invoiceIssueDate: new Date("2026-09-15T00:00:00Z"),
          insDate: new Date("2026-09-15T08:00:00Z"),
          invoiceNetAmount: "1000",
          invoiceVatAmount: "270",
          status: "RECEIVED",
          purchaseInvoiceId: invoice.id,
        },
      });
      const found = holding(
        await repository.candidates("2026-09-01", "2026-09-30"),
        scanId,
      );
      assert.deepEqual(
        [found?.id, found?.originalId],
        [navRow.id, scanId],
        "LINKED-INTO-NAV",
      );
    });

    after(async () => {
      if (gate.mode !== "run") return;
      await prisma.navIncomingInvoice.deleteMany({
        where: { supplierTaxNumber: "99999997-2-42" },
      });
      await prisma.incomingSupplierDocument.deleteMany({
        where: { purchaseInvoice: { supplierId: { in: supplierIds } } },
      });
      await prisma.purchaseInvoice.deleteMany({
        where: { supplierId: { in: supplierIds } },
      });
      await prisma.auditLog.deleteMany({ where: { userId } });
      await prisma.warehouse.deleteMany({ where: { id: warehouseId } });
      await prisma.supplier.deleteMany({ where: { id: { in: supplierIds } } });
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
    });
  },
);
