import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * EVERY VALUE OF `ServiceJobEventKind` MUST BE NAMED BY THE LATEST `ServiceJobEvent_kind_fields_agree` CHECK (card 5b366f5d).
 *
 * The CHECK is a CLOSED list: a `kind` that no migration put into it fails on every insert. The enum and the CHECK live in
 * different migrations, and adding an enum value is one line that nothing forces to be followed by a look at the CHECK. It
 * happened three times (`FIELDS_EDITED`, `NOTIFICATION_SENT`, and `WORKSHEET_LINKED` / `WORKSHEET_UNLINKED`), each time found only
 * by the first CI run on a real Postgres, because a local test with a fake database does not know a database constraint.
 *
 * This reads the TEXT of the schema and the migrations (no database): the enum's values from `schema.prisma`, the CHECK from the
 * newest migration that defines it. What it cannot show: that the migration applies. That is the CI's `prisma migrate deploy`.
 */
const root = new URL("../prisma/", import.meta.url);

export function enumValues(schema: string, name: string): string[] {
  const match = new RegExp(`enum ${name} \\{([\\s\\S]*?)\\n\\}`).exec(schema);
  if (!match) throw new Error(`enum ${name} not found in the schema`);
  return match[1]!
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("//"))
    .map((line) => line.split(/\s+/)[0]!);
}

export function latestCheck(
  migrations: readonly { name: string; sql: string }[],
  constraint: string,
): { name: string; sql: string } {
  const defining = migrations
    .filter((m) => m.sql.includes(`ADD CONSTRAINT "${constraint}"`))
    .sort((a, b) => a.name.localeCompare(b.name));
  const last = defining[defining.length - 1];
  if (!last) throw new Error(`no migration defines ${constraint}`);
  return last;
}

export function kindsMissingFromCheck(
  values: readonly string[],
  checkSql: string,
): string[] {
  return values.filter((value) => !checkSql.includes(`'${value}'`));
}

describe("ServiceJobEventKind and its kind/fields CHECK", () => {
  const schema = readFileSync(new URL("schema.prisma", root), "utf8");
  const migrations = readdirSync(new URL("migrations/", root), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      sql: readFileSync(
        new URL(`migrations/${entry.name}/migration.sql`, root),
        "utf8",
      ),
    }));

  it("the newest definition of the CHECK names every enum value", () => {
    const values = enumValues(schema, "ServiceJobEventKind");
    assert.ok(values.length >= 7, "the enum was read (not an empty list)");
    const check = latestCheck(migrations, "ServiceJobEvent_kind_fields_agree");
    assert.deepEqual(kindsMissingFromCheck(values, check.sql), [], check.name);
  });

  // NEGATIVE CONTROL: the guard itself must be able to fail, or a green result proves nothing
  it("names the value a CHECK forgot", () => {
    assert.deepEqual(
      kindsMissingFromCheck(
        ["STATUS_CHANGE", "WORKSHEET_LINKED"],
        `CHECK ("kind" = 'STATUS_CHANGE')`,
      ),
      ["WORKSHEET_LINKED"],
    );
  });

  it("reads the enum values, comments and blank lines aside", () => {
    assert.deepEqual(
      enumValues(
        "enum ServiceJobEventKind {\n  /// doc\n  A\n\n  /// doc\n  B\n}\n",
        "ServiceJobEventKind",
      ),
      ["A", "B"],
    );
  });

  it("picks the newest migration that defines the constraint", () => {
    const sql = (c: string) => `ADD CONSTRAINT "x" CHECK ('${c}')`;
    assert.equal(
      latestCheck(
        [
          { name: "2026_a", sql: sql("old") },
          { name: "2027_b", sql: sql("new") },
          { name: "2028_c", sql: "unrelated" },
        ],
        "x",
      ).name,
      "2027_b",
    );
  });
});
