import "reflect-metadata";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";

/**
 * THE DATA STEP OF `20261026140000_customer_billing_email`, RUN AGAINST A REAL
 * PostgreSQL (Balázs, 2026-10-26; acrobot 36173 és 36203: általános és idempotens, CSAK a
 * szerviz partner közvetlen tükör-kapcsolatán át; az azonos adószám szerinti
 * párosítás kimarad; a meglévő ügyfél-email nem változik).
 *
 * WHY THIS FILE EXISTS: the CI step that applies the migrations runs on an EMPTY
 * database, so it proves the SQL parses, not that it moves the right rows. This
 * runs the migration file verbatim on a scratch schema with minimal "Customer" and
 * "Supplier" tables in the PRE-migration shape (the same method as
 * `asset-current-draw-migration.integration.spec.ts`), then a second time to prove
 * it is idempotent. The real tables are never touched.
 *
 * Runs only on a database named for testing; see integrationDatabaseGate.
 */
const gate = integrationDatabaseGate(process.env);

const MIGRATION = readFileSync(
  new URL(
    "../../../../packages/database/prisma/migrations/20261026140000_customer_billing_email/migration.sql",
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

describe(
  "a számlázási e-mail migráció adatlépése (valódi PostgreSQL)",
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

    async function customers() {
      const rows = await prisma.$queryRawUnsafe<
        { id: string; email: string | null; billingEmail: string | null }[]
      >(
        `SELECT "id", "email", "billingEmail" FROM "${schema}"."Customer" ORDER BY "id"`,
      );
      return Object.fromEntries(rows.map((r) => [r.id, r]));
    }

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      await prisma.$executeRawUnsafe(
        `CREATE TABLE "${schema}"."Customer" (
           "id" TEXT PRIMARY KEY, "taxNumber" TEXT, "email" TEXT)`,
      );
      await prisma.$executeRawUnsafe(
        `CREATE TABLE "${schema}"."Supplier" (
           "id" TEXT PRIMARY KEY, "customerId" TEXT, "taxNumber" TEXT,
           "email" TEXT, "deletedAt" TIMESTAMP, "isService" BOOLEAN NOT NULL)`,
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO "${schema}"."Customer" VALUES
           ('m-elter',       NULL,             'beszerzes@x.hu'),
           ('m-ugyanaz',     NULL,             'Penzugy@X.hu'),
           ('m-nincs-email', NULL,             NULL),
           ('m-ures-partner',NULL,             'beszerzes@x.hu'),
           ('m-torolt',      NULL,             'beszerzes@x.hu'),
           ('b-elter',       '12345678-2-42',  'regi@x.hu'),
           ('b-ketto',       '23456789-2-42',  'regi2@x.hu'),
           ('b-ugyanaz',     '34567890-2-42',  'Egyezo@x.hu'),
           ('b-rovid',       '123',            'rovid@x.hu'),
           ('b-nincs-ado',   NULL,             'nincsado@x.hu'),
           ('b-masik-ceg',   '99999999-2-42',  'masik@x.hu'),
           ('b-beszallito',  '56789012-2-42',  'vevo@x.hu'),
           ('m-nem-szerviz', NULL,             'regi-szerviz@x.hu'),
           ('b-vegyes',      '45678901-2-42',  'vegyes@x.hu')`,
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO "${schema}"."Supplier" VALUES
           ('s-m-elter',        'm-elter',        NULL,            ' penzugy@x.hu ', NULL, true),
           ('s-m-ugyanaz',      'm-ugyanaz',      NULL,            ' penzugy@x.hu',  NULL, true),
           ('s-m-nincs-email',  'm-nincs-email',  NULL,            'uj@x.hu',        NULL, true),
           ('s-m-ures',         'm-ures-partner', NULL,            '   ',            NULL, true),
           ('s-m-torolt',       'm-torolt',       NULL,            'torolt@x.hu',    now(), true),
           ('s-b-elter',        NULL,             '12345678-2-41', 'partner1@x.hu',  NULL, true),
           ('s-b-ketto-b',      NULL,             '23456789-2-41', 'b@x.hu',         NULL, true),
           ('s-b-ketto-a',      NULL,             '23456789-2-41', 'a@x.hu',         NULL, true),
           ('s-b-ugyanaz',      NULL,             '34567890-2-41', 'egyezo@x.hu',    NULL, true),
           ('s-b-rovid',        NULL,             '123',           'rovid-p@x.hu',   NULL, true),
           ('s-b-torolt-masik', NULL,             '99999999-2-41', 'torolt2@x.hu',   now(), true),
           ('s-b-beszallito',   NULL,             '56789012-2-41', 'rendeles@x.hu',  NULL, false),
           ('s-m-nem-szerviz',  'm-nem-szerviz',  NULL,            'masik-p@x.hu',   NULL, false),
           ('s-b-vegyes-a',     NULL,             '45678901-2-41', 'besz@x.hu',      NULL, false),
           ('s-b-vegyes-b',     NULL,             '45678901-2-41', 'szerv@x.hu',     NULL, true)`,
      );
      await runMigration();
    });

    after(async () => {
      await prisma.$executeRawUnsafe(
        `DROP SCHEMA IF EXISTS "${schema}" CASCADE`,
      );
    });

    it("a szerviz partner tükör-vevője megkapja a partner e-mailjét, ha az eltér, körülvágva", async () => {
      const c = await customers();
      assert.equal(c["m-elter"]!.billingEmail, "penzugy@x.hu");
      assert.equal(c["m-nincs-email"]!.billingEmail, "uj@x.hu");
    });

    it("ahol a két cím csak kis-nagybetűben vagy szóközben tér el, nincs számlázási cím", async () => {
      const c = await customers();
      assert.equal(c["m-ugyanaz"]!.billingEmail, null);
      assert.equal(c["b-ugyanaz"]!.billingEmail, null);
    });

    it("üres vagy törölt partner e-mailje nem kerül át", async () => {
      const c = await customers();
      assert.equal(c["m-ures-partner"]!.billingEmail, null);
      assert.equal(c["m-torolt"]!.billingEmail, null);
      assert.equal(c["b-masik-ceg"]!.billingEmail, null);
    });

    // acrobot 36203: az azonos adószám szerinti párosítás KIMARAD, mert a beszállító (és a partner) e-mailje az
    // értékesítési vagy rendelési kapcsolata, nem az a cím, ahova a NEKI kiállított számlát kell küldeni
    it("az azonos adószámú vevő SEMMILYEN partnernél nem kap számlázási címet, csak a közvetlen tükör-kapcsolat számít", async () => {
      const c = await customers();
      for (const id of [
        "b-elter",
        "b-ketto",
        "b-ugyanaz",
        "b-rovid",
        "b-nincs-ado",
        "b-masik-ceg",
        "b-beszallito",
        "b-vegyes",
      ])
        assert.equal(c[id]!.billingEmail, null, id);
    });

    it("a nem szerviz partner (korábban szerviz volt) tükör-sora nem kap számlázási címet", async () => {
      const c = await customers();
      assert.equal(c["m-nem-szerviz"]!.billingEmail, null);
    });

    it("a meglévő ügyfél-email SOHA nem változik, egyetlen soron sem", async () => {
      const c = await customers();
      const expected: Record<string, string | null> = {
        "m-elter": "beszerzes@x.hu",
        "m-ugyanaz": "Penzugy@X.hu",
        "m-nincs-email": null,
        "m-ures-partner": "beszerzes@x.hu",
        "m-torolt": "beszerzes@x.hu",
        "b-elter": "regi@x.hu",
        "b-ketto": "regi2@x.hu",
        "b-ugyanaz": "Egyezo@x.hu",
        "b-rovid": "rovid@x.hu",
        "b-nincs-ado": "nincsado@x.hu",
        "b-masik-ceg": "masik@x.hu",
        "b-beszallito": "vevo@x.hu",
        "m-nem-szerviz": "regi-szerviz@x.hu",
        "b-vegyes": "vegyes@x.hu",
      };
      assert.equal(Object.keys(c).length, Object.keys(expected).length);
      for (const [id, email] of Object.entries(expected))
        assert.equal(c[id]!.email, email, id);
    });

    it("újrafuttatva ugyanazt adja, és a kézzel módosított számlázási címet nem írja felül", async () => {
      await prisma.$executeRawUnsafe(
        `UPDATE "${schema}"."Customer" SET "billingEmail" = 'kezi@x.hu' WHERE "id" = 'm-elter'`,
      );
      const before = await customers();
      await runMigration();
      const again = await customers();
      assert.equal(again["m-elter"]!.billingEmail, "kezi@x.hu");
      for (const id of Object.keys(before))
        assert.deepEqual(again[id], before[id], id);
    });
  },
);
