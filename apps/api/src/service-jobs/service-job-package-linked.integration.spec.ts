import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { ServiceJobPackageRepository } from "./service-job-package.repository.js";

/**
 * THE PACKAGE QUERY READS THE LINKED WORKSHEETS ON A REAL DATABASE (card 5b366f5d, part B). What only Postgres can show: the
 * `linkedWorksheets` relation returns the linked worksheets with the columns the gate and the PDF read (kind, number, subject,
 * createdAt, versions, issued sheets), in link order, and the partner's unit rule (`worksheetUnitWhere`) narrows the LINKED set
 * through the relation filter, while a worksheet the sheet owns is not mixed in.
 *
 * MI PIROSÍT: if the relation is not selected or not narrowed by the scope; if the shared select loses `subject` or `createdAt`;
 * if a linked worksheet comes back among the sheet's own `worksheets`.
 */
const gate = integrationDatabaseGate(process.env);

const PREFIX = "KLP-TEST";

describe(
  "a csomag lekérdezése a hozzákapcsolt munkalapokkal valódi adatbázison",
  { skip: gate.mode === "skip" },
  () => {
    const repository = new ServiceJobPackageRepository();
    let jobId = "";
    let unitA = "";
    let ownId = "";

    async function removeLeftovers() {
      const customers = await prisma.customer.findMany({
        where: { customerNumber: { startsWith: PREFIX } },
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
      const suffix = Date.now() % 1_000_000;
      const customer = await prisma.customer.create({
        data: {
          customerNumber: `${PREFIX}-${suffix}`,
          type: "COMPANY",
          displayName: "Csomag kapcsolás teszt",
        },
        select: { id: true },
      });
      const customerId = customer.id;
      const a = await prisma.worksheetDepartment.create({
        data: { customerId, code: "KPA", name: "A egység" },
        select: { id: true },
      });
      const b = await prisma.worksheetDepartment.create({
        data: { customerId, code: "KPB", name: "B egység" },
        select: { id: true },
      });
      unitA = a.id;
      const job = await prisma.serviceJob.create({
        data: {
          jobNumber: `${PREFIX}-${suffix}`,
          kind: "MAINTENANCE",
          title: "Csomag kapcsolás",
          customerId,
          departmentId: a.id,
        },
        select: { id: true },
      });
      jobId = job.id;
      const sheet = async (
        subject: string,
        departmentId: string,
        serviceJobId?: string,
      ) => {
        const row = await prisma.worksheet.create({
          data: { customerId, departmentId, serviceJobId },
          select: { id: true },
        });
        await prisma.worksheetVersion.create({
          data: {
            worksheetId: row.id,
            version: 1,
            status: "DRAFT",
            subject,
          },
        });
        return row.id;
      };
      ownId = await sheet("saját", a.id, jobId);
      const linkedA = await sheet("hivatkozott A", a.id);
      const linkedB = await sheet("hivatkozott B", b.id);
      await prisma.serviceJobLinkedWorksheet.create({
        data: { serviceJobId: jobId, worksheetId: linkedA },
      });
      await prisma.serviceJobLinkedWorksheet.create({
        data: { serviceJobId: jobId, worksheetId: linkedB },
      });
    });

    after(async () => {
      await removeLeftovers();
    });

    it("a lap fajtáját, a saját és a hivatkozott munkalapokat külön adja, a hivatkozottak a kapcsolás sorrendjében, tárgyal és megnyitási nappal", async () => {
      const data = await repository.packageData(jobId, {});
      assert.equal(data?.kind, "MAINTENANCE");
      assert.deepEqual(
        data?.worksheets.map((w) => w.id),
        [ownId],
      );
      assert.deepEqual(
        data?.linkedWorksheets.map((l) => l.worksheet.versions[0]?.subject),
        ["hivatkozott A", "hivatkozott B"],
      );
      assert.ok(data?.linkedWorksheets[0]?.worksheet.createdAt instanceof Date);
    });

    it("a partner egység-szabálya a hivatkozott halmazt szűkíti, a sajátot nem érinti", async () => {
      const data = await repository.packageData(
        jobId,
        {},
        { departmentId: { in: [unitA] } },
      );
      assert.deepEqual(
        data?.linkedWorksheets.map((l) => l.worksheet.versions[0]?.subject),
        ["hivatkozott A"],
      );
      assert.equal(data?.worksheets.length, 1);
    });

    it("üres egység-halmaz semmit nem enged át a hivatkozottak közül", async () => {
      const data = await repository.packageData(
        jobId,
        {},
        { departmentId: { in: [] } },
      );
      assert.deepEqual(data?.linkedWorksheets, []);
    });
  },
);
