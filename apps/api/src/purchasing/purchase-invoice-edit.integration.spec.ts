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

    it("a renamed invoice's attached scan reads the new number (acrobot 28101)", async () => {
      const row = await invoice("scan");
      const scan = await prisma.incomingSupplierDocument.create({
        data: {
          gmailMessageId: `edit-scan:${suffix}`,
          fileName: "lap.pdf",
          sizeBytes: 14,
          sha256: `edit-scan-${suffix}`,
          content: new Uint8Array(Buffer.from("%PDF-1.4 teszt")),
          status: "FAILED",
          kind: "INVOICE",
          origin: "UPLOAD",
          payeeCheck: "COMPANY",
          purchaseInvoiceId: row.id,
          textReading: {
            invoiceNumber: row.supplierInvoiceNumber,
            numberFrom: null,
            supplierTaxNumber: "12345678-2-42",
          },
        },
      });
      const fixed = `EDIT-scan-fixed-${suffix}`;
      await edits.update(row.id, { supplierInvoiceNumber: fixed }, userId);
      const reading = (
        await prisma.incomingSupplierDocument.findUniqueOrThrow({
          where: { id: scan.id },
        })
      ).textReading as Record<string, unknown>;
      assert.equal(reading.invoiceNumber, fixed, "SCAN-RENUMBERED");
      // the rest of the reading stays
      assert.equal(reading.supplierTaxNumber, "12345678-2-42");
    });

    it("a cancellation between the check and the write is refused, and nothing is written", async () => {
      const row = await invoice("race");
      // the read sees POSTED; the invoice is cancelled right before the write
      const racing = new PurchaseInvoiceEditService();
      Object.defineProperty(racing, "database", {
        value: new Proxy(prisma, {
          get(target, key, receiver) {
            if (key !== "$transaction")
              return Reflect.get(target, key, receiver);
            return async (...args: unknown[]) => {
              await prisma.purchaseInvoice.update({
                where: { id: row.id },
                data: { status: "CANCELLED" },
              });
              return (
                target.$transaction as (...a: unknown[]) => Promise<unknown>
              ).apply(target, args);
            };
          },
        }),
      });
      await assert.rejects(
        racing.update(row.id, { note: "Késve." }, userId),
        /Visszavont számla nem módosítható/,
        "EDIT-AFTER-CANCEL-409",
      );
      const after = await prisma.purchaseInvoice.findUniqueOrThrow({
        where: { id: row.id },
      });
      assert.equal(after.note, null);
    });

    it("a second rename that read the old number rekeys from the receipt's key", async () => {
      const row = await invoice("twice");
      const first = `EDIT-twice-y-${suffix}`;
      const second = `EDIT-twice-z-${suffix}`;
      await prisma.stockMovement.create({
        data: {
          movementNumber: `BESZMOZG-${row.documentNumber}`,
          type: "PURCHASE_RECEIPT",
          status: "POSTED",
          sourceWarehouseId: warehouseId,
          referenceType: "PurchaseInvoice",
          referenceId: row.id,
          idempotencyKey: receiptKey(supplierId, row.supplierInvoiceNumber),
          occurredAt: new Date(),
        },
      });
      await edits.update(row.id, { supplierInvoiceNumber: first }, userId);
      // the second edit read the invoice before the first committed: X, not Y
      const stale = new PurchaseInvoiceEditService();
      Object.defineProperty(stale, "database", {
        value: new Proxy(prisma, {
          get(target, key) {
            if (key === "purchaseInvoice")
              return new Proxy(target.purchaseInvoice, {
                get(model, method) {
                  if (method !== "findUnique") {
                    const value = Reflect.get(model, method);
                    return typeof value === "function"
                      ? value.bind(model)
                      : value;
                  }
                  return async (
                    args: Parameters<typeof model.findUnique>[0],
                  ) => {
                    const real = await model.findUnique(args);
                    return (
                      real && {
                        ...real,
                        supplierInvoiceNumber: row.supplierInvoiceNumber,
                      }
                    );
                  };
                },
              });
            const value = Reflect.get(target, key);
            return typeof value === "function" ? value.bind(target) : value;
          },
        }),
      });
      await stale.update(row.id, { supplierInvoiceNumber: second }, userId);
      const keys = (
        await prisma.stockMovement.findMany({ where: { referenceId: row.id } })
      ).map((m) => m.idempotencyKey);
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { entityId: row.id, action: "purchase_invoice.updated" },
        orderBy: { createdAt: "desc" },
      });
      assert.deepEqual(
        [
          keys,
          (audit.metadata as { changes: Record<string, { from: unknown }> })
            .changes.supplierInvoiceNumber?.from,
        ],
        [[receiptKey(supplierId, second)], first],
        "REKEY-FROM-RECEIPT",
      );
      await prisma.stockMovement.deleteMany({ where: { referenceId: row.id } });
    });

    it("a payment date applies only if the invoice is paid under the lock", async () => {
      const row = await invoice("paidat");
      // the edit read it as paid; it was set unpaid before the write
      const stale = new PurchaseInvoiceEditService();
      Object.defineProperty(stale, "database", {
        value: new Proxy(prisma, {
          get(target, key) {
            if (key === "purchaseInvoice")
              return new Proxy(target.purchaseInvoice, {
                get(model, method) {
                  if (method !== "findUnique") {
                    const value = Reflect.get(model, method);
                    return typeof value === "function"
                      ? value.bind(model)
                      : value;
                  }
                  return async (
                    args: Parameters<typeof model.findUnique>[0],
                  ) => {
                    const real = await model.findUnique(args);
                    return real && { ...real, isPaid: true };
                  };
                },
              });
            const value = Reflect.get(target, key);
            return typeof value === "function" ? value.bind(target) : value;
          },
        }),
      });
      await stale.update(row.id, { paidAt: "2026-10-08" }, userId);
      const after = await prisma.purchaseInvoice.findUniqueOrThrow({
        where: { id: row.id },
      });
      assert.deepEqual(
        [after.isPaid, after.paidAt],
        [false, null],
        "PAIDAT-UNDER-LOCK",
      );
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
      await prisma.incomingSupplierDocument.deleteMany({
        where: { purchaseInvoiceId: { in: ids } },
      });
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
