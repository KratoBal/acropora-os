import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { ConflictException } from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { reservedMismatches } from "../inventory/reserved-reconciliation.js";
import { ProjectReservationService } from "./project-reservation.service.js";

const gate = integrationDatabaseGate(process.env);
const D = (value: number | string) => new Prisma.Decimal(value);

/**
 * #1582 P5a ON A REAL DATABASE: releasing a project's hold (by hand and with
 * the project), the origin CHECK, the BOM item's per-stock-row index, and the
 * `reserved` reconciliation.
 */
describe(
  "project reservations: release, origin and reconciliation (#1582 P5a)",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = randomUUID().slice(0, 8);
    const service = new ProjectReservationService();
    let userId: string, warehouseId: string, otherWarehouseId: string;
    let supplierId: string, unasVariantId: string, localVariantId: string;
    let lineId: string, secondLineId: string, bomItemId: string;
    const projectIds: string[] = [];
    const productIds: string[] = [];
    let quoteId: string;

    async function stockItem(
      variantId: string,
      warehouse: string,
      onHand: number,
    ) {
      return prisma.stockItem.create({
        data: { variantId, warehouseId: warehouse, onHand: D(onHand) },
      });
    }

    async function project(label: string) {
      const row = await prisma.project.create({
        data: { projectNumber: `P5A-${label}-${suffix}`, name: `P5a ${label}` },
      });
      projectIds.push(row.id);
      return row.id;
    }

    /** A receipt hold, with the stock row's `reserved` raised as the receipt does. */
    async function receiptHold(
      projectId: string,
      stock: { id: string; variantId: string; warehouseId: string },
      quantity: number,
      purchaseInvoiceLineId = lineId,
    ) {
      await prisma.stockItem.update({
        where: { id: stock.id },
        data: { reserved: { increment: D(quantity) } },
      });
      return prisma.projectInventoryReservation.create({
        data: {
          projectId,
          origin: "PURCHASE_RECEIPT",
          purchaseInvoiceLineId,
          stockItemId: stock.id,
          variantId: stock.variantId,
          warehouseId: stock.warehouseId,
          quantity: D(quantity),
        },
      });
    }

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      userId = (
        await prisma.user.create({
          data: {
            email: `p5a-${suffix}@example.test`,
            displayName: "P5a test",
            role: "ADMIN",
          },
        })
      ).id;
      warehouseId = (
        await prisma.warehouse.create({
          data: { code: `P5A-${suffix}`, name: "P5a raktár" },
        })
      ).id;
      otherWarehouseId = (
        await prisma.warehouse.create({
          data: { code: `P5A2-${suffix}`, name: "P5a másik raktár" },
        })
      ).id;
      supplierId = (
        await prisma.supplier.create({
          data: { code: `P5A-${suffix}`, name: "P5a beszállító" },
        })
      ).id;
      for (const [label, authority] of [
        ["unas", "UNAS"],
        ["local", "ACROPORA"],
      ] as const) {
        const product = await prisma.product.create({
          data: { name: `P5A-${suffix} ${label}`, catalogAuthority: authority },
        });
        productIds.push(product.id);
        const variant = await prisma.productVariant.create({
          data: { productId: product.id, sku: `P5A-${suffix}-${label}` },
        });
        if (label === "unas") unasVariantId = variant.id;
        else localVariantId = variant.id;
      }
      const invoice = await prisma.purchaseInvoice.create({
        data: {
          documentNumber: `P5A-${suffix}`,
          supplierInvoiceNumber: `P5A-${suffix}`,
          source: "HU_MANUAL",
          supplierId,
          warehouseId,
          invoiceDate: new Date("2026-10-08T00:00:00Z"),
          lines: {
            create: [1, 2].map(() => ({
              variantId: unasVariantId,
              orderedQuantity: D(10),
              actualQuantity: D(10),
              unit: "db",
              unitNet: D(1000),
            })),
          },
        },
        include: { lines: true },
      });
      lineId = invoice.lines[0]!.id;
      secondLineId = invoice.lines[1]!.id;
      const quote = await prisma.quote.create({
        data: { quoteNumber: `P5A-${suffix}`, title: "P5a ajánlat" },
      });
      quoteId = quote.id;
      const version = await prisma.quoteVersion.create({
        data: {
          quoteId,
          versionNumber: 1,
          validUntil: new Date("2099-12-31T00:00:00Z"),
          priceDisplay: "NET",
        },
      });
      const block = await prisma.quoteBlock.create({
        data: {
          versionId: version.id,
          position: 0,
          kind: "SECTION",
          title: "R",
        },
      });
      const item = await prisma.quoteItem.create({
        data: {
          versionId: version.id,
          blockId: block.id,
          position: 0,
          source: "STANDALONE",
          name: "Rendszer",
          quantity: D(1),
          unit: "db",
          unitNetPrice: D(1000),
          vatRatePercent: D(27),
          isOptional: false,
        },
      });
      bomItemId = (
        await prisma.quoteBomItem.create({
          data: {
            versionId: version.id,
            quoteItemId: item.id,
            position: 0,
            kind: "PRODUCT",
            variantId: unasVariantId,
            quantity: D(4),
            unit: "db",
          },
        })
      ).id;
    });

    it("a hold released by hand: RELEASED, reserved down, the shop's free stock queued", async () => {
      const stock = await stockItem(unasVariantId, warehouseId, 10);
      const projectId = await project("manual");
      const hold = await receiptHold(projectId, stock, 3);
      const answer = await service.release(projectId, hold.id, userId);
      const after = await prisma.projectInventoryReservation.findUniqueOrThrow({
        where: { id: hold.id },
      });
      const row = await prisma.unasStockSyncOutbox.findFirst({
        where: {
          idempotencyKey: `PROJECT_RESERVATION_RELEASE:${hold.id}:${unasVariantId}`,
        },
      });
      assert.deepEqual(
        [
          answer.released,
          after.status,
          (
            await prisma.stockItem.findUniqueOrThrow({
              where: { id: stock.id },
            })
          ).reserved.toString(),
          row?.targetOnHand.toString(),
          row?.sourceProcess,
        ],
        [1, "RELEASED", "0", "10", "PROJECT_RESERVATION"],
        "RELEASE-STATE",
      );
    });

    it("a second release of the same hold is a 409, and reserved goes down once", async () => {
      const stock = await stockItem(localVariantId, warehouseId, 10);
      const projectId = await project("twice");
      const hold = await receiptHold(projectId, stock, 2, secondLineId);
      await service.release(projectId, hold.id, userId);
      const second = await service.release(projectId, hold.id, userId).then(
        () => "released",
        (error: unknown) =>
          error instanceof ConflictException ? "409" : String(error),
      );
      assert.deepEqual(
        [
          second,
          (
            await prisma.stockItem.findUniqueOrThrow({
              where: { id: stock.id },
            })
          ).reserved.toString(),
        ],
        ["409", "0"],
        "DOUBLE-RELEASE-409",
      );
    });

    it("a stock row that holds less than the hold refuses the release", async () => {
      const stock = await stockItem(localVariantId, otherWarehouseId, 10);
      const projectId = await project("drift");
      const hold = await receiptHold(projectId, stock, 3, secondLineId);
      // drifted: the row says 1 is held, the hold says 3
      await prisma.stockItem.update({
        where: { id: stock.id },
        data: { reserved: D(1) },
      });
      const outcome = await service.release(projectId, hold.id, userId).then(
        () => "released",
        (error: unknown) =>
          error instanceof ConflictException ? "409" : String(error),
      );
      const after = await prisma.projectInventoryReservation.findUniqueOrThrow({
        where: { id: hold.id },
      });
      assert.deepEqual(
        [outcome, after.status],
        ["409", "ACTIVE"],
        "RESERVED-BELOW-HOLD-409",
      );
      // leave the row consistent for the reconciliation test
      await prisma.projectInventoryReservation.update({
        where: { id: hold.id },
        data: { status: "RELEASED" },
      });
      await prisma.stockItem.update({
        where: { id: stock.id },
        data: { reserved: D(0) },
      });
    });

    it("closing the project releases every active hold it has", async () => {
      const stock = await stockItem(unasVariantId, otherWarehouseId, 8);
      const projectId = await project("close");
      await receiptHold(projectId, stock, 2);
      await prisma.stockItem.update({
        where: { id: stock.id },
        data: { reserved: { increment: D(3) } },
      });
      await prisma.projectInventoryReservation.create({
        data: {
          projectId,
          origin: "QUOTE_HANDOFF",
          quoteBomItemId: bomItemId,
          stockItemId: stock.id,
          variantId: unasVariantId,
          warehouseId: otherWarehouseId,
          quantity: D(3),
        },
      });
      const answer = await service.close(projectId, "COMPLETED", userId);
      const holds = await prisma.projectInventoryReservation.findMany({
        where: { projectId },
      });
      assert.deepEqual(
        [
          answer.released,
          holds.map((h) => h.status),
          (await prisma.project.findUniqueOrThrow({ where: { id: projectId } }))
            .status,
          (
            await prisma.stockItem.findUniqueOrThrow({
              where: { id: stock.id },
            })
          ).reserved.toString(),
        ],
        [2, ["RELEASED", "RELEASED"], "COMPLETED", "0"],
        "CLOSE-RELEASES-ALL",
      );
    });

    const rejects = (create: Promise<unknown>) =>
      create.then(
        () => "inserted",
        (error: unknown) =>
          String((error as { message?: string }).message ?? error).includes(
            "origin_parent_check",
          )
            ? "check"
            : String(error),
      );

    it("the CHECK refuses a hold with both parents", async () => {
      const stock = await stockItem(localVariantId, otherWarehouseId, 1);
      const projectId = await project("both");
      assert.equal(
        await rejects(
          prisma.projectInventoryReservation.create({
            data: {
              projectId,
              origin: "QUOTE_HANDOFF",
              purchaseInvoiceLineId: lineId,
              quoteBomItemId: bomItemId,
              stockItemId: stock.id,
              variantId: localVariantId,
              warehouseId: otherWarehouseId,
              quantity: D(1),
            },
          }),
        ),
        "check",
        "CHECK-BOTH",
      );
    });

    it("the CHECK refuses a hold with no parent", async () => {
      const projectId = await project("none");
      const stock = await prisma.stockItem.findFirstOrThrow({
        where: { variantId: localVariantId, warehouseId: otherWarehouseId },
      });
      assert.equal(
        await rejects(
          prisma.projectInventoryReservation.create({
            data: {
              projectId,
              origin: "PURCHASE_RECEIPT",
              stockItemId: stock.id,
              variantId: localVariantId,
              warehouseId: otherWarehouseId,
              quantity: D(1),
            },
          }),
        ),
        "check",
        "CHECK-NONE",
      );
    });

    it("a BOM item holds two stock rows, but each one only once", async () => {
      const projectId = await project("bom");
      const first = await prisma.stockItem.findFirstOrThrow({
        where: { variantId: unasVariantId, warehouseId },
      });
      const second = await prisma.stockItem.findFirstOrThrow({
        where: { variantId: unasVariantId, warehouseId: otherWarehouseId },
      });
      const hold = (stock: { id: string; warehouseId: string }) =>
        prisma.projectInventoryReservation.create({
          data: {
            projectId,
            origin: "QUOTE_HANDOFF",
            quoteBomItemId: bomItemId,
            stockItemId: stock.id,
            variantId: unasVariantId,
            warehouseId: stock.warehouseId,
            quantity: D(1),
            // released at once: these rows only test the index
            status: "RELEASED",
          },
        });
      // the close test already holds `second` for this BOM item
      await hold(first);
      const again = await hold(first).then(
        () => "inserted",
        (error: unknown) =>
          (error as { code?: string }).code === "P2002"
            ? "unique"
            : String(error),
      );
      assert.equal(again, "unique", "BOM-INDEX-UNIQUE");
      assert.equal(
        await prisma.projectInventoryReservation.count({
          where: { quoteBomItemId: bomItemId },
        }),
        2,
      );
      void second;
    });

    it("a stock row whose reserved is not its active holds' sum is listed", async () => {
      const off = await stockItem(localVariantId, warehouseId, 5);
      await prisma.stockItem.update({
        where: { id: off.id },
        data: { reserved: D(4) },
      });
      const listed = (await reservedMismatches()).map((m) => m.stockItemId);
      const consistent = await prisma.stockItem.findFirstOrThrow({
        where: { variantId: unasVariantId, warehouseId },
      });
      assert.deepEqual(
        [listed.includes(off.id), listed.includes(consistent.id)],
        [true, false],
        "RESERVED-RECON",
      );
    });

    after(async () => {
      if (gate.mode !== "run") return;
      const variantIds = [unasVariantId, localVariantId].filter(Boolean);
      const holdIds = (
        await prisma.projectInventoryReservation.findMany({
          where: { projectId: { in: projectIds } },
          select: { id: true },
        })
      ).map((h) => h.id);
      await prisma.domainEvent.deleteMany({
        where: { aggregateId: { in: holdIds } },
      });
      await prisma.projectInventoryReservation.deleteMany({
        where: { projectId: { in: projectIds } },
      });
      await prisma.unasStockSyncOutbox.deleteMany({
        where: { variantId: { in: variantIds } },
      });
      await prisma.quoteBomItem.deleteMany({ where: { id: bomItemId } });
      await prisma.quoteItem.deleteMany({
        where: { version: { quoteId } },
      });
      await prisma.quoteBlock.deleteMany({
        where: { version: { quoteId } },
      });
      await prisma.quoteVersion.deleteMany({ where: { quoteId } });
      await prisma.quote.deleteMany({ where: { id: quoteId } });
      await prisma.purchaseInvoiceLine.deleteMany({
        where: { purchaseInvoice: { supplierId } },
      });
      await prisma.purchaseInvoice.deleteMany({ where: { supplierId } });
      await prisma.stockItem.deleteMany({
        where: { warehouseId: { in: [warehouseId, otherWarehouseId] } },
      });
      await prisma.productVariant.deleteMany({
        where: { id: { in: variantIds } },
      });
      await prisma.product.deleteMany({ where: { id: { in: productIds } } });
      await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
      await prisma.auditLog.deleteMany({ where: { userId } });
      await prisma.supplier.deleteMany({ where: { id: supplierId } });
      await prisma.warehouse.deleteMany({
        where: { id: { in: [warehouseId, otherWarehouseId] } },
      });
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
    });
  },
);
