import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * ONE PARTNER REGISTER, STEP 2: THE SCHEMA AND ITS MIGRATION TOGETHER (plan 2.2: "everything Prisma cannot see needs a
 * schema guard, otherwise a later `prisma migrate dev` can silently drop it").
 *
 * WHAT TURNS THIS RED. The two key columns lose their GENERATED ALWAYS ... STORED in the migration, or the schema stops
 * declaring them as database-generated (`@default(dbgenerated())`), or a LATER migration drops, replaces or un-generates
 * them (the exact thing a `migrate dev` run would propose, because Prisma cannot hold the expression); the step stops being
 * additive (a DROP, UPDATE or DELETE statement, or an ALTER that is not an ADD); an index or the merge pointer is missing
 * from one of the two sides.
 */
const root = new URL("../prisma/", import.meta.url);
const schema = readFileSync(new URL("schema.prisma", root), "utf8");
const migrationsDir = new URL("migrations/", root);
const STEP_2 = "20261104190000_partner_register_schema";
const sql = (name: string) =>
  readFileSync(new URL(`${name}/migration.sql`, migrationsDir), "utf8");
const step2 = sql(STEP_2);
/** The statements only: comments (the rollback note mentions DROP) are not code. */
const code = (text: string) => text.replace(/^\s*--.*$/gm, "");

describe("the partner register schema (step 2)", () => {
  it("the two keys are generated, stored columns in the migration", () => {
    for (const column of ["huTaxBase", "euTaxKey"])
      assert.match(
        step2,
        new RegExp(`ADD COLUMN "${column}" TEXT GENERATED ALWAYS AS \\(`),
        column,
      );
    // each expression ends in STORED (an expression without it would be a virtual column, which PostgreSQL 15 does not have)
    assert.equal((code(step2).match(/\) STORED/g) ?? []).length, 2);
  });

  it("the schema declares them as database-generated, indexed, and the merge pointer as a self relation", () => {
    const customer = /^model Customer \{[\s\S]*?^\}/m.exec(schema)?.[0] ?? "";
    assert.match(
      customer,
      /huTaxBase\s+String\?\s+@default\(dbgenerated\(\)\)/,
    );
    assert.match(customer, /euTaxKey\s+String\?\s+@default\(dbgenerated\(\)\)/);
    assert.match(customer, /@@index\(\[huTaxBase\]\)/);
    assert.match(customer, /@@index\(\[euTaxKey\]\)/);
    assert.match(customer, /@@index\(\[mergedIntoId\]\)/);
    assert.match(
      customer,
      /mergedInto\s+Customer\?\s+@relation\("CustomerMerge", fields: \[mergedIntoId\], references: \[id\], onDelete: Restrict\)/,
    );
    for (const name of [
      "Customer_huTaxBase_idx",
      "Customer_euTaxKey_idx",
      "Customer_mergedIntoId_idx",
    ])
      assert.ok(step2.includes(`CREATE INDEX "${name}"`), name);
  });

  it("declares the two new tables and the alias kind on both sides", () => {
    for (const model of ["CustomerAlias", "CustomerMergeLog"]) {
      assert.match(schema, new RegExp(`^model ${model} \\{`, "m"), model);
      assert.ok(step2.includes(`CREATE TABLE "${model}"`), model);
    }
    assert.match(schema, /^enum CustomerAliasKind \{/m);
    assert.ok(step2.includes(`CREATE TYPE "CustomerAliasKind"`));
    // an old identifier is found once: the value is unique
    assert.ok(step2.includes(`CREATE UNIQUE INDEX "CustomerAlias_value_key"`));
  });

  it("is additive: nothing is dropped, updated or deleted, and every ALTER only adds", () => {
    // the referential actions of a foreign key (`ON DELETE SET NULL`) are clauses of an ADD, not statements
    const statements = code(step2).replace(
      /ON (DELETE|UPDATE) (CASCADE|RESTRICT|SET NULL|NO ACTION)/g,
      "",
    );
    assert.doesNotMatch(statements, /\b(DROP|DELETE|TRUNCATE|UPDATE)\b/i);
    const alters = statements.match(/ALTER TABLE "\w+"[\s\S]*?;/g) ?? [];
    assert.ok(alters.length > 0);
    for (const alter of alters)
      assert.doesNotMatch(alter, /\b(DROP|ALTER COLUMN|RENAME|SET )/i, alter);
  });

  it("no later migration drops, replaces or un-generates the key columns", () => {
    const later = readdirSync(migrationsDir)
      .filter((name) => /^\d{14}_/.test(name) && name > STEP_2)
      .sort();
    for (const name of later) {
      const text = code(sql(name));
      for (const column of ["huTaxBase", "euTaxKey"]) {
        if (!text.includes(`"${column}"`)) continue;
        assert.doesNotMatch(
          text,
          new RegExp(
            `"${column}"[^;]*(DROP COLUMN|DROP EXPRESSION|SET DEFAULT|TYPE )|DROP COLUMN "${column}"`,
            "i",
          ),
          `${name} changes ${column}`,
        );
      }
    }
  });
});
