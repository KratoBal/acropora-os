import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma, type ServiceJobStatus } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { ServiceJobsRepository } from "./service-jobs.repository.js";

/**
 * A HIBAJEGY-LISTA LAPOZÁSA, RENDEZÉSE ÉS SZŰRŐI VALÓDI ADATBÁZISON (f0b70dbd, (b) kör). A skip, a take, az ORDER BY, a count és a
 * groupBy csak a Postgresen mutatkozik meg, ezért itt, és nem a hamis repositorys specben.
 *
 * Hét hibajegy, EGY teszt-ügyfélnek, két helyszínen (PGA: négy jegy, PGB: három), a létrehozás ideje és a kód ugyanabban a sorrendben:
 *   0 NEW@A  1 NEW@A  2 TRIAGED@B  3 IN_PROGRESS@A  4 COMPLETED@B  5 CANCELLED@A  6 WAITING_FOR_PARTS@B
 *
 * MI PIROSÍT: ha a lapozás nem a rendezett sorból vág (az oldalak átfedik egymást, vagy hiányzik egy sor); ha a találatszám nem a SZŰRT
 * halmazé; ha az állapot-, partner- vagy helyszín-szűrő nem szűkít; ha a szűrő-lehetőségeket a saját szűrőjük szűkítené.
 */
const gate = integrationDatabaseGate(process.env);

const TEST_CUSTOMER = "HJ-LAPOZ-TEST";
const STATUSES: ServiceJobStatus[] = [
  "NEW",
  "NEW",
  "TRIAGED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "WAITING_FOR_PARTS",
];
const AT_A = [0, 1, 3, 5];

describe(
  "a hibajegy-lista lapozása, rendezése és szűrői valódi adatbázison",
  { skip: gate.mode === "skip" },
  () => {
    const repository = new ServiceJobsRepository();
    let customerId = "";
    let departmentA = "";
    let departmentB = "";
    const titles: string[] = [];

    async function removeLeftovers() {
      const customers = await prisma.customer.findMany({
        where: { customerNumber: { startsWith: TEST_CUSTOMER } },
        select: { id: true },
      });
      const ids = customers.map((customer) => customer.id);
      if (!ids.length) return;
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
      const run = Date.now() % 1_000_000;
      const customer = await prisma.customer.create({
        data: {
          customerNumber: `${TEST_CUSTOMER}-${run}`,
          type: "COMPANY",
          displayName: "Lapozás teszt",
        },
        select: { id: true },
      });
      customerId = customer.id;
      departmentA = (
        await prisma.worksheetDepartment.create({
          data: { customerId, code: "PGA", name: "Első helyszín" },
          select: { id: true },
        })
      ).id;
      departmentB = (
        await prisma.worksheetDepartment.create({
          data: { customerId, code: "PGB", name: "Második helyszín" },
          select: { id: true },
        })
      ).id;
      for (const [index, status] of STATUSES.entries()) {
        const title = `lapozas-${index}`;
        titles.push(title);
        await prisma.serviceJob.create({
          data: {
            jobNumber: `HJL-${run}-${index}`,
            kind: "REPAIR",
            title,
            status,
            customerId,
            departmentId: AT_A.includes(index) ? departmentA : departmentB,
            createdAt: new Date(Date.UTC(2026, 10, 1 + index)),
          },
        });
      }
    });

    after(async () => {
      await removeLeftovers();
    });

    const visibility = () => ({ customerId });
    const list = (options: Parameters<ServiceJobsRepository["list"]>[6]) =>
      repository.list(
        "all",
        visibility(),
        undefined,
        "REPAIR",
        "viewer",
        undefined,
        options,
      );
    const names = (rows: { title: string }[]) => rows.map((row) => row.title);

    it("rendezés nélkül a legújabb elöl; a lapok átfedés és hézag nélkül adják a hetet, a találatszám hét", async () => {
      const first = await list({ page: 1, pageSize: 3 });
      const second = await list({ page: 2, pageSize: 3 });
      const third = await list({ page: 3, pageSize: 3 });
      assert.equal(first.totalItems, 7);
      assert.equal(first.truncated, false);
      assert.deepEqual(names(first.rows), [...titles].reverse().slice(0, 3));
      assert.deepEqual(names(second.rows), [...titles].reverse().slice(3, 6));
      assert.deepEqual(names(third.rows), [titles[0]]);
    });

    it("a kód szerinti rendezés növekvőben és csökkenőben, lapozva is", async () => {
      const asc = await list({
        page: 1,
        pageSize: 4,
        sort: "jobNumber",
        direction: "asc",
      });
      const desc = await list({
        page: 2,
        pageSize: 4,
        sort: "jobNumber",
        direction: "desc",
      });
      assert.deepEqual(names(asc.rows), titles.slice(0, 4));
      assert.deepEqual(names(desc.rows), [...titles].reverse().slice(4));
    });

    it("az állapot-szűrő szűkít, és a találatszám a szűrt halmazé", async () => {
      const open = await list({
        page: 1,
        pageSize: 10,
        statuses: ["NEW", "TRIAGED"],
        sort: "jobNumber",
        direction: "asc",
      });
      assert.equal(open.totalItems, 3);
      assert.deepEqual(names(open.rows), titles.slice(0, 3));
      const closed = await list({
        page: 1,
        pageSize: 10,
        statuses: ["COMPLETED", "CANCELLED"],
      });
      assert.equal(closed.totalItems, 2);
    });

    it("a helyszín- és a partner-szűrő szűkít; egy másik partner üres listát ad", async () => {
      const atA = await list({
        page: 1,
        pageSize: 10,
        departmentId: departmentA,
      });
      assert.equal(atA.totalItems, AT_A.length);
      const withStatus = await list({
        page: 1,
        pageSize: 10,
        departmentId: departmentB,
        statuses: ["TRIAGED", "COMPLETED"],
      });
      assert.equal(withStatus.totalItems, 2);
      const other = await list({
        page: 1,
        pageSize: 10,
        customerId: "nincs-ilyen-ugyfel",
      });
      assert.equal(other.totalItems, 0);
      assert.deepEqual(other.rows, []);
    });

    it("lapozás nélkül a régi alak: nincs totalItems, a sorok mind megvannak", async () => {
      const all = await list({});
      assert.equal(all.totalItems, undefined);
      assert.equal(all.rows.length, 7);
      assert.equal(all.truncated, false);
    });

    it("a szűrő-lehetőségek a partnert és a két helyszínt adják, kóddal a feliratban, az állapot-szűrő szűkíti őket", async () => {
      const facets = await repository.listFacets(
        "all",
        visibility(),
        undefined,
        "REPAIR",
        "viewer",
        undefined,
        undefined,
      );
      assert.deepEqual(facets.partners, [
        { id: customerId, name: "Lapozás teszt" },
      ]);
      assert.deepEqual(
        facets.locations.map((location) => location.id).sort(),
        [departmentA, departmentB].sort(),
      );
      for (const location of facets.locations)
        assert.match(location.label, /^PG[AB] · /);
      const onlyNew = await repository.listFacets(
        "all",
        visibility(),
        undefined,
        "REPAIR",
        "viewer",
        undefined,
        ["NEW"],
      );
      assert.deepEqual(
        onlyNew.locations.map((location) => location.id),
        [departmentA],
      );
    });
  },
);
