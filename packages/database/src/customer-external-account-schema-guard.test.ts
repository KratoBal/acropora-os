import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * ONE PARTNER REGISTER, 3.4: ONE `Customer` MAY CARRY SEVERAL UNAS ACCOUNTS, IN A TABLE OF ITS OWN
 * (`CustomerExternalAccount`), AND THE `ExternalReference` UNIQUE INDEXES STAY FULL.
 *
 * WHY THE SECOND HALF IS GUARDED (measured 2026-11-09, the #2180 verify-db): a partial `(system, entityType, entityId)`
 * index made every `prisma.externalReference.upsert()` fail with Postgres 42P10, because Prisma sends a native
 * `INSERT .. ON CONFLICT (system, entityType, entityId)` and a partial index cannot be matched to it. The Medusa stock,
 * price and measure sync and the UNAS import all call that upsert, for every entity type.
 *
 * WHAT TURNS THIS RED. The new table loses its (system, externalId) uniqueness (one external account then maps to two
 * customers, and the UNAS sync looks up by it), its customer index, or its cascade; the schema stops declaring the table;
 * ANY migration makes an ExternalReference unique index partial (a WHERE predicate) or drops one without recreating it
 * in full; the schema stops declaring the two compound keys.
 */
const root = new URL("../prisma/", import.meta.url);
const schema = readFileSync(new URL("schema.prisma", root), "utf8");
const migrationsDir = new URL("migrations/", root);
const names = readdirSync(migrationsDir)
  .filter((name) => /^\d{14}_/.test(name))
  .sort();
const sql = (name: string) =>
  readFileSync(new URL(`${name}/migration.sql`, migrationsDir), "utf8").replace(
    /^\s*--.*$/gm,
    "",
  );
const THIS = "20261109180000_customer_external_account";
const model = (name: string) =>
  new RegExp(`^model ${name} \\{[\\s\\S]*?^\\}`, "m").exec(schema)?.[0] ?? "";

describe("the CustomerExternalAccount table (partner register, 3.4)", () => {
  it("the schema declares it with one external account mapping to one customer only", () => {
    const text = model("CustomerExternalAccount");
    assert.notEqual(text, "", "the model must exist");
    assert.match(text, /@@unique\(\[system, externalId\]\)/);
    assert.match(text, /@@index\(\[customerId\]\)/);
    assert.match(text, /onDelete: Cascade/);
    assert.match(
      model("Customer"),
      /externalAccounts\s+CustomerExternalAccount\[\]/,
    );
  });

  it("the migration creates the table, the unique index on (system, externalId), the customer index and the cascading key", () => {
    assert.ok(names.includes(THIS));
    const text = sql(THIS);
    assert.match(text, /CREATE TABLE "CustomerExternalAccount"/);
    assert.match(
      text,
      /CREATE UNIQUE INDEX "CustomerExternalAccount_system_externalId_key" ON "CustomerExternalAccount"\("system", "externalId"\);/,
    );
    assert.match(
      text,
      /CREATE INDEX "CustomerExternalAccount_customerId_idx" ON "CustomerExternalAccount"\("customerId"\);/,
    );
    assert.match(
      text,
      /FOREIGN KEY \("customerId"\) REFERENCES "Customer"\("id"\) ON DELETE CASCADE/,
    );
  });

  it("is additive: the migration touches nothing but its own table", () => {
    const statements = sql(THIS)
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean);
    for (const statement of statements)
      assert.match(
        statement,
        /^(CREATE TABLE "CustomerExternalAccount"|CREATE (UNIQUE )?INDEX "CustomerExternalAccount_|ALTER TABLE "CustomerExternalAccount" ADD CONSTRAINT)/,
        statement.slice(0, 80),
      );
  });
});

describe("the ExternalReference unique indexes stay FULL", () => {
  const entityKey = "ExternalReference_system_entityType_entityId_key";
  const externalKey = "ExternalReference_system_entityType_externalId_key";

  it("no migration makes either unique index partial", () => {
    for (const name of names)
      for (const key of [entityKey, externalKey])
        assert.doesNotMatch(
          sql(name),
          new RegExp(`CREATE UNIQUE INDEX "${key}"[^;]*\\bWHERE\\b`, "i"),
          `${name} makes ${key} partial: every externalReference.upsert() would fail with 42P10`,
        );
  });

  it("the last migration that defines each index creates it, and none drops it without recreating it", () => {
    for (const key of [entityKey, externalKey]) {
      const definers = names.filter((name) => sql(name).includes(`"${key}"`));
      if (definers.length === 0) continue; // created by the baseline under another form
      const last = sql(definers[definers.length - 1]!);
      const drop = last.lastIndexOf(`DROP INDEX "${key}"`);
      const create = last.lastIndexOf(`CREATE UNIQUE INDEX "${key}"`);
      assert.ok(
        drop === -1 || create > drop,
        `${key} is dropped and not recreated`,
      );
    }
  });

  it("the schema keeps both compound keys the upserts use", () => {
    const text = model("ExternalReference");
    assert.match(text, /@@unique\(\[system, entityType, externalId\]\)/);
    assert.match(text, /@@unique\(\[system, entityType, entityId\]\)/);
  });
});
