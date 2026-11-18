import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { lastServiceJobNumber } from "./service-job-last-number.js";

/**
 * A KT-ÁTSZÁMOZÁS ADATLÉPÉSE VALÓDI ADATBÁZISON (t-20261118-kt-szam; Balázs, 2026-11-18, Luca-Balázs-Acrobot szál: "ha át tudod írni a számukat").
 *
 * A migráció (`20261118133000_service_job_kt_numbering`) egy idempotens SQL adatlépést tartalmaz; ez a teszt UGYANAZT a szöveget futtatja le
 * (a fájlból, a `-- DATA STEP START` és `-- DATA STEP END` jelek között), nem egy másolatot: ha a migráció szövege változik, ez a teszt is a
 * változottat méri. Az adatbázis a migráció lefutása után már megvan, de nem tartalmaz karbantartási jegyet, tehát az adatlépés itt a
 * teszt saját soraira fut.
 *
 * MI PIROSÍT: ha egy HJ-számú MAINTENANCE jegy nem kap KT-számot, vagy rossz sorrendben/évben kap; ha a hibajegy (REPAIR) vagy egy már KT-számú jegy
 * megmozdul; ha a régi szám nem marad meg (`previousNumber`); ha a felszabadult HJ-szám nem kerül a törölt táblába (és a következő HJ újra kiadná);
 * ha a KT-sorozat egy meglévő KT-szám után nem folytatódik; ha a második futás bármit mozdít.
 *
 * A HELYI FUTÁS EZEN NEM MÉR SEMMIT: nincs helyi postgres, a fájl a `pnpm test`-ben nem fut. A "megírtam" és a "lefutott" közé a CI esik.
 */
const gate = integrationDatabaseGate(process.env);

const YEAR_PREFIX = "2099";
const TEST_CUSTOMER = "KT-NUM-TEST";

