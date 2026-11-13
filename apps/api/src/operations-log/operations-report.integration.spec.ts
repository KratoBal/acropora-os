import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { OperationsPartnerService } from "./operations-partner.service.js";
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
    const partnerService = new OperationsPartnerService(repository, service);
    const ids = {
      root: "",
      child: "",
      other: "",
      third: "",
      archivedAsset: "",
      movedAsset: "",
      insideAsset: "",
      childAsset: "",
      outsideAsset: "",
      template: "",
      user: "",
      customer: "",
      partnerUser: "",
      otherPartnerUser: "",
      partnerOfThird: "",
      partnerOfOther: "",
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
      // a partner-fiókok a vevőhöz kötöttek (`User_customerId_fkey`): a vevő törlése ELŐTT mennek
      await prisma.user.deleteMany({
        where: { email: { startsWith: PREFIX.toLowerCase() } },
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
      ids.customer = customer.id;
      ids.root = (await department("Biodom")).id;
      ids.child = (await department("Nagy", ids.root)).id;
      ids.other = (await department("Masik")).id;
      ids.third = (await department("Harmadik")).id;
      const supplier = await prisma.supplier.create({
        data: { code: `UZRI${suffix}`.slice(0, 12), name: name("szállító") },
        select: { id: true },
      });
      const category = await prisma.assetCategory.create({
        data: { name: name("kategória") },
        select: { id: true },
      });
      const asset = (
        label: string,
        departmentId: string,
        archivedAt: Date | null = null,
      ) =>
        prisma.asset
          .create({
            data: {
              assetNumber: name(label),
              name: name(`név-${label}`),
              supplierId: supplier.id,
              departmentId,
              archivedAt,
              categoryId: category.id,
            },
            select: { id: true },
          })
          .then((row) => row.id);
      ids.insideAsset = await asset("BENT", ids.root);
      ids.childAsset = await asset("RESZ", ids.child);
      ids.outsideAsset = await asset("KINT", ids.other);
      // a harmadik helyszín: egy ARCHIVÁLT eszköz, és egy eszköz, amelyet a harmadik helyszínről a MÁSIKRA helyeztek
      ids.archivedAsset = await asset("ARCH", ids.third, new Date());
      ids.movedAsset = await asset("MOZG", ids.third);
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
      // a partner-fiók: a vevőhöz kötve, a ROOT helyszínhez rendelve (a részfájával együtt); a másik fiók a vevőhöz kötött, de hozzárendelés nélkül
      const partnerUser = (label: string) =>
        prisma.user.create({
          data: {
            email: `${PREFIX.toLowerCase()}${label}-${suffix}@example.invalid`,
            displayName: `${PREFIX}${label}`,
            role: "PARTNER_SERVICE",
            customerId: customer.id,
          },
          select: { id: true },
        });
      ids.partnerUser = (await partnerUser("partner")).id;
      ids.otherPartnerUser = (await partnerUser("hozzarendeletlen")).id;
      await prisma.userWorksheetDepartment.create({
        data: { userId: ids.partnerUser, departmentId: ids.root },
      });
      // két partner-fiók az áthelyezés két oldalán: az egyik a harmadik helyszínhez (ahol az eszköz állt), a másik a másikhoz (ahová helyezték)
      ids.partnerOfThird = (await partnerUser("harmadik")).id;
      ids.partnerOfOther = (await partnerUser("masik")).id;
      await prisma.userWorksheetDepartment.create({
        data: { userId: ids.partnerOfThird, departmentId: ids.third },
      });
      await prisma.userWorksheetDepartment.create({
        data: { userId: ids.partnerOfOther, departmentId: ids.other },
      });
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
        departmentId: string,
        startedAt: string,
        meterBefore: number,
        meterAfter: number,
      ) =>
        prisma.operationsLogEntry.create({
          data: {
            templateId: ids.template,
            assetId,
            // a helyszín a rögzítés pillanatában (a kimutatás ezen készül)
            departmentId,
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
      await entry(
        ids.insideAsset,
        ids.root,
        "2026-09-10T09:00:00.000Z",
        100,
        112.5,
      );
      await entry(
        ids.childAsset,
        ids.child,
        "2026-09-11T09:00:00.000Z",
        200,
        207.25,
      );
      await entry(
        ids.outsideAsset,
        ids.other,
        "2026-09-12T09:00:00.000Z",
        1,
        2,
      );
      await entry(
        ids.archivedAsset,
        ids.third,
        "2026-09-13T09:00:00.000Z",
        10,
        11,
      );
      await entry(
        ids.movedAsset,
        ids.third,
        "2026-09-14T09:00:00.000Z",
        20,
        23,
      );
      // az eszközt a harmadik helyszínről a MÁSIKRA helyezik: a bejegyzés a rögzítéskori helyszínen marad
      await prisma.asset.update({
        where: { id: ids.movedAsset },
        data: { departmentId: ids.other },
      });
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

    describe("a partner-fiók nézete", () => {
      const partner = (id: string) =>
        ({
          id,
          email: "p@example.invalid",
          displayName: "Partner",
          role: "PARTNER_SERVICE",
          customerId: ids.customer,
          supplierId: null,
        }) as never;

      it("a hozzárendelt helyszínt és a részfáját látja, a másik helyszínt nem", async () => {
        const sites = await partnerService.sites(partner(ids.partnerUser));
        assert.deepEqual(
          sites.items.map((site) => site.id).sort(),
          [ids.root, ids.child].sort(),
        );
        assert.equal(
          sites.items.some((site) => site.id === ids.other),
          false,
        );
      });

      it("a hozzárendelés nélküli fiók semmit nem lát, és a helyszínre ugyanazt a 404-et kapja", async () => {
        const user = partner(ids.otherPartnerUser);
        assert.deepEqual((await partnerService.sites(user)).items, []);
        await assert.rejects(
          partnerService.report(user, {
            month: "2026-09",
            departmentId: ids.root,
          }),
          /A helyszín nem található/,
        );
      });

      it("az áthelyezett eszköz régi munkája a régi helyszín partnerének kimutatásában marad, az újé nem látja", async () => {
        // a MOZG eszközt a harmadik helyszínről a másikra helyezték; a szeptemberi bejegyzés a harmadik helyszínen készült
        const old = await partnerService.report(partner(ids.partnerOfThird), {
          month: "2026-09",
          departmentId: ids.third,
        });
        assert.ok(
          old.report.assets.some((block) => block.assetId === ids.movedAsset),
        );
        const moved = await partnerService.report(partner(ids.partnerOfOther), {
          month: "2026-09",
          departmentId: ids.other,
        });
        assert.equal(
          moved.report.assets.some((block) => block.assetId === ids.movedAsset),
          false,
        );
        // a régi munka semmije (sor, mérési érték, rendellenesség) nincs az újé sorai között; az eszköz mai ütemezése viszont már az újé
        assert.equal(
          JSON.stringify(moved.report.assets).includes(ids.movedAsset),
          false,
        );
      });

      it("a látható helyszín kimutatása PARTNER nézettel készül: a nevek Acropora, a másik helyszín eszköze nincs benne", async () => {
        const result = await partnerService.report(partner(ids.partnerUser), {
          month: "2026-09",
          departmentId: ids.root,
        });
        assert.equal(result.report.audience, "PARTNER");
        assert.equal(result.report.totals.entries, 2);
        const text = JSON.stringify(result);
        assert.equal(text.includes(`${PREFIX}kolléga`), false);
        assert.ok(text.includes("Acropora"));
        assert.equal(
          result.report.assets.some(
            (block) => block.assetId === ids.outsideAsset,
          ),
          false,
        );
        // egy hozzá nem rendelt helyszín kérése is 404, nem kimutatás
        await assert.rejects(
          partnerService.report(partner(ids.partnerUser), {
            month: "2026-09",
            departmentId: ids.other,
          }),
          /A helyszín nem található/,
        );
      });
    });

    it("az archivált eszköz múltja a helyén marad, kimaradás viszont nem keletkezik rá", async () => {
      const { report } = await service.build(
        { month: "2026-09", departmentId: ids.third },
        "INTERNAL",
        NOW,
      );
      const labels = report.assets.map((block) => block.assetId).sort();
      assert.deepEqual(labels, [ids.archivedAsset, ids.movedAsset].sort());
      // az archivált eszközön nincs mi esedékes: a kimaradás csak az élő eszközökre bontódik ki
      assert.equal(
        report.missed.some((item) => item.assetId === ids.archivedAsset),
        false,
      );
    });

    it("az áthelyezett eszköz régi bejegyzése a RÉGI helyszín kimutatásában marad, az újban nincs", async () => {
      const old = await service.build(
        { month: "2026-09", departmentId: ids.third },
        "INTERNAL",
        NOW,
      );
      assert.ok(
        old.report.assets.some((block) => block.assetId === ids.movedAsset),
      );
      const now = await service.build(
        { month: "2026-09", departmentId: ids.other },
        "INTERNAL",
        NOW,
      );
      // a másik helyszín saját eszközének bejegyzése megvan, az ide helyezett eszköz régi bejegyzése nincs
      assert.deepEqual(
        now.report.assets.map((block) => block.assetId),
        [ids.outsideAsset],
      );
      // a heti/napi esedékesség viszont az eszköz minden bejegyzése szerint számol: a 09-14-i nap az új helyszínen sem "maradt ki"
      const missedMoved = now.report.missed.find(
        (item) => item.assetId === ids.movedAsset,
      );
      assert.ok(missedMoved);
      assert.equal(missedMoved.periods.includes("2026-09-14"), false);
    });
  },
);
