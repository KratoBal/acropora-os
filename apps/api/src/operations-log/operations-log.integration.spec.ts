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
          assets: { create: [{ assetId: ids.asset }] },
          ...over,
        },
        select: { id: true },
      });

    describe("a sablon célja: pontosan egy (eszköz XOR kategória)", () => {
      it("az eszközre és a kategóriára szóló sablon is felvehető", async () => {
        await template("cel-eszkoz");
        await template("cel-kategoria", {
          assets: undefined,
          assetCategoryId: ids.category,
        });
      });

      it("az adatbázis a kategória XOR lista szabályt NEM tartja (táblák közti CHECK nincs), a szolgáltatás igen: a kettő egyszerre vagy egyik sem elutasítva", async () => {
        await assert.rejects(
          service.create(
            {
              name: name("cel-mindketto"),
              frequency: "WEEKLY",
              assetIds: [ids.asset],
              assetCategoryId: ids.category,
              fields: [],
            },
            ids.user,
          ),
          /pontosan egy célra/,
        );
        await assert.rejects(
          service.create(
            {
              name: name("cel-egyik-sem"),
              frequency: "WEEKLY",
              assetIds: [],
              fields: [],
            },
            ids.user,
          ),
          /pontosan egy célra/,
        );
        // és egy elutasított felvétel nem hagy sablont maga után
        assert.equal(
          await prisma.operationsTaskTemplate.count({
            where: {
              name: { in: [name("cel-mindketto"), name("cel-egyik-sem")] },
            },
          }),
          0,
        );
      });

      it("ugyanaz az eszköz ugyanarra a sablonra kétszer nem vehető fel (egyedi index), a sablon törlése viszi a lista sorait", async () => {
        const bound = await template("lista-egyedi");
        await assert.rejects(
          prisma.operationsTaskTemplateAsset.create({
            data: { templateId: bound.id, assetId: ids.asset },
          }),
          /Unique constraint|templateId_assetId/,
        );
        await prisma.operationsTaskTemplate.delete({ where: { id: bound.id } });
        assert.equal(
          await prisma.operationsTaskTemplateAsset.count({
            where: { templateId: bound.id },
          }),
          0,
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
        const bound = await template("restrict", {
          assets: { create: [{ assetId: holder.id }] },
        });
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
          /Unique constraint failed on the fields: \(`templateId`,`meterRole`\)/,
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
          /Unique constraint failed on the fields: \(`templateId`,`meterRole`\)/,
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
          /Unique constraint failed on the fields: \(`templateId`,`key`\)/,
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
            assetIds: [ids.asset],
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
        assert.equal(created.target.kind, "ASSETS");
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
            assetIds: [ids.asset],
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
            assetIds: [ids.asset],
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
              assetIds: [ids.asset],
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

      /*
        A PUT-TAL KIVEZETETT MEZŐ MEGTARTJA A VÍZÓRA SZEREPÉT (barracuda, #2497 v2): a körút kivezetett mezője BOOLEAN, tehát a
        szerep-megtartást a szolgáltatáson át külön kell mérni: egy ELŐTTE mezőt kivenni, és ugyanabban a PUT-ban egy újat felvenni.
        A kivezetés a lenullázás ELŐTT fut: a lenullázás sorrendje fordítva a régi mező szerepét vinné el.
      */
      it("a PUT-ban kivett ELŐTTE mező szerepe megmarad, és ugyanabban a PUT-ban egy új ELŐTTE mező felvehető", async () => {
        const created = await service.create(
          {
            name: name("szerep-megtartas"),
            frequency: "WEEKLY",
            assetIds: [ids.asset],
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
            ],
          },
          "system",
        );
        const after = created.fields.find((f) => f.meterRole === "AFTER")!;
        const updated = await service.update(
          created.id,
          {
            expectedUpdatedAt: created.updatedAt,
            name: name("szerep-megtartas"),
            frequency: "WEEKLY",
            assetIds: [ids.asset],
            fields: [
              {
                key: after.key,
                label: after.label,
                type: "NUMBER",
                unit: "m3",
                meterRole: "AFTER",
              },
              {
                label: "Vízóra új előtte",
                type: "NUMBER",
                unit: "m3",
                meterRole: "BEFORE",
              },
            ],
          },
          "system",
        );
        assert.deepEqual(
          updated.retiredFields.map((f) => [f.key, f.meterRole]),
          [["vizora_elotte", "BEFORE"]],
        );
        assert.deepEqual(
          updated.fields.map((f) => [f.key, f.meterRole]),
          [
            ["vizora_utana", "AFTER"],
            ["vizora_uj_elotte", "BEFORE"],
          ],
        );
      });

      /*
        A TIPUSVALTAS UJ MEZO (barracuda, #2499): a szam mezo szovegre allitva a szerveren kivezetes es uj mezo uj kulccsal; a
        regi mezo definicioja (tipus, mertekegyseg, vizora szerep) olvashato marad.
      */
      it("egy szám mező típusát szövegre állítva a régi mező kivezetve marad, az új más kulcsot kap", async () => {
        const created = await service.create(
          {
            name: name("tipusvaltas"),
            frequency: "WEEKLY",
            assetIds: [ids.asset],
            fields: [
              {
                label: "Vízóra",
                type: "NUMBER",
                unit: "m3",
                meterRole: "BEFORE",
              },
            ],
          },
          "system",
        );
        const old = created.fields[0]!;
        const updated = await service.update(
          created.id,
          {
            expectedUpdatedAt: created.updatedAt,
            name: name("tipusvaltas"),
            frequency: "WEEKLY",
            assetIds: [ids.asset],
            fields: [{ key: old.key, label: "Vízóra", type: "TEXT" }],
          },
          "system",
        );
        assert.deepEqual(
          updated.fields.map((f) => [f.key, f.type]),
          [["vizora_2", "TEXT"]],
        );
        assert.deepEqual(
          updated.retiredFields.map((f) => [
            f.key,
            f.type,
            f.unit,
            f.meterRole,
          ]),
          [["vizora", "NUMBER", "m3", "BEFORE"]],
        );
      });

      it("az egységes rögzítés kapcsolója: alapból kikapcsolt, felvételkor és módosításkor a megadott érték íródik, a nem küldött NEM változtat (card d2222173)", async () => {
        const base = {
          frequency: "WEEKLY" as const,
          assetIds: [ids.asset],
          fields: [],
        };
        const plain = await service.create(
          { ...base, name: name("egyseges-alap") },
          "system",
        );
        assert.equal(plain.uniformRecording, false);
        const on = await service.create(
          { ...base, name: name("egyseges-be"), uniformRecording: true },
          "system",
        );
        assert.equal(on.uniformRecording, true);
        // a kapcsolót nem küldő módosítás (egy régi szerkesztő) nem kapcsolja ki
        const kept = await service.update(
          on.id,
          { ...base, name: name("egyseges-be") },
          "system",
        );
        assert.equal(kept.uniformRecording, true);
        assert.equal((await service.get(on.id)).uniformRecording, true);
        const off = await service.update(
          on.id,
          { ...base, name: name("egyseges-be"), uniformRecording: false },
          "system",
        );
        assert.equal(off.uniformRecording, false);
        const again = await service.update(
          plain.id,
          { ...base, name: name("egyseges-alap"), uniformRecording: true },
          "system",
        );
        assert.equal(again.uniformRecording, true);
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

    /*
      A KEZDŐKÉPERNYŐ SZŰRŐJE (task f6694b49). MINDEN KIZÁRT ESETNEK VAN BEFOGADOTT PÁRJA ugyanabban a fixtúrában: az eszközre szóló
      és a kategóriára szóló aktív sablon is felvesz egy eszközt, a kivezetett sablon, a sablon nélküli eszköz és az archivált eszköz
      pedig nem. Ha a kategória-ág hiányozna, a kategóriás eszköz hiányozna a listából; ha az `isActive` szűrő, a kivezetett sablon
      eszköze benne maradna.
    */
    describe("a sablonnal rendelkező eszközök azonosítói", () => {
      it("az eszközre és a kategóriára szóló aktív sablon felvesz, a kivezetett, a sablon nélküli és az archivált nem", async () => {
        const department = await prisma.worksheetDepartment.findFirstOrThrow({
          where: { name: name("hely") },
          select: { id: true },
        });
        const supplier = await prisma.supplier.findFirstOrThrow({
          where: { code: { startsWith: "UZNI" } },
          select: { id: true },
        });
        const make = (label: string, over: Record<string, unknown> = {}) =>
          prisma.asset.create({
            data: {
              assetNumber: name(label),
              name: name(label),
              departmentId: department.id,
              supplierId: supplier.id,
              ...over,
            },
            select: { id: true },
          });
        const direct = await make("SZ-KOZVETLEN");
        const byCategory = await make("SZ-KATEGORIA", {
          categoryId: ids.category,
        });
        const retired = await make("SZ-KIVEZETETT");
        const bare = await make("SZ-SABLONNELKUL");
        const archived = await make("SZ-ARCHIVALT", {
          categoryId: ids.category,
          archivedAt: new Date(),
        });
        await template("sz-kozvetlen", {
          assets: { create: [{ assetId: direct.id }] },
        });
        await template("sz-kategoria", {
          assets: undefined,
          assetCategoryId: ids.category,
        });
        await template("sz-kivezetett", {
          assets: { create: [{ assetId: retired.id }] },
          isActive: false,
        });
        // egy TÖBBESZKÖZÖS lista: mindkét eszköze felkerül (task t-20261117-sablon-eszkozlista)
        const listA = await make("SZ-LISTA-A");
        const listB = await make("SZ-LISTA-B");
        await template("sz-lista", {
          assets: { create: [{ assetId: listA.id }, { assetId: listB.id }] },
        });

        // a katalógus csak a SZERVIZ-partnerek eszközeit adja (mint az eszköz-lista ownerScope=SERVICE_PARTNER)
        const notService = await repository.startCatalogue();
        assert.equal(
          notService.some((x) => x.id === direct.id),
          false,
          "nem szerviz partner eszköze nem kerülhet a katalógusba",
        );
        await prisma.supplier.update({
          where: { id: supplier.id },
          data: { isService: true },
        });
        const catalogue = await repository.startCatalogue();
        const byId = new Map(catalogue.map((x) => [x.id, x]));
        assert.deepEqual(byId.get(direct.id)?.owner, {
          id: supplier.id,
          displayName: name("szállító"),
        });
        assert.deepEqual(byId.get(direct.id)?.unit.path, [name("hely")]);
        assert.equal(byId.has(byCategory.id), true);
        assert.equal(byId.has(listA.id), true);
        assert.equal(byId.has(listB.id), true);
        assert.equal(byId.has(retired.id), false);
        assert.equal(byId.has(bare.id), false);
        assert.equal(byId.has(archived.id), false);

        const found = new Set(await repository.assetIdsWithActiveTemplates());
        assert.equal(found.has(direct.id), true);
        assert.equal(found.has(byCategory.id), true);
        assert.equal(found.has(listA.id), true);
        assert.equal(found.has(listB.id), true);
        assert.equal(found.has(retired.id), false);
        assert.equal(found.has(bare.id), false);
        assert.equal(found.has(archived.id), false);
      });
    });

    describe("az eszközlista-cél (task t-20261117-sablon-eszkozlista)", () => {
      it("a lista cseréje megtartja a maradó eszköz sorát, elveszi a kimaradtat, felveszi az újat; a sablon csak a listán lévő eszközre szól; kategóriára váltva a lista sorai elmennek", async () => {
        const department = await prisma.worksheetDepartment.findFirstOrThrow({
          where: { name: name("hely") },
          select: { id: true },
        });
        const supplier = await prisma.supplier.findFirstOrThrow({
          where: { code: { startsWith: "UZNI" } },
          select: { id: true },
        });
        const make = (label: string) =>
          prisma.asset.create({
            data: {
              assetNumber: name(label),
              name: name(label),
              departmentId: department.id,
              supplierId: supplier.id,
            },
            select: { id: true },
          });
        const a = await make("LC-A");
        const b = await make("LC-B");
        const c = await make("LC-C");
        const d = await make("LC-D");
        const base = {
          name: name("lista-csere"),
          frequency: "WEEKLY" as const,
          fields: [],
        };

        const created = await service.create(
          { ...base, assetIds: [a.id, b.id] },
          ids.user,
        );
        assert.equal(created.target.kind, "ASSETS");
        const rowsBefore = await prisma.operationsTaskTemplateAsset.findMany({
          where: { templateId: created.id },
          select: { id: true, assetId: true },
        });
        assert.deepEqual(
          rowsBefore.map((r) => r.assetId).sort(),
          [a.id, b.id].sort(),
        );
        const keptRowId = rowsBefore.find((r) => r.assetId === b.id)!.id;

        // csere: a kimarad, b marad, c új
        const replaced = await service.update(
          created.id,
          {
            ...base,
            assetIds: [b.id, c.id],
            expectedUpdatedAt: created.updatedAt,
          },
          ids.user,
        );
        const rowsAfter = await prisma.operationsTaskTemplateAsset.findMany({
          where: { templateId: created.id },
          select: { id: true, assetId: true },
        });
        assert.deepEqual(
          rowsAfter.map((r) => r.assetId).sort(),
          [b.id, c.id].sort(),
        );
        assert.equal(
          rowsAfter.find((r) => r.assetId === b.id)!.id,
          keptRowId,
          "a maradó eszköz sora nem újraíródik",
        );
        assert.equal(replaced.target.kind, "ASSETS");

        // a sablon a listán lévő eszközre szól, a kimaradtra és a kívülállóra nem
        for (const [asset, expected] of [
          [a, false],
          [b, true],
          [c, true],
          [d, false],
        ] as const) {
          const offered = await repository.activeTemplatesForAsset({
            id: asset.id,
            categoryId: null,
          });
          assert.equal(
            offered.some((t) => t.id === created.id),
            expected,
            `eszköz ${asset.id}`,
          );
        }

        // kategóriára váltva a lista sorai elmennek, és vissza
        const toCategory = await service.update(
          created.id,
          {
            ...base,
            assetIds: [],
            assetCategoryId: ids.category,
            expectedUpdatedAt: replaced.updatedAt,
          },
          ids.user,
        );
        assert.equal(toCategory.target.kind, "CATEGORY");
        assert.equal(
          await prisma.operationsTaskTemplateAsset.count({
            where: { templateId: created.id },
          }),
          0,
        );
        const toList = await service.update(
          created.id,
          {
            ...base,
            assetIds: [d.id],
            expectedUpdatedAt: toCategory.updatedAt,
          },
          ids.user,
        );
        assert.equal(toList.target.kind, "ASSETS");
        assert.equal(
          toList.target.kind === "ASSETS" ? toList.target.assets.length : -1,
          1,
        );
      });

      it("az archivált eszköz nem vehető fel a listába, és a fel nem vett lista nem hagy sablont", async () => {
        const department = await prisma.worksheetDepartment.findFirstOrThrow({
          where: { name: name("hely") },
          select: { id: true },
        });
        const supplier = await prisma.supplier.findFirstOrThrow({
          where: { code: { startsWith: "UZNI" } },
          select: { id: true },
        });
        const gone = await prisma.asset.create({
          data: {
            assetNumber: name("LC-ARCH"),
            name: name("LC-ARCH"),
            departmentId: department.id,
            supplierId: supplier.id,
            archivedAt: new Date(),
          },
          select: { id: true },
        });
        await assert.rejects(
          service.create(
            {
              name: name("lista-archivalt"),
              frequency: "WEEKLY",
              assetIds: [ids.asset, gone.id],
              fields: [],
            },
            ids.user,
          ),
          /archivált/,
        );
        assert.equal(
          await prisma.operationsTaskTemplate.count({
            where: { name: name("lista-archivalt") },
          }),
          0,
        );
      });
    });
  },
);
