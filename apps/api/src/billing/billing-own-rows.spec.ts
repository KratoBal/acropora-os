import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isOwnRow, OWN_ROWS } from "./billing-own-rows.js";

/**
 * AZ `OWN_ROWS` ÉS AZ `isOwnRow` EGYEZIK. MI PIROSÍT: ha valaki az egyik alakot
 * módosítja (új feltétel az `OWN_ROWS`-ban), a másikat nem: a lánc "megnyitható"
 * jelzője és a részletek oldala szétcsúszna (404 egy linken).
 */
interface Row {
  direction: string;
  source: string;
  sourceType: string | null;
  completionCertificateId: string | null;
}

/** Evaluates the Prisma where shape of OWN_ROWS on a loaded row. */
function matchesWhere(row: Row): boolean {
  return Object.entries(OWN_ROWS).every(([field, condition]) => {
    const value = row[field as keyof Row];
    if (condition === null) return value === null;
    if (typeof condition === "string") return value === condition;
    // { not: null }
    assert.deepEqual(
      Object.keys(condition),
      ["not"],
      `unknown shape: ${field}`,
    );
    assert.equal((condition as { not: unknown }).not, null);
    return value !== null;
  });
}

describe("OWN_ROWS and isOwnRow", () => {
  const rows: Row[] = [];
  for (const direction of ["OUTBOUND", "INBOUND"])
    for (const source of ["SZAMLAZZ", "NAV", "UNAS"])
      for (const sourceType of [null, "PROJECT"])
        for (const completionCertificateId of [null, "cc-1"])
          rows.push({ direction, source, sourceType, completionCertificateId });

  it("agree on every combination of the four fields", () => {
    assert.equal(rows.length, 24);
    for (const row of rows)
      assert.equal(isOwnRow(row), matchesWhere(row), JSON.stringify(row));
  });

  it("accept exactly one combination out of the 24", () => {
    assert.deepEqual(rows.filter(isOwnRow), [
      {
        direction: "OUTBOUND",
        source: "SZAMLAZZ",
        sourceType: "PROJECT",
        completionCertificateId: null,
      },
    ]);
  });

  it("do not take a storno row (no source reference) or a maintenance invoice for an own row", () => {
    const base = {
      direction: "OUTBOUND",
      source: "SZAMLAZZ",
      sourceType: "PROJECT",
      completionCertificateId: null,
    };
    assert.equal(isOwnRow({ ...base, sourceType: null }), false);
    assert.equal(isOwnRow({ ...base, completionCertificateId: "cc-1" }), false);
  });
});
