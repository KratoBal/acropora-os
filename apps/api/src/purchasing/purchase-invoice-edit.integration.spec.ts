import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import {
  PurchaseInvoiceEditService,
  receiptKey,
} from "./purchase-invoice-edit.service.js";

const gate = integrationDatabaseGate(process.env);

describe(
  "correcting a recorded purchase invoice without touching stock",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = randomUUID();
    const edits = new PurchaseInvoiceEditService();
    let userId: string, supplierId: string, warehouseId: string;

    async function invoice(label: string, currency = "HUF") {
      return prisma.purchaseInvoice.create({
        data: {
          documentNumber: `EDIT-${label}-${suffix}`,
          supplierInvoiceNumber: `EDIT-${label}-${suffix}`,
          source: currency === "HUF" ? "HU_MANUAL" : "EU",
          supplierId,
          warehouseId,
          currency,
          exchangeRate: currency === "HUF" ? null : "395.5",
          invoiceDate: new Date("2026-10-08T00:00:00Z"),
          lines: {
            create: [
              {
                sourceDescription: "Szlovák tétel",
                orderedQuantity: "2",
                actualQuantity: "2",
                unit: "db",
                unitNet: "1000",
              },
            ],
          },
        },
        include: { lines: true },
      });
    }

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      userId = (
        await prisma.user.create({
          data: {
            email: `edit-${suffix}@example.test`,
            displayName: "Edit test",
            role: "ADMIN",
          },
        })
      ).id;
      supplierId = (
        await prisma.supplier.create({
          data: { code: `EDIT-${suffix}`, name: "Edit supplier" },
        })
      ).id;
      warehouseId = (
        await prisma.warehouse.create({
          data: { code: `EDIT-${suffix}`, name: "Edit warehouse" },
        })
      ).id;
    });

    it("the number, dates, payment, note and a line's name are saved; quantities stay", async () => {
      const row = await invoice("save");
      await edits.update(
        row.id,
        {
          supplierInvoiceNumber: `EDIT-fixed-${suffix}`,
          invoiceDate: "2026-10-07",
          dueDate: "2026-10-22",
          isPaid: true,
          paidAt: "2026-10-08",
          note: "Javítva.",
          lines: [{ id: row.lines[0]!.id, sourceDescription: "Pontos név" }],
        },
        userId,
      );
      const saved = await prisma.purchaseInvoice.findUniqueOrThrow({
        where: { id: row.id },
        include: { lines: true },
      });
      assert.equal(
        saved.supplierInvoiceNumber,
        `EDIT-fixed-${suffix}`,
        "EDIT-SAVED",
      );
      assert.equal(saved.invoiceDate.toISOString().slice(0, 10), "2026-10-07");
      assert.equal(saved.isPaid, true);
      assert.equal(saved.note, "Javítva.");
      assert.equal(saved.lines[0]!.sourceDescription, "Pontos név");
      assert.equal(saved.lines[0]!.actualQuantity.toString(), "2");

      await edits.update(row.id, { isPaid: false }, userId);
      const unpaid = await prisma.purchaseInvoice.findUniqueOrThrow({
        where: { id: row.id },
      });
      assert.equal(unpaid.paidAt, null);
    });

    it("a renamed invoice frees its old number: the receipt's key moves with it", async () => {
      const row = await invoice("rekey");
      const oldKey = receiptKey(supplierId, row.supplierInvoiceNumber);
      await prisma.stockMovement.create({
        data: {
          movementNumber: `BESZMOZG-${row.documentNumber}`,
          type: "PURCHASE_RECEIPT",
          status: "POSTED",
          sourceWarehouseId: warehouseId,
          referenceType: "PurchaseInvoice",
          referenceId: row.id,
          idempotencyKey: oldKey,
          occurredAt: new Date(),
        },
      });
      const fixed = `EDIT-rekeyed-${suffix}`;
      await edits.update(row.id, { supplierInvoiceNumber: fixed }, userId);
      // a later invoice with the old number would otherwise find "already posted"
      assert.equal(
        await prisma.stockMovement.count({ where: { idempotencyKey: oldKey } }),
        0,
        "OLD-KEY-FREE",
      );
      assert.equal(
        await prisma.stockMovement.count({
          where: { idempotencyKey: receiptKey(supplierId, fixed) },
        }),
        1,
      );
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { entityId: row.id, action: "purchase_invoice.updated" },
        orderBy: { createdAt: "desc" },
      });
      assert.deepEqual(
        (audit.metadata as { changes: Record<string, unknown> }).changes
          .supplierInvoiceNumber,
        { from: row.supplierInvoiceNumber, to: fixed },
      );
      await prisma.stockMovement.deleteMany({
        where: { referenceId: row.id },
      });
    });

    it("a foreign invoice's date stays: its rate came from it", async () => {
      const row = await invoice("eur", "EUR");
      await assert.rejects(
        edits.update(row.id, { invoiceDate: "2026-10-01" }, userId),
        /Devizás számla kelte nem módosítható/,
        "FOREIGN-DATE-400",
      );
      // the rest of it is open
      await edits.update(row.id, { note: "Rendben." }, userId);
    });

    it("a manual line keeps a name, and two invoices of a supplier keep their own numbers", async () => {
      const row = await invoice("name");
      await assert.rejects(
        edits.update(
          row.id,
          { lines: [{ id: row.lines[0]!.id, sourceDescription: "  " }] },
          userId,
        ),
        /1\. tétel megnevezése hiányzik/,
        "MANUAL-NAME-400",
      );
      const other = await invoice("other");
      await assert.rejects(
        edits.update(
          row.id,
          { supplierInvoiceNumber: other.supplierInvoiceNumber },
          userId,
        ),
        /már van ilyen számlaszámú/,
        "NUMBER-UNIQUE-409",
      );
    });

    after(async () => {
      if (gate.mode !== "run") return;
      const ids = (
        await prisma.purchaseInvoice.findMany({
          where: { supplierId },
          select: { id: true },
        })
      ).map((r) => r.id);
      await prisma.purchaseInvoiceLine.deleteMany({
        where: { purchaseInvoiceId: { in: ids } },
      });
      await prisma.purchaseInvoice.deleteMany({ where: { supplierId } });
      await prisma.auditLog.deleteMany({ where: { userId } });
      await prisma.warehouse.deleteMany({ where: { id: warehouseId } });
      await prisma.supplier.deleteMany({ where: { id: supplierId } });
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
    });
  },
);
