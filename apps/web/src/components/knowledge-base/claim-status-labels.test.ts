import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CLAIM_STATUS_LABELS, claimStatusLabel } from "./claim-status-labels";

/*
  AZ ÁLLÍTÁS ÁLLAPOTA SZAVAKKAL, EGY HELYEN (UI-áttekintés, 4. csomag, 2026-11-03). MI PIROSÍT: ha a Prisma
  `KnowledgeClaimStatus` felsorolásába új érték kerül, és a térképben nincs felirata (a lap akkor nyers kódot
  írna); ha a térképben olyan kulcs marad, ami a sémából kikerült; ha egy ismeretlen érték nem változatlanul jön
  vissza. A séma szövegét olvassuk, mert az adatbázis-csomag típusát a web nem importálja.
*/
function schemaValues(): string[] {
  const schema = readFileSync(
    join(
      process.cwd(),
      "..",
      "..",
      "packages",
      "database",
      "prisma",
      "schema.prisma",
    ),
    "utf8",
  );
  const block = /enum KnowledgeClaimStatus \{([^}]*)\}/.exec(schema)?.[1] ?? "";
  return block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[A-Z_]+$/.test(line));
}

describe("claim status labels", () => {
  it("the schema parse finds the enum (positive control)", () => {
    expect(schemaValues().length).toBeGreaterThanOrEqual(5);
  });

  it("has a Hungarian word for every value of the Prisma enum, and nothing else", () => {
    expect(Object.keys(CLAIM_STATUS_LABELS).sort()).toEqual(
      schemaValues().sort(),
    );
  });

  it("says VERIFIED as Ellenőrzött and says an unknown value in words, not as the raw code", () => {
    expect(claimStatusLabel("VERIFIED")).toBe("Ellenőrzött");
    expect(claimStatusLabel("DISPUTED")).toBe("Vitatott");
    expect(claimStatusLabel("SOMETHING_NEW")).toBe("Ismeretlen állapot");
  });
});
