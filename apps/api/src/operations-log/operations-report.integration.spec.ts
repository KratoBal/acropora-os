import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { OperationsReportRepository } from "./operations-report.repository.js";
import { OperationsReportService } from "./operations-report.service.js";

/**
 * A HAVI KIMUTATÁS ADATAI VALÓDI POSTGRESEN (task os-uzemeltetesi-naplo, S4). A számítást a közös, adatbázis nélkül mérhető
 * `buildOperationsReport` végzi (`packages/types`); ez a teszt azt méri, amit mockkal nem lehet: a helyszín RÉSZFÁJA (a „Biodóm"
 * a Nagy medencén lógó eszközt is magában foglalja, a másik helyszín eszköze nem), a kategória-sablon KIBONTÁSA eszközönként, a
 * bejegyzések a hónap előtti hét nappal együtt, és a vízóra-különbség a tárolt pillanatfelvételből (Decimal) számolva.
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "UZR-INT-";

describe(
  "a havi kimutatás adatai adatbázison",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = Date.now() % 1_000_000;
    const repository = new OperationsReportRepository();
    const service = new OperationsReportService(repository);
    const ids = {
      root: "",
      child: "",
      other: "",
      insideAsset: "",
      childAsset: "",
      outsideAsset: "",
      template: "",
      user: "",
    };
    const name = (label: string) => `${PREFIX}${label}-${suffix}`;

    async function removeLeftovers() {
      await prisma.operationsLogEntry.deleteMany({
        where: { templateName: { startsWith: PREFIX } },
      });
      await prisma.operationsTaskTemplate.deleteMany({
        where: { name: { startsWith: PREFIX } },
      });
      await prisma.asset.deleteMany({
        where: { assetNumber: { startsWith: PREFIX } },
      });
      await prisma.worksheetDepartment.updateMany({
        where: { name: { startsWith: PREFIX } },
        data: { parentId: null },
      });
      await prisma.worksheetDepartment.deleteMany({
        where: { name: { startsWith: PREFIX } },
      });
      await prisma.customer.deleteMany({
        where: { customerNumber: { startsWith: PREFIX } },
      });
      await prisma.supplier.deleteMany({
        where: { code: { startsWith: "UZRI" } },
      });
      await prisma.assetCategory.deleteMany({
        where: { name: { startsWith: PREFIX } },
      });
      await prisma.user.deleteMany({
        where: { email: { startsWith: PREFIX.toLowerCase() } },
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
      const department = (label: string, parentId: string | null = null) =>
        prisma.worksheetDepartment.create({
          data: {
            customerId: customer.id,
            code: label.slice(0, 5).toUpperCase(),
            name: name(label),
            parentId,
          },
          select: { id: true },
        });
      ids.root = (await department("Biodom")).id;
      ids.child = (await department("Nagy", ids.root)).id;
      ids.other = (await department("Masik")).id;
      const supplier = await prisma.supplier.create({
        data: { code: `UZRI${suffix}`.slice(0, 12), name: name("szállító") },
        select: { id: true },
      });
      const category = await prisma.assetCategory.create({
        data: { name: name("kategória") },
        select: { id: true },
      });
      const asset = (label: string, departmentId: string) =>
        prisma.asset
          .create({
            data: {
              assetNumber: name(label),
              name: name(`név-${label}`),
              supplierId: supplier.id,
              departmentId,
              categoryId: category.id,
            },
            select: { id: true },
          })
          .then((row) => row.id);
      ids.insideAsset = await asset("BENT", ids.root);
      ids.childAsset = await asset("RESZ", ids.child);
      ids.outsideAsset = await asset("KINT", ids.other);
      ids.user = (
        await prisma.user.create({
          data: {
            email: `${PREFIX.toLowerCase()}${suffix}@example.invalid`,
            displayName: `${PREFIX}kolléga`,
            role: "SERVICE",
          },
          select: { id: true },
        })
      ).id;
      // a KATEGÓRIÁRA szóló napi sablon: minden ilyen kategóriájú eszközre külön esedékes
      ids.template = (
        await prisma.operationsTaskTemplate.create({
          data: {
            name: name("sablon"),
            frequency: "DAILY",
            assetCategoryId: category.id,
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
          },
          select: { id: true },
        })
      ).id;
      const entry = (
        assetId: string,
        startedAt: string,
        meterBefore: number,
        meterAfter: number,
      ) =>
        prisma.operationsLogEntry.create({
          data: {
            templateId: ids.template,
            assetId,
            templateName: name("sablon"),
            frequency: "DAILY",
            startedAt: new Date(startedAt),
            finishedAt: new Date(new Date(startedAt).getTime() + 30 * 60_000),
            recordedById: ids.user,
            participants: { create: [{ userId: ids.user }] },
            values: {
              create: [
                {
                  fieldKey: "elotte",
                  fieldType: "NUMBER",
                  label: "Előtte",
                  unit: "m3",
                  meterRole: "BEFORE",
                  numberValue: meterBefore,
                },
                {
                  fieldKey: "utana",
                  fieldType: "NUMBER",
                  label: "Utána",
                  unit: "m3",
                  meterRole: "AFTER",
                  numberValue: meterAfter,
                },
              ],
            },
          },
          select: { id: true },
        });
      await entry(ids.insideAsset, "2026-09-10T09:00:00.000Z", 100, 112.5);
      await entry(ids.childAsset, "2026-09-11T09:00:00.000Z", 200, 207.25);
      await entry(ids.outsideAsset, "2026-09-12T09:00:00.000Z", 1, 2);
    });

    after(async () => {
      if (gate.mode === "run") await removeLeftovers();
    });

    const NOW = new Date("2026-11-20T09:00:00.000Z");

    it("a helyszín részfája a Nagy medencén lógó eszközt is tartalmazza, a másik helyszín eszközét nem", async () => {
      const scope = await repository.scope({ departmentId: ids.root });
      assert.ok(scope);
      assert.deepEqual(
        scope.assets.map((asset) => asset.id).sort(),
        [ids.insideAsset, ids.childAsset].sort(),
      );
      assert.match(scope.siteLabel ?? "", /Biodom/);
      assert.equal(await repository.scope({ departmentId: "nincs" }), null);
      assert.equal(
        (await repository.scope({ assetId: ids.outsideAsset }))?.assets.length,
        1,
      );
    });

    it("a kimutatás a hatókör bejegyzéseit számolja: a vízóra-különbség a tárolt értékből, a másik helyszín nem szerepel", async () => {
      const { report } = await service.build(
        { month: "2026-09", departmentId: ids.root },
        "INTERNAL",
        NOW,
      );
      assert.equal(report.totals.entries, 2);
      assert.equal(report.totals.totalMinutes, 60);
      const totals = Object.fromEntries(
        report.assets.map((block) => [block.assetId, block.meterTotal]),
      );
      assert.equal(totals[ids.insideAsset], 12.5);
      assert.equal(totals[ids.childAsset], 7.25);
      assert.equal(totals[ids.outsideAsset], undefined);
    });

    it("a kategória-sablon eszközönként külön esedékes: egy eszközön minden nap kimaradt, ahol nincs bejegyzés", async () => {
      const { report } = await service.build(
        { month: "2026-09", departmentId: ids.root },
        "INTERNAL",
        NOW,
      );
      const byAsset = new Map(
        report.missed.map((item) => [item.assetId, item]),
      );
      // szeptember 30 nap, a bejegyzés egy napot lefed
      assert.equal(byAsset.get(ids.insideAsset)?.periods.length, 29);
      assert.equal(byAsset.get(ids.childAsset)?.periods.length, 29);
      assert.equal(byAsset.has(ids.outsideAsset), false);
      assert.equal(report.totals.missed, 58);
      assert.ok(!byAsset.get(ids.insideAsset)!.periods.includes("2026-09-10"));
    });
  },
);
