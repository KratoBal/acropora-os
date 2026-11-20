import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { BadRequestException } from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { nincsMaradek } from "../common/takaritas-leltar.js";
import { ensureMainWarehouse } from "../common/warehouse.util.js";
import {
  POS_INTERNAL_USE_REFERENCE_TYPE,
  PosInternalUseRepository,
} from "./pos-internal-use.repository.js";
import { PosInternalUseService } from "./pos-internal-use.service.js";
import { budapestDay } from "./pos-payment-summary.js";
import { PosSaleRepository } from "./pos-sale.repository.js";

/*
  THE POS "BELSŐ FELHASZNÁLÁS" ON THE REAL DATABASE (card ec51e614). WHAT TURNS IT RED: the stock not decreasing, or decreasing
  under another movement type or without its reference back to the record; no UNAS outbox row (the shop's stock would not
  follow); a SalesOrder written (the revenue summaries read those); the purchase value missing where a POSTED purchase line
  exists, or a zero instead of "unknown" where none exists; a refused request (empty note) leaving any row behind.
*/
const gate = integrationDatabaseGate(process.env);
const D = (value: number | string) => new Prisma.Decimal(value);

describe(
  "a POS belső felhasználás valódi adatbázison",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = `${Date.now()}`;
    const productIds: string[] = [];
    let userId = "";
    let supplierId = "";
    let warehouseId = "";
    let pricedVariantId = "";
    let unpricedVariantId = "";
    const service = new PosInternalUseService(
      new PosSaleRepository(),
      new PosInternalUseRepository(),
    );

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      warehouseId = (await ensureMainWarehouse(prisma)).id;
      userId = (
        await prisma.user.create({
          data: {
            email: `bfh-${suffix}@example.test`,
            displayName: "BFH teszt",
            role: "ADMIN",
          },
        })
      ).id;
      supplierId = (
        await prisma.supplier.create({
          data: { code: `BFH-${suffix}`, name: "BFH beszállító" },
        })
      ).id;
      for (const label of ["priced", "unpriced"] as const) {
        const product = await prisma.product.create({
          data: { name: `BFH-${suffix} ${label}`, catalogAuthority: "UNAS" },
        });
        productIds.push(product.id);
        const variant = await prisma.productVariant.create({
          data: { productId: product.id, sku: `BFH-${suffix}-${label}` },
        });
        await prisma.stockItem.create({
          data: { variantId: variant.id, warehouseId, onHand: D(10) },
        });
        if (label === "priced") pricedVariantId = variant.id;
        else unpricedVariantId = variant.id;
      }
      await prisma.purchaseInvoice.create({
        data: {
          documentNumber: `BFH-${suffix}`,
          supplierInvoiceNumber: `BFH-${suffix}`,
          source: "HU_MANUAL",
          status: "POSTED",
          supplierId,
          warehouseId,
          invoiceDate: new Date("2026-10-08T00:00:00Z"),
          lines: {
            create: [
              {
                variantId: pricedVariantId,
                orderedQuantity: D(10),
                actualQuantity: D(10),
                unit: "db",
                unitNet: D(1000),
              },
            ],
          },
        },
      });
    });

    after(async () => {
      const variantIds = [pricedVariantId, unpricedVariantId].filter(Boolean);
      const records = await prisma.posInternalUse.findMany({
        where: { performedById: userId },
        select: { id: true },
      });
      await prisma.stockMovement.deleteMany({
        where: {
          referenceType: POS_INTERNAL_USE_REFERENCE_TYPE,
          referenceId: { in: records.map((r) => r.id) },
        },
      });
      await prisma.unasStockSyncOutbox.deleteMany({
        where: { variantId: { in: variantIds } },
      });
      await prisma.posInternalUse.deleteMany({
        where: { performedById: userId },
      });
      await prisma.purchaseInvoiceLine.deleteMany({
        where: { purchaseInvoice: { supplierId } },
      });
      await prisma.purchaseInvoice.deleteMany({ where: { supplierId } });
      await prisma.stockItem.deleteMany({
        where: { variantId: { in: variantIds } },
      });
      await prisma.productVariant.deleteMany({
        where: { id: { in: variantIds } },
      });
      await prisma.product.deleteMany({ where: { id: { in: productIds } } });
      await prisma.supplier.deleteMany({ where: { id: supplierId } });
      await prisma.user.deleteMany({ where: { id: userId } });
      nincsMaradek([
        {
          nev: "a belső felhasználás teszt-sorai bent maradtak",
          darab: await prisma.posInternalUse.count({
            where: { note: { startsWith: `BFH-${suffix}` } },
          }),
        },
      ]);
    });

    it("csökkenti a készletet INTERNAL_USE mozgással, UNAS-kimenő sorral, beszerzési értékkel, és nem ír eladást", async () => {
      const salesBefore = await prisma.salesOrder.count({
        where: { soldById: userId },
      });
      const result = await service.create(
        {
          note: `  BFH-${suffix} műhely, szivattyú-próba  `,
          lines: [
            { variantId: pricedVariantId, quantity: 1 },
            { variantId: pricedVariantId, quantity: 1 },
          ],
        },
        userId,
      );
      assert.match(result.detail.number, /^BFH-/);
      assert.deepEqual(
        [
          result.detail.note,
          result.detail.performedByName,
          result.detail.totalCost,
          result.detail.lines.map((l) => [
            l.sku,
            l.quantity,
            l.unitCost,
            l.lineCost,
          ]),
        ],
        [
          `BFH-${suffix} műhely, szivattyú-próba`,
          "BFH teszt",
          "2000.00",
          [[`BFH-${suffix}-priced`, "2", "1000.00", "2000.00"]],
        ],
      );
      const stock = await prisma.stockItem.findFirstOrThrow({
        where: { variantId: pricedVariantId, warehouseId },
      });
      assert.equal(stock.onHand.toString(), "8");
      const movements = await prisma.stockMovement.findMany({
        where: {
          referenceType: POS_INTERNAL_USE_REFERENCE_TYPE,
          referenceId: result.detail.id,
        },
        include: { lines: true },
      });
      assert.deepEqual(
        movements.map((m) => [
          m.type,
          m.status,
          m.lines.map((l) => [l.variantId, l.quantity.toString()]),
        ]),
        [["INTERNAL_USE", "POSTED", [[pricedVariantId, "2"]]]],
      );
      const outbox = await prisma.unasStockSyncOutbox.findMany({
        where: { variantId: pricedVariantId },
      });
      assert.deepEqual(
        outbox.map((o) => [
          o.sourceProcess,
          o.sourceRecordId,
          o.targetOnHand.toString(),
        ]),
        // the outbox row points at the record (the writer passes `referenceId` as `sourceRecordId`)
        [["POS_INTERNAL_USE", result.detail.id, "8"]],
      );
      assert.equal(
        await prisma.salesOrder.count({ where: { soldById: userId } }),
        salesBefore,
      );
    });

    it("beszerzési ár nélkül a tétel és az összérték ismeretlen, nem nulla", async () => {
      const result = await service.create(
        {
          note: `BFH-${suffix} kirakat`,
          lines: [
            { variantId: unpricedVariantId, quantity: 1 },
            { variantId: pricedVariantId, quantity: 1 },
          ],
        },
        userId,
      );
      assert.deepEqual(
        [
          result.detail.totalCost,
          result.detail.lines
            .map((l) => [l.sku, l.unitCost, l.lineCost])
            .sort(),
        ],
        [
          null,
          [
            [`BFH-${suffix}-priced`, "1000.00", "1000.00"],
            [`BFH-${suffix}-unpriced`, null, null],
          ],
        ],
      );
    });

    it("üres megjegyzéssel nem ír semmit", async () => {
      const before = await prisma.posInternalUse.count({
        where: { performedById: userId },
      });
      await assert.rejects(
        service.create(
          { note: "   ", lines: [{ variantId: pricedVariantId, quantity: 1 }] },
          userId,
        ),
        BadRequestException,
      );
      assert.equal(
        await prisma.posInternalUse.count({ where: { performedById: userId } }),
        before,
      );
      const stock = await prisma.stockItem.findFirstOrThrow({
        where: { variantId: pricedVariantId, warehouseId },
      });
      assert.equal(stock.onHand.toString(), "7");
    });

    it("a lista és a részlet a rögzítetteket adja, az újabbat elöl", async () => {
      const list = await service.list({
        page: 1,
        pageSize: 100,
      } as never);
      const mine = list.items.filter((item) =>
        item.note.startsWith(`BFH-${suffix}`),
      );
      assert.deepEqual(
        mine.map((item) => [item.note, item.lineCount, item.totalCost]),
        [
          [`BFH-${suffix} kirakat`, 2, null],
          [`BFH-${suffix} műhely, szivattyú-próba`, 1, "2000.00"],
        ],
      );
      const detail = await service.getDetail(mine[1]!.id);
      assert.equal(detail.lines.length, 1);
    });

    // kártya ada14a7c: az időszakos összesítő a valódi adatbázison; a két nap a futás éjféli átfordulása miatt
    it("az időszakos összesítő a rögzítéseket és az ár nélküli tételt adja, az ismert értékben csak az árazott tételek", async () => {
      const now = new Date();
      const summary = await service.summary(
        {
          from: budapestDay(new Date(now.getTime() - 86_400_000)),
          to: budapestDay(now),
        },
        now,
      );
      const mine = summary.records.filter((record) =>
        record.note.startsWith(`BFH-${suffix}`),
      );
      assert.deepEqual(
        mine.map((record) => [
          record.note,
          record.totalCost,
          record.unpricedLineCount,
        ]),
        [
          [`BFH-${suffix} kirakat`, null, 1],
          [`BFH-${suffix} műhely, szivattyú-próba`, "2000.00", 0],
        ],
      );
      assert.deepEqual(
        summary.unpricedLines
          .filter((line) => line.sku.startsWith(`BFH-${suffix}`))
          .map((line) => [line.sku, line.quantity]),
        [[`BFH-${suffix}-unpriced`, "1"]],
      );
      // a saját három árazott tételünk (2 + 1 db, 1000 Ft) benne van; a többi teszt sorai is lehetnek mellette
      assert.ok(Number(summary.knownCost) >= 3000, summary.knownCost);
    });
  },
);
