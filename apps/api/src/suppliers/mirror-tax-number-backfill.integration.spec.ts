import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";

/**
 * A TÜKÖR ADÓSZÁMÁNAK EGYSZERI VISSZATÖLTÉSE (kártya aaf4f09d), valódi Postgresen.
 * MI PIROSÍT: ha a belföldi partner adószáma nem jut a tükör `taxNumber`-ébe, a
 * külföldié nem az `euTaxNumber`-be; ha a tükör meglévő értékét felülírja; ha egy
 * nem-tükör vevőhöz nyúl; ha másodszor futtatva mást ad (idempotens).
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "TAXMIRROR-";
const SQL = readFileSync(
  new URL(
    "../../../../../packages/database/prisma/migrations/20261104150000_mirror_tax_number_backfill/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
/** a migráció két UPDATE-je; egy prepared statement egyszerre egyet visz */
const statements = SQL.split(/;\s*\n/)
  .map((part) => part.replace(/^--.*$/gm, "").trim())
  .filter(Boolean);

async function removeLeftovers() {
  await prisma.supplier.deleteMany({ where: { code: { startsWith: PREFIX } } });
  await prisma.customer.deleteMany({
    where: { customerNumber: { startsWith: PREFIX } },
  });
}

describe(
  "the mirror tax number backfill",
  { skip: gate.mode === "skip" },
  () => {
    const n = Date.now() % 1_000_000;
    const ids: Record<string, string> = {};

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      const customer = (key: string, data: Record<string, unknown> = {}) =>
        prisma.customer
          .create({
            data: {
              customerNumber: `${PREFIX}${key}-${n}`,
              type: "COMPANY",
              displayName: `${PREFIX}${key}`,
              ...data,
            },
            select: { id: true },
          })
          .then((row) => (ids[key] = row.id));
      await customer("hu");
      await customer("de");
      await customer("kept", { taxNumber: "11111111-1-11" });
      await customer("plain");
      const supplier = (key: string, data: Record<string, unknown>) =>
        prisma.supplier.create({
          data: {
            code: `${PREFIX}${key}-${n}`,
            name: `${PREFIX}${key}`,
            isService: true,
            ...data,
          },
        });
      await supplier("hu", {
        customerId: ids.hu,
        taxNumber: " 15490658-2-42 ",
        country: "HU",
      });
      await supplier("de", {
        customerId: ids.de,
        taxNumber: "DE123456789",
        country: "DE",
      });
      await supplier("kept", {
        customerId: ids.kept,
        taxNumber: "22222222-2-22",
        country: "HU",
      });
      // nem tükör: a partner nem erre a vevőre mutat
      await supplier("plain", { taxNumber: "33333333-3-33", country: "HU" });
    });

    after(async () => {
      await removeLeftovers();
    });

    it("fills only the empty field of a mirror, by the partner's country, and is idempotent", async () => {
      for (let round = 0; round < 2; round++) {
        for (const statement of statements)
          await prisma.$executeRawUnsafe(statement);
        const rows = await prisma.customer.findMany({
          where: { id: { in: Object.values(ids) } },
          select: { id: true, taxNumber: true, euTaxNumber: true },
        });
        const by = new Map(rows.map((row) => [row.id, row]));
        assert.deepEqual(
          [by.get(ids.hu!)?.taxNumber, by.get(ids.hu!)?.euTaxNumber],
          ["15490658-2-42", null],
          `round ${round}: hu`,
        );
        assert.deepEqual(
          [by.get(ids.de!)?.taxNumber, by.get(ids.de!)?.euTaxNumber],
          [null, "DE123456789"],
          `round ${round}: de`,
        );
        assert.equal(
          by.get(ids.kept!)?.taxNumber,
          "11111111-1-11",
          `round ${round}: kept`,
        );
        assert.equal(
          by.get(ids.plain!)?.taxNumber,
          null,
          `round ${round}: plain`,
        );
      }
    });
  },
);
