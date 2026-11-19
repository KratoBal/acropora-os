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

/** The kinds that speak of ONE worksheet: their `worksheetId` is set at insert and NULLED by `ON DELETE SET NULL` when the worksheet goes. */
export const WORKSHEET_KINDS = [
  "WORKSHEET_ATTACHED",
  "WORKSHEET_DETACHED",
  "WORKSHEET_LINKED",
  "WORKSHEET_UNLINKED",
] as const;

/** The `OR (...)` branch of the CHECK that names a kind, or `null`. */
export function branchFor(checkSql: string, kind: string): string | null {
  const body = checkSql.slice(checkSql.indexOf("CHECK"));
  return (
    body.split(/\n\s*OR\s*\(/).find((branch) => branch.includes(`'${kind}'`)) ??
    null
  );
}

/**
 * WHICH WORKSHEET KINDS THE CHECK FORBIDS A NULL `worksheetId` ON. `ServiceJobEvent.worksheetId` is `ON DELETE SET NULL`, and Postgres
 * runs the CHECK on the row the referential action rewrites: a branch that demands `worksheetId IS NOT NULL` makes the DELETE of a
 * worksheet that has such an event fail (barracuda, #2753; on main it already held for `WORKSHEET_DETACHED`).
 */
export function kindsForbiddingNullWorksheet(
  checkSql: string,
  kinds: readonly string[],
): string[] {
  return kinds.filter((kind) => {
    const branch = branchFor(checkSql, kind);
    return branch === null || /"worksheetId"\s+IS\s+NOT\s+NULL/.test(branch);
  });
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

  it("lets every worksheet kind keep a NULL worksheetId, so deleting a worksheet with a log row can SET NULL", () => {
    const check = latestCheck(migrations, "ServiceJobEvent_kind_fields_agree");
    assert.deepEqual(
      kindsForbiddingNullWorksheet(check.sql, WORKSHEET_KINDS),
      [],
      check.name,
    );
  });

  // NEGATIVE CONTROLS: the old shape (worksheetId IS NOT NULL on the worksheet branch) is named, and so is a kind with no branch
  it("names a worksheet kind whose branch demands a worksheet", () => {
    const old = `CHECK (
      ("kind" = 'STATUS_CHANGE' AND "toStatus" IS NOT NULL AND "worksheetId" IS NULL)
      OR ("kind" IN ('WORKSHEET_ATTACHED', 'WORKSHEET_LINKED') AND "toStatus" IS NULL AND "worksheetId" IS NOT NULL)
    )`;
    assert.deepEqual(
      kindsForbiddingNullWorksheet(old, [
        "WORKSHEET_ATTACHED",
        "WORKSHEET_LINKED",
      ]),
      ["WORKSHEET_ATTACHED", "WORKSHEET_LINKED"],
    );
    assert.deepEqual(
      kindsForbiddingNullWorksheet(old, ["WORKSHEET_UNLINKED"]),
      ["WORKSHEET_UNLINKED"],
    );
  });

  it("does not blame a kind that sits in a branch allowing NULL", () => {
    const fixed = `CHECK (
      ("kind" = 'STATUS_CHANGE' AND "toStatus" IS NOT NULL AND "worksheetId" IS NULL)
      OR ("kind" IN ('WORKSHEET_LINKED') AND "toStatus" IS NULL)
    )`;
    assert.deepEqual(
      kindsForbiddingNullWorksheet(fixed, ["WORKSHEET_LINKED"]),
      [],
    );
  });
});
