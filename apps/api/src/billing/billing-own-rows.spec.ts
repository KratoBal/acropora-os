import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isOwnRow, OWN_ROWS } from "./billing-own-rows.js";

/**
 * AZ `OWN_ROWS` ÉS AZ `isOwnRow` EGYEZIK. MI PIROSÍT: ha valaki az egyik alakot
 * módosítja (új feltétel az `OWN_ROWS`-ban), a másikat nem: a lánc "megnyitható"
 * jelzője és a részletek oldala szétcsúszna (404 egy linken).
 *
 * ÉS A TIG-SZÁMLA (Balázs 2026-11-11 13:22 UTC): a kiállított, `COMPLETION_CERTIFICATE` forrású sor SAJÁT (a feed
 * ikre nem Külső sorként mutatja, és sztornózható); a forrás nélküli TIG-piszkozat nem az.
 */
interface Row {
  direction: string;
  source: string;
  sourceType: string | null;
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
      for (const sourceType of [null, "PROJECT", "COMPLETION_CERTIFICATE"])
        rows.push({ direction, source, sourceType });

  it("agree on every combination of the three fields", () => {
    assert.equal(rows.length, 18);
    for (const row of rows)
      assert.equal(isOwnRow(row), matchesWhere(row), JSON.stringify(row));
  });

  it("accept exactly the outbound Számlázz.hu rows with a source, the issued TIG invoice among them", () => {
    assert.deepEqual(rows.filter(isOwnRow), [
      { direction: "OUTBOUND", source: "SZAMLAZZ", sourceType: "PROJECT" },
      {
        direction: "OUTBOUND",
        source: "SZAMLAZZ",
        sourceType: "COMPLETION_CERTIFICATE",
      },
    ]);
  });

  it("do not take a storno row or a TIG draft (neither has a source) for an own row", () => {
    const base = { direction: "OUTBOUND", source: "SZAMLAZZ" };
    assert.equal(isOwnRow({ ...base, sourceType: null }), false);
    assert.equal(
      isOwnRow({ ...base, sourceType: "COMPLETION_CERTIFICATE" }),
      true,
    );
  });

  it("the where shape no longer names the certificate: the source decides", () => {
    assert.equal("completionCertificateId" in OWN_ROWS, false);
  });
});
