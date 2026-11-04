import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { euKey, huBase } from "./partner-duplicate-groups.js";

/**
 * A GENERÁLT KULCS-OSZLOPOK SZABÁLYA EGYEZIK A MÉRÉSÉVEL (egy partnertörzs, 2. lépés). A migráció `huTaxBase` és `euTaxKey`
 * kifejezése PostgreSQL-ben írja le ugyanazt, amit a csak olvasó mérés `huBase` és `euKey` függvénye TypeScriptben. A két
 * szabály egymástól függetlenül elcsúszhatna, és akkor az oszlop más csoportot adna, mint amit Balázs a listán látott.
 *
 * MI PIROSÍT: ha a migráció mintája más értéket fogad el vagy más kulcsot ad, mint a TypeScript-függvény egy ismert esetre.
 * HATÁRA, KIMONDVA: a migráció MINTÁIT futtatja JavaScript reguláris kifejezésként (a POSIX-osztály átírásával), nem a
 * PostgreSQL-t; a valódi adatbázison az integrációs teszt (`partner-register-columns.integration.spec.ts`) veti össze az
 * oszlopokat a függvényekkel.
 */
const SQL = readFileSync(
  new URL(
    "../../../../packages/database/prisma/migrations/20261104190000_partner_register_schema/migration.sql",
    import.meta.url,
  ),
  "utf8",
).replace(/^\s*--.*$/gm, "");

/** A migráció egy idézőjeles mintája a kulcsszó után; a POSIX `[[:space:]]` a JavaScript `\s`-e. */
function pattern(after: RegExp): RegExp {
  const match = after.exec(SQL);
  assert.ok(match, `nem találom a mintát: ${after}`);
  return new RegExp(
    match[1]!.replaceAll("[[:space:]]", "\\s"),
    after.source.includes("~\\*") ? "i" : "",
  );
}

const huShape = pattern(/"taxNumber" ~\* '([^']+)'/);
const huBaseOf = /substring\("taxNumber" from '([^']+)'\)/.exec(SQL)?.[1];
const euStrip = /regexp_replace\("euTaxNumber", '([^']+)', '', 'g'\)/.exec(
  SQL,
)?.[1];
const euShape = /\) ~ '([^']+)'/.exec(SQL)?.[1];

const huSql = (value: string | null): string | null => {
  if (value === null || !huShape.test(value)) return null;
  return new RegExp(huBaseOf!).exec(value)![0];
};
const euSql = (value: string | null): string | null => {
  if (value === null) return null;
  const compact = value.replace(new RegExp(euStrip!, "g"), "").toUpperCase();
  return new RegExp(euShape!).test(compact) ? compact : null;
};

const HU_CASES: (string | null)[] = [
  null,
  "",
  "   ",
  "12345678",
  "12345678-1-42",
  "12345678142",
  "12345678-142",
  "12345678-1-4",
  " 12345678-1-42 ",
  "\t12345678-1-42\n",
  "HU12345678",
  "hu12345678",
  "HU 12345678",
  "hu  12345678-1-42",
  "HU12345678-1-42",
  "12345678-1-42x",
  "12 34 56 78-1-42",
  "1234567",
  "123456789",
  "12345678-12-42",
  "4 12345678",
  "41234567-2-44",
  "41234567",
  "DE123456789",
  "SK2020123456",
  "HU-12345678",
  "ab12345678",
  "12345678-1-42-3",
  "12345678 1 42",
];

const EU_CASES: (string | null)[] = [
  null,
  "",
  "DE123456789",
  "de123456789",
  "DE 123 456 789",
  "sk 2020-123 456",
  "SK2020123456",
  "ATU12345678",
  "HU12345678",
  "12345678",
  "D",
  "DE",
  "DE1",
  "DE12",
  "1E123456",
  " fr 12 345678901 ",
  "GB-123 4567 89",
  "ÁT123456",
  "DE123456789!",
];

describe("the generated key columns follow the measurement's rule", () => {
  it("finds the four patterns in the migration", () => {
    assert.ok(huBaseOf && euStrip && euShape);
  });

  it("huTaxBase: the same values are Hungarian tax numbers, with the same base", () => {
    for (const value of HU_CASES)
      assert.equal(huSql(value), huBase(value), JSON.stringify(value));
  });

  it("euTaxKey: the same values are community keys, with the same normal form", () => {
    for (const value of EU_CASES)
      assert.equal(euSql(value), euKey(value), JSON.stringify(value));
  });

  it("the cases are not all nulls: both rules accept and refuse something", () => {
    assert.ok(HU_CASES.some((value) => huBase(value) !== null));
    assert.ok(HU_CASES.some((value) => huBase(value) === null));
    assert.ok(EU_CASES.some((value) => euKey(value) !== null));
    assert.ok(EU_CASES.some((value) => euKey(value) === null));
  });
});
