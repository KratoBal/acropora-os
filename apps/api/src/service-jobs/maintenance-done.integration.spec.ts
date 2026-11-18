import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma, type WorksheetVersionStatus } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { ServiceJobsRepository } from "./service-jobs.repository.js";

/**
 * A KARBANTARTÁSI LAP KÉSZ-SZABÁLYA VALÓDI ADATBÁZISON (a9db2779; barracuda a #2711-en). A szabály (Balázs, 2026-11-18): kész, ha van
 * munkalapja, és MINDEGYIK munkalap legutolsó verziója aláírt. 2026-11-18 óta szűrőként fut (`MAINTENANCE_DONE`, EXISTS / NOT EXISTS a
 * `WorksheetLatestVersion` nézeten), tehát hogy a "legutolsó" valóban a legnagyobb sorszámú verzió, azt csak a Postgres tudja megmutatni:
 * ezért itt, és nem a hamis adatbázisos specben.
 *
 * Hét lap, mind ugyanannak a teszt-ügyfélnek; a lista fülei, a számláló és a jelvény ugyanarra a hét esetre:
 *   alairt                     egy munkalap, aláírt                              -> kész
 *   alairt-elutasitas-utan     v1 elutasított, v2 aláírt                          -> kész (a legutolsó számít)
 *   ket-alairt                 két munkalap, a másodiknál v1 piszkozat, v2 aláírt -> kész
 *   nincs-munkalap             munkalap nélkül                                    -> folyamatban
 *   uj-piszkozat-alairt-utan   v1 aláírt, v2 piszkozat                            -> folyamatban (a legutolsó számít)
 *   egyik-piszkozat            két munkalap, az egyik aláírt, a másik piszkozat    -> folyamatban
 *   verzio-nelkuli-munkalap    munkalap verzió nélkül                             -> folyamatban
 * És egy aláírt munkalapú HIBAJEGY, ami a karbantartás számába nem számít bele.
 *
 * MI PIROSÍT: ha a nézet nem a LEGUTOLSÓ verziót adja (a két "a legutolsó számít" eset megfordul); ha a munkalap nélküli vagy a verzió
 * nélküli munkalapú lap késznek számít; ha a fülek, a számláló és a jelvény nem ugyanazt mondja; ha a hibajegy beleszámít.
 */
const gate = integrationDatabaseGate(process.env);

const TEST_CUSTOMER = "KT-KESZ-TEST";
const DONE = ["alairt", "alairt-elutasitas-utan", "ket-alairt"];
const PROGRESS = [
  "egyik-piszkozat",
  "nincs-munkalap",
  "uj-piszkozat-alairt-utan",
  "verzio-nelkuli-munkalap",
];
const CASES: Record<string, WorksheetVersionStatus[][]> = {
  alairt: [["SIGNED"]],
  "alairt-elutasitas-utan": [["REJECTED", "SIGNED"]],
  "ket-alairt": [["SIGNED"], ["DRAFT", "SIGNED"]],
  "nincs-munkalap": [],
  "uj-piszkozat-alairt-utan": [["SIGNED", "DRAFT"]],
  "egyik-piszkozat": [["SIGNED"], ["DRAFT"]],
  "verzio-nelkuli-munkalap": [[]],
};

describe(
  "a karbantartási lap kész-szabálya valódi adatbázison (a fülek, a számláló és a jelvény)",
  { skip: gate.mode === "skip" },
  () => {
    const repository = new ServiceJobsRepository();
    let customerId = "";

    async function removeLeftovers() {
      const customers = await prisma.customer.findMany({
        where: { customerNumber: { startsWith: TEST_CUSTOMER } },
        select: { id: true },
      });
      const ids = customers.map((customer) => customer.id);
      if (!ids.length) return;
      await prisma.worksheet.deleteMany({ where: { customerId: { in: ids } } });
      await prisma.serviceJob.deleteMany({
        where: { customerId: { in: ids } },
      });
      await prisma.worksheetDepartment.deleteMany({
        where: { customerId: { in: ids } },
      });
      await prisma.customer.deleteMany({ where: { id: { in: ids } } });
    }

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      const customer = await prisma.customer.create({
        data: {
          customerNumber: `${TEST_CUSTOMER}-${Date.now() % 1_000_000}`,
          type: "COMPANY",
          displayName: "Kész-szabály teszt",
        },
        select: { id: true },
      });
      customerId = customer.id;
      const department = await prisma.worksheetDepartment.create({
        data: { customerId, code: "KKT", name: "Kész-szabály" },
        select: { id: true },
      });
      const sheets = async (
        serviceJobId: string,
        versionsPerSheet: WorksheetVersionStatus[][],
      ) => {
        for (const versions of versionsPerSheet) {
          const sheet = await prisma.worksheet.create({
            data: { customerId, departmentId: department.id, serviceJobId },
            select: { id: true },
          });
          for (const [index, status] of versions.entries()) {
            await prisma.worksheetVersion.create({
              data: {
                worksheetId: sheet.id,
                version: index + 1,
                status,
                subject: `${serviceJobId} v${index + 1}`,
                // the database's own rules (20260817231500): a closed version has a closedAt, a later version a reason
                closedAt: status === "DRAFT" ? null : new Date(),
                changeReason: index > 0 ? "Teszt: új verzió" : null,
              },
            });
          }
        }
      };
      const run = Date.now() % 1_000_000;
      for (const [index, [title, versionsPerSheet]] of Object.entries(
        CASES,
      ).entries()) {
        const job = await prisma.serviceJob.create({
          data: {
            jobNumber: `KKT-${run}-${index}`,
            kind: "MAINTENANCE",
            title,
            customerId,
            departmentId: department.id,
          },
          select: { id: true },
        });
        await sheets(job.id, versionsPerSheet);
      }
      const repair = await prisma.serviceJob.create({
        data: {
          jobNumber: `KKT-${run}-HJ`,
          kind: "REPAIR",
          title: "hibajegy-alairt",
          customerId,
          departmentId: department.id,
        },
        select: { id: true },
      });
      await sheets(repair.id, [["SIGNED"]]);
    });

    after(async () => {
      await removeLeftovers();
    });

    const titles = (rows: { title: string }[]) =>
      rows.map((row) => row.title).sort();

    it("a Kész fül a három kész lapot, a Folyamatban fül a négy másikat adja", async () => {
      const visibility = { customerId };
      const done = await repository.list(
        "all",
        visibility,
        undefined,
        "MAINTENANCE",
        "viewer",
        "done",
      );
      const progress = await repository.list(
        "all",
        visibility,
        undefined,
        "MAINTENANCE",
        "viewer",
        "progress",
      );
      assert.deepEqual(titles(done.rows), DONE);
      assert.deepEqual(titles(progress.rows), PROGRESS);
    });

    it("a számláló ugyanezt számolja, a hibajegy nélkül: kész 3, folyamatban 4", async () => {
      assert.deepEqual(
        await repository.maintenanceStateCounts({ customerId }, undefined),
        { progress: PROGRESS.length, done: DONE.length },
      );
    });

    it("a fül nélküli lista jelvénye ugyanazt mondja, mint a fülek", async () => {
      const all = await repository.list(
        "all",
        { customerId },
        undefined,
        "MAINTENANCE",
        "viewer",
      );
      const badge = Object.fromEntries(
        all.rows.map((row) => [row.title, row.maintenanceDone]),
      );
      for (const title of DONE) assert.equal(badge[title], true, title);
      for (const title of PROGRESS) assert.notEqual(badge[title], true, title);
    });
  },
);
