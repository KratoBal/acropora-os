import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { ConflictException } from "@nestjs/common";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { OperationsLogRepository } from "./operations-log.repository.js";
import { OperationsLogService } from "./operations-log.service.js";

/**
 * AZ ÜZEMELTETÉSI NAPLÓ SABLONJAI VALÓDI POSTGRESEN (task os-uzemeltetesi-naplo, S1; migráció
 * `20261113080000_operations_task_template`).
 *
 * A szolgáltatás ugyanezeket a szabályokat érthető üzenettel adja vissza; ez a teszt azt méri, hogy a szolgáltatást
 * megkerülő írás (egy szkript, egy jövőbeli végpont) sem tud ilyen sort létrehozni: a CHECK-ek és a részleges egyedi index
 * csak az adatbázisban léteznek, mockkal nem mérhetők (`verify-a-migration-without-the-shared-db`).
 *
 * MINDEN TILTOTT ESETNEK VAN ÉRVÉNYES PÁRJA: ha a fixtúra maga lenne hibás, a tiltott eset ugyanúgy elbukna, és a teszt a
 * megkötés nélkül is zöld maradna.
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "UZN-INT-";

describe(
  "az üzemeltetési napló sablonjai adatbázison",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = Date.now() % 1_000_000;
    const repository = new OperationsLogRepository();
    const service = new OperationsLogService(repository);
    const ids = { asset: "", category: "", user: "" };
    const name = (label: string) => `${PREFIX}${label}-${suffix}`;

    async function removeLeftovers() {
      await prisma.operationsTaskTemplate.deleteMany({
        where: { name: { startsWith: PREFIX } },
      });
      await prisma.asset.deleteMany({
        where: { assetNumber: { startsWith: PREFIX } },
      });
      await prisma.worksheetDepartment.deleteMany({
        where: { name: { startsWith: PREFIX } },
      });
      await prisma.customer.deleteMany({
        where: { customerNumber: { startsWith: PREFIX } },
      });
      await prisma.supplier.deleteMany({
        where: { code: { startsWith: "UZNI" } },
      });
      await prisma.assetCategory.deleteMany({
        where: { name: { startsWith: PREFIX } },
      });
    }

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      const customer = await prisma.customer.create({
        data: {
          customerNumber: `${PREFIX}${suffix}`,
          type: "COMPANY",
          displayName: `${PREFIX}vevő ${suffix}`,
        },
        select: { id: true },
      });
      const department = await prisma.worksheetDepartment.create({
        data: {
          customerId: customer.id,
          code: "UZN",
          name: name("hely"),
        },
        select: { id: true },
      });
      const supplier = await prisma.supplier.create({
        data: { code: `UZNI${suffix}`.slice(0, 12), name: name("szállító") },
        select: { id: true },
      });
      ids.asset = (
        await prisma.asset.create({
          data: {
            assetNumber: name("ESZK"),
            name: name("homokszűrő"),
            supplierId: supplier.id,
            departmentId: department.id,
          },
          select: { id: true },
        })
      ).id;
      ids.category = (
        await prisma.assetCategory.create({
          data: { name: name("kategória") },
          select: { id: true },
        })
      ).id;
    });

    after(async () => {
      if (gate.mode === "run") await removeLeftovers();
    });

    const template = (label: string, over: Record<string, unknown> = {}) =>
      prisma.operationsTaskTemplate.create({
        data: {
          name: name(label),
          frequency: "WEEKLY",
          assetId: ids.asset,
          ...over,
        },
        select: { id: true },
      });

    describe("a sablon célja: pontosan egy (eszköz XOR kategória)", () => {
      it("az eszközre és a kategóriára szóló sablon is felvehető", async () => {
        await template("cel-eszkoz");
        await template("cel-kategoria", {
          assetId: null,
          assetCategoryId: ids.category,
        });
      });

      it("a kettő egyszerre, vagy egyik sem: a CHECK elutasítja", async () => {
        await assert.rejects(
          template("cel-mindketto", { assetCategoryId: ids.category }),
          /OperationsTaskTemplate_one_target/,
        );
        await assert.rejects(
          template("cel-egyik-sem", { assetId: null }),
          /OperationsTaskTemplate_one_target/,
        );
      });

      it("az eszköz törlését a hozzá kötött sablon megakadályozza (Restrict)", async () => {
        const holder = await prisma.asset.create({
          data: {
            assetNumber: name("TORLES"),
            name: name("törlendő"),
            departmentId: (
              await prisma.worksheetDepartment.findFirstOrThrow({
                where: { name: name("hely") },
                select: { id: true },
              })
            ).id,
            supplierId: (
              await prisma.supplier.findFirstOrThrow({
                where: { code: { startsWith: "UZNI" } },
                select: { id: true },
              })
            ).id,
          },
          select: { id: true },
        });
        const bound = await template("restrict", { assetId: holder.id });
        await assert.rejects(prisma.asset.delete({ where: { id: holder.id } }));
        await prisma.operationsTaskTemplate.delete({ where: { id: bound.id } });
        await prisma.asset.delete({ where: { id: holder.id } });
      });
    });

    describe("a mező megkötései", () => {
      const field = (templateId: string, over: Record<string, unknown> = {}) =>
        prisma.operationsTaskField.create({
          data: {
            templateId,
            key: `k${Math.random().toString(36).slice(2, 8)}`,
            label: "mező",
            type: "NUMBER",
            ...over,
          },
          select: { id: true },
        });

      it("a mértékegység és a vízóra szerep csak szám mezőn áll", async () => {
        const t = await template("mezo-szam");
        await field(t.id, { unit: "m3", meterRole: "BEFORE" });
        await assert.rejects(
          field(t.id, { type: "BOOLEAN", unit: "m3" }),
          /OperationsTaskField_unit_only_number/,
        );
        await assert.rejects(
          field(t.id, { type: "TEXT", meterRole: "AFTER" }),
          /OperationsTaskField_meter_role_only_number/,
        );
        // az érvényes pár: egység és szerep nélkül a nem szám mező átmegy
        await field(t.id, { type: "BOOLEAN" });
        await field(t.id, { type: "TEXT" });
      });

      it("sablononként egy előtte és egy utána szerep; másik sablonon újra szabad", async () => {
        const t = await template("mezo-szerep");
        await field(t.id, { meterRole: "BEFORE" });
        await field(t.id, { meterRole: "AFTER" });
        await assert.rejects(
          field(t.id, { meterRole: "BEFORE" }),
          /OperationsTaskField_templateId_meterRole_key/,
        );
        // szerep nélküli mezőből több is lehet (a NULL nem számít), és másik sablonon a szerep újra szabad
        await field(t.id);
        await field(t.id);
        const other = await template("mezo-szerep-masik");
        await field(other.id, { meterRole: "BEFORE" });
      });

      it("a kivezetett mező megtartja a szerepét, és nem foglalja a helyet: az aktív szerep újra szabad (barracuda, #2497)", async () => {
        const t = await template("mezo-kivezetett");
        await field(t.id, { meterRole: "BEFORE", removedAt: new Date() });
        // a kivezetett ELŐTTE mellett egy aktív ELŐTTE is felvehető, de egy MÁSODIK aktív már nem
        await field(t.id, { meterRole: "BEFORE" });
        await assert.rejects(
          field(t.id, { meterRole: "BEFORE" }),
          /OperationsTaskField_templateId_meterRole_key/,
        );
        // a kivezetett mező szerepe megmaradt a sorban
        assert.equal(
          await prisma.operationsTaskField.count({
            where: {
              templateId: t.id,
              meterRole: "BEFORE",
              removedAt: { not: null },
            },
          }),
          1,
        );
      });

      it("a kulcs sablononként egyedi", async () => {
        const t = await template("mezo-kulcs");
        await field(t.id, { key: "viz" });
        await assert.rejects(
          field(t.id, { key: "viz" }),
          /OperationsTaskField_templateId_key_key/,
        );
        const other = await template("mezo-kulcs-masik");
        await field(other.id, { key: "viz" });
      });
    });

    describe("a szolgáltatás körút", () => {
      it("felvétel, szerep-csere és átnevezés a kulcsok és azonosítók megtartásával, mező elhagyása, kivezetés", async () => {
        const created = await service.create(
          {
            name: name("korut"),
            description: "heti visszamosás",
            frequency: "WEEKLY",
            assetId: ids.asset,
            fields: [
              {
                label: "Vízóra előtte",
                type: "NUMBER",
                unit: "m3",
                meterRole: "BEFORE",
              },
              {
                label: "Vízóra utána",
                type: "NUMBER",
                unit: "m3",
                meterRole: "AFTER",
              },
              { label: "Rendellenesség", type: "BOOLEAN", required: true },
            ],
          },
          ids.user || "system",
        );
        assert.equal(created.target.kind, "ASSET");
        assert.deepEqual(
          created.fields.map((f) => [f.key, f.sortOrder]),
          [
            ["vizora_elotte", 0],
            ["vizora_utana", 1],
            ["rendellenesseg", 2],
          ],
        );
        const [before, after, anomaly] = created.fields;

        // a két vízóra mező FELCSERÉLI a szerepét és átneveződik, a rendellenesség mező kikerül, egy új jön
        const updated = await service.update(
          created.id,
          {
            name: name("korut"),
            frequency: "DAILY",
            assetId: ids.asset,
            fields: [
              {
                key: after!.key,
                label: "Vízóra (első)",
                type: "NUMBER",
                unit: "m3",
                meterRole: "BEFORE",
              },
              {
                key: before!.key,
                label: "Vízóra (második)",
                type: "NUMBER",
                unit: "m3",
                meterRole: "AFTER",
              },
              { label: "Megjegyzés", type: "TEXT" },
            ],
          },
          "system",
        );
        assert.equal(updated.frequency, "DAILY");
        assert.deepEqual(
          updated.fields.map((f) => [f.id, f.key, f.meterRole]),
          [
            [after!.id, after!.key, "BEFORE"],
            [before!.id, before!.key, "AFTER"],
            [updated.fields[2]!.id, "megjegyzes", null],
          ],
        );
        assert.ok(!updated.fields.some((f) => f.id === anomaly!.id));
        // a kimaradt mező KIVEZETÉST kap, nem törlődik: a definíciója olvasható marad (barracuda, #2497)
        assert.deepEqual(
          updated.retiredFields.map((f) => [f.id, f.key, f.label, f.type]),
          [[anomaly!.id, "rendellenesseg", "Rendellenesség", "BOOLEAN"]],
        );
        assert.notEqual(updated.retiredFields[0]!.removedAt, null);
        assert.equal(
          await prisma.operationsTaskField.count({
            where: { templateId: created.id },
          }),
          4,
        );

        // egy új, azonos címkéjű mező más kulcsot kap, mint a kivezetett: a régi értékek nem az övé lennének
        const again = await service.update(
          created.id,
          {
            expectedUpdatedAt: updated.updatedAt,
            name: name("korut"),
            frequency: "DAILY",
            assetId: ids.asset,
            fields: [
              ...updated.fields.map((f) => ({
                key: f.key,
                label: f.label,
                type: f.type,
                unit: f.unit,
                meterRole: f.meterRole,
              })),
              { label: "Rendellenesség", type: "TEXT" as const },
            ],
          },
          "system",
        );
        const reAdded = again.fields.find((f) => f.label === "Rendellenesség");
        assert.equal(reAdded?.key, "rendellenesseg_2");
        assert.deepEqual(
          again.retiredFields.map((f) => f.key),
          ["rendellenesseg"],
        );

        // az egyidejűség-őr: a régi updatedAt-tal küldött módosítás 409, és semmit nem ír felül
        await assert.rejects(
          service.update(
            created.id,
            {
              expectedUpdatedAt: updated.updatedAt,
              name: name("korut-felulirva"),
              frequency: "DAILY",
              assetId: ids.asset,
              fields: [],
            },
            "system",
          ),
          ConflictException,
        );
        assert.equal((await service.get(created.id)).name, name("korut"));

        assert.deepEqual(await service.retire(created.id, "system"), {
          retired: true,
        });
        const active = (await service.list(false)).items.map((t) => t.id);
        const all = (await service.list(true)).items.map((t) => t.id);
        assert.ok(!active.includes(created.id));
        assert.ok(all.includes(created.id));
        assert.equal((await service.get(created.id)).isActive, false);
      });

      it("kategóriára szóló sablon felvehető, és a cél a kategória nevét adja", async () => {
        const created = await service.create(
          {
            name: name("kategoria-korut"),
            frequency: "OCCASIONAL",
            assetCategoryId: ids.category,
            fields: [],
          },
          "system",
        );
        assert.deepEqual(created.target, {
          kind: "CATEGORY",
          categoryId: ids.category,
          name: name("kategória"),
        });
      });
    });
  },
);
