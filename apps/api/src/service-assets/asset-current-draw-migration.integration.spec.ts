import "reflect-metadata";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";

/**
 * THE DATA STEP OF `20261021120000_asset_current_draw`, RUN AGAINST A REAL
 * PostgreSQL (Balázs, 2026-10-21, kanban 541e2716).
 *
 * WHY THIS FILE EXISTS: the migration WRITES DATA (the old kW number is copied
 * into the "original entry" text where that was empty, then the number is
 * emptied on every row). The CI step that applies the migrations runs it on an
 * EMPTY table, so it proves the SQL parses, not that it moves the right rows.
 * Without this spec the only measurement of the data step would be the first
 * run on stage, where a wrong copy cannot be undone.
 *
 * HOW: a scratch schema with a minimal "Asset" table in the PRE-migration
 * shape, the migration file executed verbatim inside one transaction pinned to
 * that schema (`SET LOCAL search_path`), then the rows read back. The real
 * "Asset" table is never touched. The same file is run a second time to prove
 * it is idempotent.
 *
 * Runs only on a database named for testing; see integrationDatabaseGate.
 */
const gate = integrationDatabaseGate(process.env);

const MIGRATION = readFileSync(
  new URL(
    "../../../../packages/database/prisma/migrations/20261021120000_asset_current_draw/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

/**
 * Splits a migration into statements on `;`, but not inside a `$$ ... $$`
 * block (the DO blocks carry their own semicolons). Line comments are dropped
 * first, so a `;` inside a comment cannot split anything.
 */
function statements(sql: string): string[] {
  const withoutComments = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  const result: string[] = [];
  let current = "";
  let insideDollar = false;
  for (let i = 0; i < withoutComments.length; i += 1) {
    if (withoutComments.startsWith("$$", i)) {
      insideDollar = !insideDollar;
      current += "$$";
      i += 1;
      continue;
    }
    const char = withoutComments[i]!;
    if (char === ";" && !insideDollar) {
      if (current.trim() !== "") result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim() !== "") result.push(current.trim());
  return result;
}

describe(
  "az áramfelvétel-migráció adatlépése (valódi PostgreSQL)",
  { skip: gate.mode === "skip" },
  () => {
    const schema = `migracio_proba_${Date.now() % 1_000_000_000}`;

    async function runMigration(): Promise<void> {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
        for (const statement of statements(MIGRATION))
          await tx.$executeRawUnsafe(statement);
      });
    }

    async function rows() {
      return prisma.$queryRawUnsafe<
        {
          id: string;
          currentDraw: string | null;
          raw: string | null;
          phase: string | null;
        }[]
      >(
        `SELECT "id", "currentDraw", "powerConsumptionRaw" AS raw,
                "phaseConnection"::text AS phase
         FROM "${schema}"."Asset" ORDER BY "id"`,
      );
    }

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      await prisma.$executeRawUnsafe(
        `CREATE TABLE "${schema}"."Asset" (
           "id" TEXT PRIMARY KEY,
           "powerConsumption" DECIMAL(19,6),
           "powerConsumptionRaw" TEXT
         )`,
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO "${schema}"."Asset" VALUES
           ('a-nincs-eredeti',  0.75,     NULL),
           ('b-ures-eredeti',   500,      ''),
           ('c-szokoz',         6.15,     '   '),
           ('d-van-eredeti',    5.5,      '6,15/5,5'),
           ('e-nincs-semmi',    NULL,     NULL),
           ('f-csak-eredeti',   NULL,     '2,2 kW'),
           ('g-sok-tizedes',    0.000001, NULL),
           ('h-nulla',          0,        NULL)`,
      );
      await runMigration();
    });

    after(async () => {
      await prisma.$executeRawUnsafe(
        `DROP SCHEMA IF EXISTS "${schema}" CASCADE`,
      );
    });

    it("ahol az eredeti bejegyzés üres, a kW-szám kerül oda, magyar alakban, ' kW' tagolással", async () => {
      const byId = Object.fromEntries((await rows()).map((r) => [r.id, r.raw]));
      assert.equal(byId["a-nincs-eredeti"], "0,75 kW");
      // felesleges nullák nélkül: 500.000000 -> 500
      assert.equal(byId["b-ures-eredeti"], "500 kW");
      // a csak szóközt tartalmazó eredeti is ÜRES
      assert.equal(byId["c-szokoz"], "6,15 kW");
      assert.equal(byId["g-sok-tizedes"], "0,000001 kW");
      assert.equal(byId["h-nulla"], "0 kW");
    });

    it("a kitöltött eredeti bejegyzést nem írja felül", async () => {
      const byId = Object.fromEntries((await rows()).map((r) => [r.id, r.raw]));
      assert.equal(byId["d-van-eredeti"], "6,15/5,5");
      assert.equal(byId["f-csak-eredeti"], "2,2 kW");
    });

    it("ahol nem volt szám, az eredeti bejegyzés sem változik", async () => {
      const byId = Object.fromEntries((await rows()).map((r) => [r.id, r.raw]));
      assert.equal(byId["e-nincs-semmi"], null);
    });

    it("MINDEN soron üres az áramfelvétel, és a bekötés is", async () => {
      const all = await rows();
      assert.equal(all.length, 8);
      assert.ok(all.every((r) => r.currentDraw === null));
      assert.ok(all.every((r) => r.phase === null));
    });

    it("a régi szám-oszlop nincs többé, az új szöveg típusú", async () => {
      const columns = await prisma.$queryRawUnsafe<
        { column_name: string; data_type: string }[]
      >(
        `SELECT column_name, data_type FROM information_schema.columns
         WHERE table_schema = '${schema}' AND table_name = 'Asset'
         ORDER BY column_name`,
      );
      const types = Object.fromEntries(
        columns.map((c) => [c.column_name, c.data_type]),
      );
      assert.equal("powerConsumption" in types, false);
      assert.equal(types["currentDraw"], "text");
      assert.equal(types["phaseConnection"], "USER-DEFINED");
    });

    it("a bekötés enum pontosan a két kódot fogadja el", async () => {
      await prisma.$executeRawUnsafe(
        `UPDATE "${schema}"."Asset" SET "phaseConnection" = 'PHASE_3'
         WHERE "id" = 'a-nincs-eredeti'`,
      );
      await assert.rejects(
        prisma.$executeRawUnsafe(
          `UPDATE "${schema}"."Asset" SET "phaseConnection" = 'PHASE_2'
           WHERE "id" = 'a-nincs-eredeti'`,
        ),
      );
      await prisma.$executeRawUnsafe(
        `UPDATE "${schema}"."Asset" SET "phaseConnection" = NULL
         WHERE "id" = 'a-nincs-eredeti'`,
      );
    });

    it("IDEMPOTENS: a második futás hibátlan, és semmit nem változtat", async () => {
      const before = await rows();
      await runMigration();
      assert.deepEqual(await rows(), before);
    });
  },
);
