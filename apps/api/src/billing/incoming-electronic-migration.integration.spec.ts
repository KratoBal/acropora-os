import "reflect-metadata";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";

/**
 * THE DATA STEP OF `20261105190000_incoming_electronic_from_feed_code`, RUN AGAINST A REAL PostgreSQL (task
 * os-e-szamla-jelzo-bejovo, acrobot 43735). A stored outgoing row's `electronic` flag was set by the parser that took
 * `eszamla = 1` (the PAPER code) as electronic; the migration re-reads the stored raw feed message (SZAMLABE) and sets it from the
 * documented code (2 and 3 are e-invoices; 0 and 1 are not).
 *
 * WHY THIS FILE EXISTS: the CI step that applies the migrations runs on an EMPTY database, so it proves the SQL parses,
 * not that it moves the right rows. This runs the migration file verbatim on a scratch schema with minimal tables in the
 * production shape, then a second time to prove it is idempotent. The real tables are never touched.
 *
 * WHAT TURNS IT RED: a code-3 row left as paper, or a code-1 row left as electronic (the inverted old value); a code-0 row
 * or a row without a readable code that is rewritten; an eBIZ row, a row whose message is not a SZAMLABE one, or a row
 * without a message that is touched; a second run that changes anything.
 *
 * Runs only on a database named for testing; see integrationDatabaseGate.
 */
const gate = integrationDatabaseGate(process.env);

const MIGRATION = readFileSync(
  new URL(
    "../../../../packages/database/prisma/migrations/20261105190000_incoming_electronic_from_feed_code/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

/** Splits on `;` outside a `$$ ... $$` block; line comments are dropped first. */
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

const xml = (alap: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><szamlabe xmlns="http://www.szamlazz.hu/szamlabe"><alap><id>1</id>${alap}</alap></szamlabe>`;

describe(
  "a bejövő számla elektronikus jelzőjének migrációja a feed kódjából (valódi PostgreSQL)",
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

    async function flags() {
      const rows = await prisma.$queryRawUnsafe<
        { id: string; electronic: boolean }[]
      >(
        `SELECT "id", "electronic" FROM "${schema}"."IncomingBillingDocument" ORDER BY "id"`,
      );
      return Object.fromEntries(rows.map((r) => [r.id, r.electronic]));
    }

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      await prisma.$executeRawUnsafe(
        `CREATE TABLE "${schema}"."SzamlazzFeedMessage" (
           "id" TEXT PRIMARY KEY, "kind" TEXT NOT NULL, "body" TEXT NOT NULL)`,
      );
      await prisma.$executeRawUnsafe(
        `CREATE TABLE "${schema}"."IncomingBillingDocument" (
           "id" TEXT PRIMARY KEY, "source" TEXT NOT NULL,
           "feedMessageId" TEXT NOT NULL, "electronic" BOOLEAN NOT NULL)`,
      );
      const messages: [string, string, string][] = [
        ["m3", "SZAMLABE", xml("<tipus>SZ</tipus><eszamla>3</eszamla>")],
        ["m2", "SZAMLABE", xml("<tipus>SZ</tipus><eszamla>2</eszamla>")],
        ["m1", "SZAMLABE", xml("<tipus>SZ</tipus><eszamla>1</eszamla>")],
        ["m0", "SZAMLABE", xml("<tipus>SZ</tipus><eszamla>0</eszamla>")],
        ["m3sp", "SZAMLABE", xml("<eszamla>\n  3 \n</eszamla>")],
        ["mnone", "SZAMLABE", xml("<tipus>SZ</tipus>")],
        ["mtext", "SZAMLABE", xml("<eszamla>true</eszamla>")],
        ["mjunk", "SZAMLABE", "nem xml, <eszamla>x</eszamla>"],
        ["mki", "SZAMLAKI", xml("<eszamla>3</eszamla>")],
      ];
      for (const [id, kind, body] of messages)
        await prisma.$executeRawUnsafe(
          `INSERT INTO "${schema}"."SzamlazzFeedMessage" VALUES ($1, $2, $3)`,
          id,
          kind,
          body,
        );
      // `electronic` is set to the OLD parser's value: true for code 1, false for the others
      await prisma.$executeRawUnsafe(
        `INSERT INTO "${schema}"."IncomingBillingDocument" VALUES
           ('d-3',     'SZAMLAZZ', 'm3',    false),
           ('d-2',     'SZAMLAZZ', 'm2',    false),
           ('d-1',     'SZAMLAZZ', 'm1',    true),
           ('d-0',     'SZAMLAZZ', 'm0',    false),
           ('d-0-true','SZAMLAZZ', 'm0',    true),
           ('d-3sp',   'SZAMLAZZ', 'm3sp',  false),
           ('d-none-f','SZAMLAZZ', 'mnone', false),
           ('d-none-t','SZAMLAZZ', 'mnone', true),
           ('d-text',  'SZAMLAZZ', 'mtext', true),
           ('d-junk',  'SZAMLAZZ', 'mjunk', true),
           ('d-nomsg', 'SZAMLAZZ', 'hianyzik', true),
           ('d-ki',    'SZAMLAZZ', 'mki',   false),
           ('d-ebiz',  'EBIZ',     'm3',    false)`,
      );
      await runMigration();
    });

    after(async () => {
      await prisma.$executeRawUnsafe(
        `DROP SCHEMA IF EXISTS "${schema}" CASCADE`,
      );
    });

    it("a 2-es és 3-as kódú sor elektronikus lesz, a szóközös elem is", async () => {
      const f = await flags();
      assert.equal(f["d-3"], true);
      assert.equal(f["d-2"], true);
      assert.equal(f["d-3sp"], true);
    });

    it("az 1-es és 0-s kódú sor nem elektronikus (az elavult, fordított érték kijavul)", async () => {
      const f = await flags();
      assert.equal(f["d-1"], false);
      assert.equal(f["d-0"], false);
      assert.equal(f["d-0-true"], false);
    });

    it("olvashatatlan kód, hiányzó elem, nem SZAMLABE üzenet, hiányzó üzenet és az eBIZ sor érintetlen", async () => {
      const f = await flags();
      assert.equal(f["d-none-f"], false);
      assert.equal(f["d-none-t"], true);
      assert.equal(f["d-text"], true);
      assert.equal(f["d-junk"], true);
      assert.equal(f["d-nomsg"], true);
      assert.equal(f["d-ki"], false);
      assert.equal(f["d-ebiz"], false);
    });

    it("idempotens: a második futás semmit sem változtat", async () => {
      const before = await flags();
      await runMigration();
      assert.deepEqual(await flags(), before);
    });
  },
);