const migrationSql = () => {
  const sql = readFileSync(
    new URL(
      "../../../../packages/database/prisma/migrations/20261118133000_service_job_kt_numbering/migration.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const start = sql.indexOf("-- DATA STEP START");
  const end = sql.indexOf("-- DATA STEP END");
  assert.ok(start >= 0 && end > start, "a migráció adatlépés-jelei hiányoznak");
  return sql.slice(start, end);
};

describe(
  "a karbantartási lapok KT-átszámozása (a migráció adatlépése)",
  { skip: gate.mode === "skip" },
  () => {
    async function removeLeftovers() {
      await prisma.serviceJob.deleteMany({
        where: {
          OR: [
            { jobNumber: { startsWith: `KT-${YEAR_PREFIX}-` } },
            { jobNumber: { startsWith: `HJ-${YEAR_PREFIX}-` } },
          ],
        },
      });
      await prisma.serviceJobDeletion.deleteMany({
        where: { jobNumber: { startsWith: `HJ-${YEAR_PREFIX}-` } },
      });
      const customers = await prisma.customer.findMany({
        where: { customerNumber: { startsWith: TEST_CUSTOMER } },
        select: { id: true },
      });
      const ids = customers.map((customer) => customer.id);
      if (ids.length) {
        await prisma.worksheetDepartment.deleteMany({
          where: { customerId: { in: ids } },
        });
        await prisma.customer.deleteMany({ where: { id: { in: ids } } });
      }
    }

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      const customer = await prisma.customer.create({
        data: {
          customerNumber: `${TEST_CUSTOMER}-${Date.now() % 1_000_000}`,
          type: "COMPANY",
          displayName: "KT-szam teszt",
        },
        select: { id: true },
      });
      const department = await prisma.worksheetDepartment.create({
        data: { customerId: customer.id, code: "KTN", name: "KT-szam" },
        select: { id: true },
      });
      const job = (
        jobNumber: string,
        kind: "REPAIR" | "MAINTENANCE",
        createdAt: string,
      ) =>
        prisma.serviceJob.create({
          data: {
            jobNumber,
            kind,
            title: jobNumber,
            customerId: customer.id,
            departmentId: department.id,
            createdAt: new Date(createdAt),
          },
        });
      // a hibajegy (HJ-001), két HJ-számú karbantartás fordított számsorrendben, és egy már KT-számú
      await job(`HJ-${YEAR_PREFIX}-001`, "REPAIR", "2099-01-01T09:00:00Z");
      await job(`HJ-${YEAR_PREFIX}-003`, "MAINTENANCE", "2099-01-02T09:00:00Z");
      await job(`HJ-${YEAR_PREFIX}-002`, "MAINTENANCE", "2099-01-01T10:00:00Z");
      await job(`KT-${YEAR_PREFIX}-005`, "MAINTENANCE", "2098-12-31T09:00:00Z");
    });

    after(async () => {
      await removeLeftovers();
    });

    const rows = () =>
      prisma.serviceJob.findMany({
        where: {
          OR: [
            { jobNumber: { startsWith: `KT-${YEAR_PREFIX}-` } },
            { jobNumber: { startsWith: `HJ-${YEAR_PREFIX}-` } },
          ],
        },
        orderBy: { createdAt: "asc" },
        select: { jobNumber: true, previousNumber: true, kind: true },
      });

    it("a HJ-számú karbantartások a létrehozás sorrendjében, a meglévő KT-sorozat után kapnak KT-számot; a hibajegy és a KT-számú nem mozdul", async () => {
      await prisma.$executeRawUnsafe(migrationSql());
      assert.deepEqual(await rows(), [
        {
          jobNumber: `KT-${YEAR_PREFIX}-005`,
          previousNumber: null,
          kind: "MAINTENANCE",
        },
        {
          jobNumber: `HJ-${YEAR_PREFIX}-001`,
          previousNumber: null,
          kind: "REPAIR",
        },
        // a létrehozás sorrendje: a -002 (01-01 10:00) előbb jött, mint a -003 (01-02)
        {
          jobNumber: `KT-${YEAR_PREFIX}-006`,
          previousNumber: `HJ-${YEAR_PREFIX}-002`,
          kind: "MAINTENANCE",
        },
        {
          jobNumber: `KT-${YEAR_PREFIX}-007`,
          previousNumber: `HJ-${YEAR_PREFIX}-003`,
          kind: "MAINTENANCE",
        },
      ]);
    });

    it("a felszabadult HJ-számok a törölt táblában: a HJ sorozat nem adja ki újra, a KT a sajátjából folytatódik", async () => {
      const freed = await prisma.serviceJobDeletion.findMany({
        where: { jobNumber: { startsWith: `HJ-${YEAR_PREFIX}-` } },
        orderBy: { jobNumber: "asc" },
        select: { jobNumber: true },
      });
      assert.deepEqual(
        freed.map((row) => row.jobNumber),
        [`HJ-${YEAR_PREFIX}-002`, `HJ-${YEAR_PREFIX}-003`],
      );
      // az élő HJ legnagyobb a -001, de a következő a felszabadult -003 UTÁN jön
      assert.equal(
        await lastServiceJobNumber(prisma, `HJ-${YEAR_PREFIX}-`),
        `HJ-${YEAR_PREFIX}-003`,
      );
      assert.equal(
        await lastServiceJobNumber(prisma, `KT-${YEAR_PREFIX}-`),
        `KT-${YEAR_PREFIX}-007`,
      );
    });

    it("idempotens: a második futás nem mozdít semmit", async () => {
      const before = await rows();
      await prisma.$executeRawUnsafe(migrationSql());
      assert.deepEqual(await rows(), before);
      assert.equal(
        await prisma.serviceJobDeletion.count({
          where: { jobNumber: { startsWith: `HJ-${YEAR_PREFIX}-` } },
        }),
        2,
      );
    });
  },
);
