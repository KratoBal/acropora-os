import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Prisma, prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import {
  inventoryDueProducts,
  MEDUSA_INVENTORY_REFERENCE,
  recordInventoryAttempt,
} from "./medusa-inventory-sync.js";

/**
 * A KÉSZLET-KIKÜLDÉS NYILVÁNTARTÁSA, VALÓDI POSTGRESEN (kártya 54d289d3).
 *
 * A lekérdezések a szerkezetükkel együtt itt futnak le először: a Prisma a lazán
 * típusolt `select`-et nem ellenőrzi, egy elgépelt mező csak itt bukik ki. És a
 * `system_entityType_entityId` kulcsú upsert is csak adatbázison mérhető.
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "INV-SYNC-INT-";

describe(
  "Medusa készlet-kiküldés nyilvántartása adatbázison",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = Date.now() % 1_000_000;
    let warehouseId = "";
    let productId = "";
    let variantId = "";

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      warehouseId = (
        await prisma.warehouse.create({
          data: {
            code: `${PREFIX}WH-${suffix}`,
            name: `${PREFIX}raktar-${suffix}`,
          },
        })
      ).id;
      productId = (
        await prisma.product.create({
          data: { name: `${PREFIX}termek-${suffix}` },
        })
      ).id;
      variantId = (
        await prisma.productVariant.create({
          data: { productId, sku: `${PREFIX}SKU-${suffix}` },
        })
      ).id;
      await prisma.externalReference.create({
        data: {
          system: "MEDUSA",
          entityType: "Product",
          entityId: productId,
          externalId: `prod_${PREFIX}${suffix}`,
        },
      });
      await prisma.stockItem.create({
        data: {
          variantId,
          warehouseId,
          onHand: new Prisma.Decimal(3),
          reserved: new Prisma.Decimal(0),
        },
      });
    });

    after(removeLeftovers);

    async function removeLeftovers() {
      await prisma.externalReference.deleteMany({
        where: { externalId: { startsWith: `prod_${PREFIX}` } },
      });
      await prisma.stockItem.deleteMany({
        where: { variant: { sku: { startsWith: PREFIX } } },
      });
      await prisma.productVariant.deleteMany({
        where: { sku: { startsWith: PREFIX } },
      });
      await prisma.product.deleteMany({
        where: { name: { startsWith: PREFIX } },
      });
      await prisma.warehouse.deleteMany({
        where: { name: { startsWith: PREFIX } },
      });
    }

    const dueIds = async (now: Date) =>
      (await inventoryDueProducts(prisma as never, warehouseId, 500, now))
        .map((row) => row.productId)
        .filter((id) => id === productId);

    it("a vetített, még ki nem küldött termék esedékes", async () => {
      assert.deepEqual(await dueIds(new Date()), [productId]);
    });

    it("sikeres kiküldés után nem esedékes, készletváltozás után újra igen", async () => {
      const startedAt = new Date(Date.now() + 1000);
      await recordInventoryAttempt(prisma as never, {
        productId,
        medusaProductId: `prod_${PREFIX}${suffix}`,
        startedAt,
        failure: null,
      });
      const ref = await prisma.externalReference.findUnique({
        where: {
          system_entityType_entityId: {
            ...MEDUSA_INVENTORY_REFERENCE,
            entityId: productId,
          },
        },
      });
      assert.deepEqual(ref?.lastSyncedAt, startedAt);
      assert.deepEqual(await dueIds(new Date(startedAt.getTime() + 1000)), []);

      await new Promise((resolve) => setTimeout(resolve, 1200));
      await prisma.stockItem.updateMany({
        where: { variantId },
        data: { onHand: new Prisma.Decimal(5) },
      });
      assert.deepEqual(await dueIds(new Date()), [productId]);
    });

    it("kudarc után az ok rögzül, a sikeres időpont nem mozdul", async () => {
      const before = await prisma.externalReference.findUnique({
        where: {
          system_entityType_entityId: {
            ...MEDUSA_INVENTORY_REFERENCE,
            entityId: productId,
          },
        },
      });
      await recordInventoryAttempt(prisma as never, {
        productId,
        medusaProductId: `prod_${PREFIX}${suffix}`,
        startedAt: new Date(),
        failure: "SKU: variant-not-found",
      });
      const after = await prisma.externalReference.findUnique({
        where: {
          system_entityType_entityId: {
            ...MEDUSA_INVENTORY_REFERENCE,
            entityId: productId,
          },
        },
      });
      assert.deepEqual(after?.lastSyncedAt, before?.lastSyncedAt);
      assert.match(JSON.stringify(after?.metadata), /variant-not-found/);
    });
  },
);
