import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { ensureMainWarehouse } from "../common/warehouse.util.js";
import { MORTALITY_REFERENCE_TYPE } from "./mortality-stock.js";
import { MortalityRepository } from "./mortality.repository.js";

/**
 * AZ ELHULLÁSI NAPLÓ ADATBÁZIS-MEGKÖTÉSEI (kártya 115c9740, migrációk
 * `20261006200000_mortality_log` és `20261007140000_mortality_occurred_on_and_location`),
 * VALÓDI POSTGRESEN.
 *
 * A szolgáltatás ugyanezt a három szabályt érthető üzenettel adja vissza; ez a
 * teszt azt méri, hogy a szolgáltatást megkerülő írás (egy szkript, egy jövőbeli
 * végpont) sem tud ilyen sort létrehozni. Mockkal ez nem mérhető: a CHECK csak
 * az adatbázisban létezik (barracuda átvételi listája, 2026-10-06).
 *
 * MINDEN TILTOTT ESETNEK VAN ÉRVÉNYES PÁRJA: ha a fixtúra maga lenne hibás
 * (hiányzó kötelező mező, rossz idegen kulcs), a tiltott eset ugyanúgy
 * elbukna, és a teszt zöld maradna a CHECK nélkül is.
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "ELH-INT-";
const EMAIL_DOMAIN = "mortality-integration.invalid";

describe(
  "MortalityRecord adatbázis-megkötései",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = Date.now() % 1_000_000;
    const ids = { product: "", aquarium: "", supplier: "", user: "" };
    /**
     * HA A KÉSZLET-PRÓBA HOZTA LÉTRE A FŐ RAKTÁRT, A VÉGÉN EL IS TÜNTETI. Az
     * `ensureMainWarehouse` a LEGRÉGEBBI raktárat adja; egy itt hagyott raktár a
     * közös CI-adatbázison a következő spec-ek fő raktára lenne, és azok a saját
     * raktárukon hiába keresnék a készletet (mérve a #1578 CI-jén: a
     * `unas-order-sync.repository.integration.spec` két tesztje bukott el így).
     */
    let createdWarehouseId: string | null = null;
    let counter = 0;

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      ids.product = (
        await prisma.product.create({
          data: { name: `${PREFIX}hal-${suffix}` },
        })
      ).id;
      ids.aquarium = (
        await prisma.aquarium.create({
          data: {
            aquariumNumber: `${PREFIX}AKV-${suffix}`,
            name: `${PREFIX}akvarium-${suffix}`,
            ownershipType: "OWN",
          },
        })
      ).id;
      ids.supplier = (
        await prisma.supplier.create({
          data: { code: `${PREFIX}SUP-${suffix}`, name: `${PREFIX}beszallito` },
        })
      ).id;
      ids.user = (
        await prisma.user.create({
          data: {
            email: `rogzito-${suffix}@${EMAIL_DOMAIN}`,
            displayName: "Elhullás Rögzítő",
            role: "SERVICE",
            isActive: true,
          },
        })
      ).id;
    });

    after(removeLeftovers);

    async function removeLeftovers() {
      // a készlet-próba nyomai: a mozgások (a soraikkal), a kimenet, a készletsor
      const records = await prisma.mortalityRecord.findMany({
        where: {
          OR: [
            { recordNumber: { startsWith: PREFIX } },
            { aquarium: { name: { startsWith: PREFIX } } },
          ],
        },
        select: { id: true },
      });
      await prisma.stockMovement.deleteMany({
        where: {
          referenceType: MORTALITY_REFERENCE_TYPE,
          referenceId: { in: records.map((r) => r.id) },
        },
      });
      const variants = await prisma.productVariant.findMany({
        where: { sku: { startsWith: PREFIX } },
        select: { id: true },
      });
      const variantIds = variants.map((v) => v.id);
      await prisma.unasStockSyncOutbox.deleteMany({
        where: { variantId: { in: variantIds } },
      });
      await prisma.stockItem.deleteMany({
        where: { variantId: { in: variantIds } },
      });
      // a módosítás auditnaplót ír a rögzítőre: a felhasználó csak utána törölhető
      await prisma.auditLog.deleteMany({
        where: {
          entityType: "MortalityRecord",
          entityId: { in: records.map((r) => r.id) },
        },
      });
      await prisma.mortalityRecord.deleteMany({
        where: { id: { in: records.map((r) => r.id) } },
      });
      await prisma.productVariant.deleteMany({
        where: { id: { in: variantIds } },
      });
      if (createdWarehouseId) {
        await prisma.warehouse.delete({ where: { id: createdWarehouseId } });
        createdWarehouseId = null;
      }
      await prisma.aquarium.deleteMany({
        where: { name: { startsWith: PREFIX } },
      });
      await prisma.product.deleteMany({
        where: { name: { startsWith: PREFIX } },
      });
      await prisma.supplier.deleteMany({
        where: { code: { startsWith: PREFIX } },
      });
      await prisma.user.deleteMany({
        where: { email: { endsWith: `@${EMAIL_DOMAIN}` } },
      });
    }

    function record(
      over: Partial<{
        quantity: number;
        sourceType:
          "SUPPLIER" | "LOCAL_BREEDER" | "TRADE" | "OWN_BREEDING" | "OTHER";
        supplierId: string | null;
        sourceNote: string | null;
        productId: string | null;
        productName: string | null;
        aquariumId: string | null;
        locationId: string | null;
      }>,
    ) {
      counter += 1;
      return prisma.mortalityRecord.create({
        data: {
          recordNumber: `${PREFIX}${suffix}-${counter}`,
          productId: ids.product,
          aquariumId: ids.aquarium,
          recordedById: ids.user,
          quantity: 1,
          sourceType: "TRADE",
          supplierId: null,
          sourceNote: null,
          occurredOn: new Date("2026-10-07T00:00:00Z"),
          ...over,
        },
      });
    }

    /** A Prisma a CHECK-sértést `P2010`/nyers hibaként adja; a név a lényeg. */
    async function rejectedBy(constraint: string, write: Promise<unknown>) {
      await assert.rejects(write, (error: Error) => {
        assert.match(String(error.message), new RegExp(constraint));
        return true;
      });
    }

    it("a példányszám legalább 1", async () => {
      await record({ quantity: 1 });
      await rejectedBy(
        "MortalityRecord_quantity_check",
        record({ quantity: 0 }),
      );
    });

    it("beszállítói forráshoz a beszállító VAGY a neve kell, pontosan az egyik; máshoz beszállító tilos", async () => {
      await record({ sourceType: "SUPPLIER", supplierId: ids.supplier });
      // Balázs 2026-10-07: a rendszerben nem szereplő beszállító neve
      await record({ sourceType: "SUPPLIER", sourceNote: "Kis Pál" });
      await rejectedBy(
        "MortalityRecord_supplier_check",
        record({ sourceType: "SUPPLIER", supplierId: null }),
      );
      await rejectedBy(
        "MortalityRecord_supplier_check",
        record({ sourceType: "SUPPLIER", supplierId: null, sourceNote: "  " }),
      );
      await rejectedBy(
        "MortalityRecord_supplier_check",
        record({
          sourceType: "SUPPLIER",
          supplierId: ids.supplier,
          sourceNote: "Kis Pál",
        }),
      );
      await rejectedBy(
        "MortalityRecord_supplier_check",
        record({ sourceType: "TRADE", supplierId: ids.supplier }),
      );
    });

    it("az élőlény a termék VAGY a szabad szöveges név, pontosan az egyik", async () => {
      await record({ productId: null, productName: "Ismeretlen gébféle" });
      await rejectedBy(
        "MortalityRecord_product_check",
        record({ productId: null, productName: null }),
      );
      await rejectedBy(
        "MortalityRecord_product_check",
        record({ productId: null, productName: "   " }),
      );
      await rejectedBy(
        "MortalityRecord_product_check",
        record({ productName: "és a termék is" }),
      );
    });

    it("az akvárium VAGY a halas rack kell, legalább az egyik", async () => {
      const [rack] = await new MortalityRepository().locationOptions();
      await record({ aquariumId: null, locationId: rack!.id });
      await record({ locationId: rack!.id });
      await record({ locationId: null });
      await rejectedBy(
        "MortalityRecord_place_check",
        record({ aquariumId: null, locationId: null }),
      );
    });

    it("az „Egyéb” forráshoz kötelező a megnevezés, a szóköz nem az", async () => {
      await record({ sourceType: "OTHER", sourceNote: "Pista" });
      await rejectedBy(
        "MortalityRecord_other_note_check",
        record({ sourceType: "OTHER", sourceNote: null }),
      );
      await rejectedBy(
        "MortalityRecord_other_note_check",
        record({ sourceType: "OTHER", sourceNote: "   " }),
      );
    });

    /**
     * A HALAS RACKEK KEZDŐ LISTÁJA A MIGRÁCIÓBÓL JÖN (Luca, 2026-10-07), nem a
     * kódból: a választó végpontja ezt adja, ebben a sorrendben.
     */
    it("a migráció a tíz halas racket tölti fel, a választó ebben a sorrendben adja", async () => {
      const names = (await new MortalityRepository().locationOptions()).map(
        (location) => location.name,
      );
      assert.deepEqual(names, [
        "JOBB 1. oszlop",
        "JOBB 2. oszlop",
        "JOBB 3. oszlop",
        "JOBB 4. oszlop",
        "JOBB 5. oszlop",
        "JOBB 6. oszlop",
        "Jobb hátsó nagy halas",
        "Bal hátsó nagy halas (dühöngő)",
        "Rákos 1",
        "Rákos 2",
      ]);
    });

    it("az elhullás napja és a halas rack a részletben visszajön, a módosítás naplózza a napot", async () => {
      const repository = new MortalityRepository();
      const [rack] = await repository.locationOptions();
      const created = await record({});
      await repository.update(
        created.id,
        { occurredOn: new Date("2026-10-03T00:00:00Z"), locationId: rack!.id },
        ids.user,
      );
      const detail = await repository.detail(created.id);
      assert.equal(detail?.occurredOn, "2026-10-03");
      assert.deepEqual(detail?.location, { id: rack!.id, name: rack!.name });
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { entityType: "MortalityRecord", entityId: created.id },
        select: { metadata: true },
      });
      assert.deepEqual(
        (audit.metadata as { changes: Record<string, unknown> }).changes
          .occurredOn,
        { from: "2026-10-07", to: "2026-10-03" },
      );
    });

    /**
     * A KÉSZLET VALÓDI ÚTJA: a repository a központi írón át von le, UNAS-gazdájú
     * terméknél a UNAS-kimenetre is ír, és a módosítás pontosan a különbséget
     * mozgatja. Mockkal nem mérhető: a zár, a készletsor és a kimenet sora mind
     * az adatbázisban él.
     */
    it("rögzítés, módosítás, szabad szövegre váltás: 10 -> 8 -> 7 -> 10, UNAS-kimenettel", async () => {
      const repository = new MortalityRepository();
      const product = await prisma.product.create({
        data: {
          name: `${PREFIX}keszlet-hal-${suffix}`,
          catalogAuthority: "UNAS",
        },
      });
      const variant = await prisma.productVariant.create({
        data: { productId: product.id, sku: `${PREFIX}SKU-${suffix}` },
      });
      const existing = await prisma.warehouse.findFirst({
        select: { id: true },
      });
      const warehouse = await ensureMainWarehouse(prisma);
      if (!existing) createdWarehouseId = warehouse.id;
      await prisma.stockItem.create({
        data: { variantId: variant.id, warehouseId: warehouse.id, onHand: 10 },
      });
      const onHand = async () =>
        (
          await prisma.stockItem.findFirstOrThrow({
            where: { variantId: variant.id, warehouseId: warehouse.id },
          })
        ).onHand.toNumber();

      const { id } = await repository.create({
        productId: product.id,
        productName: null,
        quantity: 2,
        aquariumId: ids.aquarium,
        sourceType: "TRADE",
        supplierId: null,
        sourceNote: null,
        note: null,
        occurredOn: new Date("2026-10-07T00:00:00Z"),
        locationId: null,
        recordedById: ids.user,
      });
      assert.equal(await onHand(), 8);

      await repository.update(id, { quantity: 3 }, ids.user);
      assert.equal(await onHand(), 7);

      // ugyanaz még egyszer: nincs változás, nincs új mozgás
      await repository.update(id, { quantity: 3 }, ids.user);
      assert.equal(await onHand(), 7);

      await repository.update(
        id,
        { productId: null, productName: "Mégsem ez volt" },
        ids.user,
      );
      assert.equal(await onHand(), 10);

      const movements = await prisma.stockMovement.findMany({
        where: { referenceType: MORTALITY_REFERENCE_TYPE, referenceId: id },
        orderBy: { createdAt: "asc" },
        select: { type: true, lines: { select: { quantity: true } } },
      });
      assert.deepEqual(
        movements.map((m) => [m.type, m.lines[0]!.quantity.toNumber()]),
        [
          ["SCRAP", 2],
          ["SCRAP", 1],
          ["RETURN_IN", 3],
        ],
      );
      const outbox = await prisma.unasStockSyncOutbox.findMany({
        where: { variantId: variant.id },
        select: { sourceProcess: true },
      });
      assert.ok(outbox.length >= 1);
      assert.ok(outbox.every((row) => row.sourceProcess === "MORTALITY"));

      const detail = await repository.detail(id);
      assert.deepEqual(detail?.stock, {
        deducted: 0,
        sku: null,
        reason: "FREE_TEXT",
      });
    });
  },
);
