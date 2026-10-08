import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { Prisma, prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { PurchaseInvoiceCancelService } from "./purchase-invoice-cancel.service.js";
import {
  PurchaseInvoiceRepository,
  type CreatePurchaseInvoiceLine,
} from "./purchase-invoice.repository.js";

const gate = integrationDatabaseGate(process.env);
const D = (value: string | number) => new Prisma.Decimal(value);

/**
 * THE CANCELLATION ON A REAL DATABASE (Balázs „A 1”, acrobot 28092). The
 * invoices are recorded through the same repository the recording endpoint
 * uses, so the receipt, its key, the reservations and the outbox rows are the
 * real ones the cancellation has to undo.
 */
describe(
  "cancelling a recorded purchase invoice",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = randomUUID().slice(0, 8);
    const repository = new PurchaseInvoiceRepository();
    const cancels = new PurchaseInvoiceCancelService();
    let userId: string, supplierId: string, warehouseId: string;
    let projectId: string;
    const productIds: string[] = [];

    async function variant(
      label: string,
      catalogAuthority: "UNAS" | "ACROPORA",
    ) {
      const product = await prisma.product.create({
        data: { name: `CANCEL-${suffix} ${label}`, catalogAuthority },
      });
      productIds.push(product.id);
      return prisma.productVariant.create({
        data: { productId: product.id, sku: `CANCEL-${suffix}-${label}` },
      });
    }

    async function record(
      label: string,
      lines: Array<{
        variantId: string;
        sku: string;
        quantity: number;
        syncToUnas?: boolean;
        reserve?: number;
      }>,
      extra: {
        isPaid?: boolean;
        number?: string;
        navIncomingInvoiceId?: string;
        expectedArrivalId?: string;
      } = {},
    ) {
      return repository.create({
        documentNumber: `CANCEL-${label}-${suffix}-${randomUUID().slice(0, 4)}`,
        supplierInvoiceNumber: extra.number ?? `CANCEL-${label}-${suffix}`,
        source: "HU_MANUAL",
        supplierId,
        warehouseId,
        currency: "HUF",
        exchangeRate: null,
        invoiceDate: new Date("2026-10-08T00:00:00Z"),
        dueDate: null,
        isPaid: extra.isPaid ?? false,
        paidAt: extra.isPaid ? new Date() : null,
        vatRate: D(27),
        note: null,
        navIncomingInvoiceId: extra.navIncomingInvoiceId,
        expectedArrivalId: extra.expectedArrivalId,
        actorUserId: userId,
        lines: lines.map((line): CreatePurchaseInvoiceLine => ({
          variantId: line.variantId,
          sku: line.sku,
          createLocalProduct: null,
          sourceDescription: null,
          orderedQuantity: D(line.quantity),
          actualQuantity: D(line.quantity),
          unit: "db",
          unitNet: D(1000),
          discountPercent: null,
          syncStatus: line.syncToUnas ? "PENDING" : "NOT_APPLICABLE",
          syncError: null,
          syncToUnas: line.syncToUnas ?? false,
          ...(line.reserve
            ? {
                projectAllocations: [{ projectId, quantity: D(line.reserve) }],
              }
            : {}),
        })),
      });
    }

    const stock = (variantId: string) =>
      prisma.stockItem.findFirstOrThrow({
        where: { variantId, warehouseId, locationId: null, lotId: null },
      });
    const status = async (id: string) =>
      (await prisma.purchaseInvoice.findUniqueOrThrow({ where: { id } }))
        .status;

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      userId = (
        await prisma.user.create({
          data: {
            email: `cancel-${suffix}@example.test`,
            displayName: "Cancel test",
            role: "ADMIN",
          },
        })
      ).id;
      supplierId = (
        await prisma.supplier.create({
          data: { code: `CANCEL-${suffix}`, name: "Sztornó beszállító" },
        })
      ).id;
      warehouseId = (
        await prisma.warehouse.create({
          data: { code: `CANCEL-${suffix}`, name: "Sztornó raktár" },
        })
      ).id;
      projectId = (
        await prisma.project.create({
          data: { projectNumber: `CANCEL-${suffix}`, name: "Sztornó projekt" },
        })
      ).id;
    });

    it("the stock goes back out, the reservation is released, and the receipt is reversed", async () => {
      const v = await variant("undo", "ACROPORA");
      const invoice = await record("undo", [
        { variantId: v.id, sku: v.sku, quantity: 3, reserve: 1 },
      ]);
      await cancels.cancel(invoice.id, "Rossz szállítóra rögzítve", userId);
      const item = await stock(v.id);
      const reservation =
        await prisma.projectInventoryReservation.findFirstOrThrow({
          where: { variantId: v.id },
        });
      assert.deepEqual(
        [
          item.onHand.toString(),
          item.reserved.toString(),
          reservation.status,
          await status(invoice.id),
        ],
        ["0", "0", "RELEASED", "CANCELLED"],
        "CANCEL-UNDONE",
      );
      const movements = await prisma.stockMovement.findMany({
        where: { referenceType: "PurchaseInvoice", referenceId: invoice.id },
        orderBy: { createdAt: "asc" },
      });
      assert.deepEqual(
        movements.map((m) => [m.type, m.status]),
        [
          ["PURCHASE_RECEIPT", "REVERSED"],
          ["ADJUSTMENT", "POSTED"],
        ],
      );
      const saved = await prisma.purchaseInvoice.findUniqueOrThrow({
        where: { id: invoice.id },
      });
      assert.equal(saved.cancelReason, "Rossz szállítóra rögzítve");
      assert.equal(saved.cancelledById, userId);
    });

    it("the cancelled invoice's number can be recorded again, and its stock arrives", async () => {
      const v = await variant("again", "ACROPORA");
      const number = `CANCEL-again-${suffix}`;
      const first = await record("again", [
        { variantId: v.id, sku: v.sku, quantity: 2 },
      ]);
      await cancels.cancel(first.id, "Újra rögzítem", userId);
      // both ways this can fail carry the trace: the number refused, or the
      // receipt found "already posted" and the stock never arriving
      const second = await record(
        "again2",
        [{ variantId: v.id, sku: v.sku, quantity: 2 }],
        { number },
      ).catch((error: unknown) => error);
      assert.ok(
        !(second instanceof Error),
        `NUMBER-REUSABLE: ${String(second)}`,
      );
      assert.equal(
        (await stock(v.id)).onHand.toString(),
        "2",
        "NUMBER-REUSABLE",
      );
    });

    it("a paid invoice is refused, and stays recorded", async () => {
      const v = await variant("paid", "ACROPORA");
      const invoice = await record(
        "paid",
        [{ variantId: v.id, sku: v.sku, quantity: 1 }],
        { isPaid: true },
      );
      await assert.rejects(
        cancels.cancel(invoice.id, "Fizetve volt", userId),
        /Kifizetett számla nem sztornózható/,
        "PAID-409",
      );
      assert.equal(await status(invoice.id), "POSTED");
    });

    it("an invoice whose stock is already partly gone is refused, and nothing moves", async () => {
      const v = await variant("short", "ACROPORA");
      const invoice = await record("short", [
        { variantId: v.id, sku: v.sku, quantity: 3 },
      ]);
      // two of the three were sold since
      await prisma.stockItem.updateMany({
        where: { variantId: v.id, warehouseId },
        data: { onHand: D(1) },
      });
      await assert.rejects(
        cancels.cancel(invoice.id, "Késő", userId),
        /készlete már kevesebb/,
        "STOCK-SHORT-409",
      );
      assert.deepEqual(
        [(await stock(v.id)).onHand.toString(), await status(invoice.id)],
        ["1", "POSTED"],
      );
    });

    it("stock another project holds stays held: the cancel is refused", async () => {
      const v = await variant("others", "ACROPORA");
      const invoice = await record("others", [
        { variantId: v.id, sku: v.sku, quantity: 5, reserve: 2 },
      ]);
      // 10 on hand: 2 ours, 7 another project's; only 3 can go out of 5
      await prisma.stockItem.updateMany({
        where: { variantId: v.id, warehouseId },
        data: { onHand: D(10), reserved: D(9) },
      });
      await assert.rejects(
        cancels.cancel(invoice.id, "Más projekt fogja", userId),
        /más foglalás köt le/,
        "OTHER-RESERVED-409",
      );
      assert.equal(await status(invoice.id), "POSTED");
    });

    it("the receipt's own key is freed, even when it differs from today's number", async () => {
      const v = await variant("legacy", "ACROPORA");
      const first = await record("legacy", [
        { variantId: v.id, sku: v.sku, quantity: 2 },
      ]);
      // renamed before renames moved the key: the receipt keeps the old one
      await prisma.purchaseInvoice.update({
        where: { id: first.id },
        data: { supplierInvoiceNumber: `CANCEL-legacy-renamed-${suffix}` },
      });
      await cancels.cancel(first.id, "Régi átnevezés", userId);
      const again = await record(
        "legacy2",
        [{ variantId: v.id, sku: v.sku, quantity: 2 }],
        { number: `CANCEL-legacy-${suffix}` },
      ).catch((error: unknown) => error);
      assert.ok(
        !(again instanceof Error),
        `OLD-KEY-FROM-RECEIPT: ${String(again)}`,
      );
      assert.equal(
        (await stock(v.id)).onHand.toString(),
        "2",
        "OLD-KEY-FROM-RECEIPT",
      );
    });

    it("two recorded invoices still cannot share a number (the partial index is there)", async () => {
      const number = `CANCEL-twice-${suffix}`;
      const base = {
        supplierInvoiceNumber: number,
        source: "HU_MANUAL" as const,
        supplierId,
        warehouseId,
        invoiceDate: new Date("2026-10-08T00:00:00Z"),
      };
      await prisma.purchaseInvoice.create({
        data: { ...base, documentNumber: `CANCEL-twice-a-${suffix}` },
      });
      await assert.rejects(
        prisma.purchaseInvoice.create({
          data: { ...base, documentNumber: `CANCEL-twice-b-${suffix}` },
        }),
        (error: unknown) =>
          typeof error === "object" &&
          error !== null &&
          (error as { code?: string }).code === "P2002",
        "INDEX-STILL-UNIQUE",
      );
    });

    it("an invoice with a consumed project reservation is refused", async () => {
      const v = await variant("consumed", "ACROPORA");
      const invoice = await record("consumed", [
        { variantId: v.id, sku: v.sku, quantity: 2, reserve: 1 },
      ]);
      await prisma.projectInventoryReservation.updateMany({
        where: { variantId: v.id },
        data: { status: "CONSUMED", consumedAt: new Date() },
      });
      await assert.rejects(
        cancels.cancel(invoice.id, "Már beépült", userId),
        /már felhasználták/,
        "CONSUMED-409",
      );
      assert.equal(await status(invoice.id), "POSTED");
    });

    it("a UNAS product's shop stock goes back to what it was before the receipt", async () => {
      const v = await variant("unas", "UNAS");
      // a known baseline, so the outbox publishes a real absolute
      await prisma.stockItem.create({
        data: { variantId: v.id, warehouseId, onHand: D(10) },
      });
      const invoice = await record("unas", [
        { variantId: v.id, sku: v.sku, quantity: 3, syncToUnas: true },
      ]);
      await cancels.cancel(invoice.id, "UNAS-os termék", userId);
      const row = await prisma.unasStockSyncOutbox.findFirst({
        where: {
          idempotencyKey: `PURCHASE_INVOICE_CANCEL:${invoice.id}:${v.id}`,
        },
      });
      assert.equal(row?.targetOnHand.toString(), "10", "UNAS-TARGET");
    });

    it("the NAV row and the expected arrival can be recorded again", async () => {
      const v = await variant("links", "ACROPORA");
      const nav = await prisma.navIncomingInvoice.create({
        data: {
          navInvoiceNumber: `CANCEL-NAV-${suffix}`,
          supplierTaxNumber: "99999996-2-42",
          supplierName: "Sztornó beszállító",
          invoiceIssueDate: new Date("2026-10-08T00:00:00Z"),
          insDate: new Date("2026-10-08T08:00:00Z"),
          status: "DATA_FETCHED",
          parsedData: { lines: [] },
        },
      });
      const arrival = await prisma.expectedArrival.create({
        data: {
          supplierKey: `CANCEL-${suffix}`,
          arrivalKey: `CANCEL-${suffix}`,
          supplierName: "Sztornó beszállító",
        },
      });
      const invoice = await record(
        "links",
        [{ variantId: v.id, sku: v.sku, quantity: 1 }],
        { navIncomingInvoiceId: nav.id, expectedArrivalId: arrival.id },
      );
      await cancels.cancel(invoice.id, "Rossz NAV-sor", userId);
      const navAfter = await prisma.navIncomingInvoice.findUniqueOrThrow({
        where: { id: nav.id },
      });
      const arrivalAfter = await prisma.expectedArrival.findUniqueOrThrow({
        where: { id: arrival.id },
      });
      assert.deepEqual(
        [
          navAfter.status,
          navAfter.purchaseInvoiceId,
          arrivalAfter.status,
          arrivalAfter.purchaseInvoiceId,
        ],
        ["DATA_FETCHED", null, "OPEN", null],
        "LINKS-REOPENED",
      );
    });

    after(async () => {
      if (gate.mode !== "run") return;
      const invoiceIds = (
        await prisma.purchaseInvoice.findMany({
          where: { supplierId },
          select: { id: true },
        })
      ).map((row) => row.id);
      const variantIds = (
        await prisma.productVariant.findMany({
          where: { productId: { in: productIds } },
          select: { id: true },
        })
      ).map((row) => row.id);
      const movementIds = (
        await prisma.stockMovement.findMany({
          where: { referenceId: { in: invoiceIds } },
          select: { id: true },
        })
      ).map((row) => row.id);
      await prisma.unasStockSyncOutbox.deleteMany({
        where: { variantId: { in: variantIds } },
      });
      await prisma.stockMovementLine.deleteMany({
        where: { movementId: { in: movementIds } },
      });
      await prisma.stockMovement.deleteMany({
        where: { id: { in: movementIds } },
      });
      const reservationIds = (
        await prisma.projectInventoryReservation.findMany({
          where: { projectId },
          select: { id: true },
        })
      ).map((row) => row.id);
      await prisma.domainEvent.deleteMany({
        where: { aggregateId: { in: reservationIds } },
      });
      await prisma.projectInventoryReservation.deleteMany({
        where: { projectId },
      });
      await prisma.navIncomingInvoice.deleteMany({
        where: { supplierTaxNumber: "99999996-2-42" },
      });
      await prisma.expectedArrival.deleteMany({
        where: { supplierKey: `CANCEL-${suffix}` },
      });
      await prisma.productExtension.deleteMany({
        where: { variantId: { in: variantIds } },
      });
      await prisma.purchaseInvoiceLine.deleteMany({
        where: { purchaseInvoiceId: { in: invoiceIds } },
      });
      await prisma.purchaseInvoice.deleteMany({ where: { supplierId } });
      await prisma.stockItem.deleteMany({ where: { warehouseId } });
      await prisma.productVariant.deleteMany({
        where: { id: { in: variantIds } },
      });
      await prisma.product.deleteMany({ where: { id: { in: productIds } } });
      await prisma.project.deleteMany({ where: { id: projectId } });
      await prisma.auditLog.deleteMany({ where: { userId } });
      await prisma.warehouse.deleteMany({ where: { id: warehouseId } });
      await prisma.supplier.deleteMany({ where: { id: supplierId } });
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
    });
  },
);
