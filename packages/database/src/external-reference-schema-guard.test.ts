import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * ONE PARTNER REGISTER, 3.4: THE ENTITY KEY OF `ExternalReference` IS PARTIAL IN THE DATABASE (one Customer entity may carry
 * several UNAS accounts), BUT THE SCHEMA STILL DECLARES IT FULL, because Prisma cannot express a predicate. That is the
 * exact shape a `prisma migrate dev` run would "repair" by recreating the full index.
 *
 * WHAT TURNS THIS RED. The last migration that defines the index no longer carries `WHERE "entityType" <> 'Customer'`
 * (a later migration brought the full unique index back); the (system, entityType, externalId) uniqueness is lost; the
 * schema stops declaring the compound accessor many repositories use; the migration is not a pure replacement of the one
 * index.
 */
const root = new URL("../prisma/", import.meta.url);
const schema = readFileSync(new URL("schema.prisma", root), "utf8");
const migrationsDir = new URL("migrations/", root);
const THIS = "20261109170000_external_reference_customer_many";
const INDEX = "ExternalReference_system_entityType_entityId_key";
const names = readdirSync(migrationsDir)
  .filter((name) => /^\d{14}_/.test(name))
  .sort();
const sql = (name: string) =>
  readFileSync(new URL(`${name}/migration.sql`, migrationsDir), "utf8").replace(
    /^\s*--.*$/gm,
    "",
  );

describe("the ExternalReference entity key (partner register, 3.4)", () => {
  it("the migration replaces exactly that one index with the partial one", () => {
    const text = sql(THIS);
    assert.match(text, new RegExp(`DROP INDEX "${INDEX}";`));
    assert.match(
      text,
      new RegExp(
        `CREATE UNIQUE INDEX "${INDEX}"\\s+ON "ExternalReference"\\("system", "entityType", "entityId"\\)\\s+WHERE "entityType" <> 'Customer';`,
      ),
    );
    // nothing else: no other statement touches the table
    const statements = text
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean);
    assert.equal(statements.length, 2);
  });

  it("the LAST migration that defines the index is a partial one, whatever comes after this one", () => {
    const definers = names.filter((name) => sql(name).includes(`"${INDEX}"`));
    assert.ok(definers.includes(THIS));
    const last = sql(definers[definers.length - 1]!);
    const creates = [
      ...last.matchAll(new RegExp(`CREATE UNIQUE INDEX "${INDEX}"[^;]*;`, "g")),
    ];
    assert.ok(creates.length > 0, "the last definer must create it");
    assert.match(
      creates[creates.length - 1]![0],
      /WHERE "entityType" <> 'Customer'/,
    );
    // and nothing after the last definer drops it (a drop would leave the key off)
    for (const name of names.filter((n) => n > THIS))
      assert.doesNotMatch(
        sql(name),
        new RegExp(`DROP INDEX "${INDEX}"(?![^;]*CREATE)`),
        name,
      );
  });

  it("the (system, entityType, externalId) uniqueness is untouched, and the schema keeps both compound keys", () => {
    const model =
      /^model ExternalReference \{[\s\S]*?^\}/m.exec(schema)?.[0] ?? "";
    assert.match(model, /@@unique\(\[system, entityType, externalId\]\)/);
    assert.match(model, /@@unique\(\[system, entityType, entityId\]\)/);
    assert.ok(
      !sql(THIS).includes(
        '"ExternalReference_system_entityType_externalId_key"',
      ),
    );
  });
});
