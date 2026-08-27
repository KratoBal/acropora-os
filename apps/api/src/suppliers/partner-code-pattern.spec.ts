// The decorators on the DTO read their metadata through `Reflect`, which the
// application installs in `main.ts`. A unit test starts without it, so the
// import has to come first, before the DTO module is evaluated.
import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { WORKSHEET_PARTNER_CODE_PATTERN } from "@acropora/types";

import { PARTNER_CODE } from "./dto/supplier.dto.js";

/**
 * The same value is guarded by two patterns in two packages: `PARTNER_CODE`
 * decides what the partner screen may save, `WORKSHEET_PARTNER_CODE_PATTERN`
 * decides what the worksheet number can be built from. They drifted apart
 * once -- the save rule allowed a leading digit, the number rule did not --
 * and the drift was silent, because nothing reads the two together. A code
 * saved that way passed validation, was offered in the worksheet picker (the
 * picker only asks whether a code exists at all), and refused to close.
 *
 * So the agreement is asserted rather than described: whatever the save rule
 * accepts, the number rule must accept too. The other direction is deliberately
 * NOT required -- the number rule is the wider of the two (two to eight
 * characters), and narrowing the save side is allowed.
 */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("");

describe("partner code patterns", () => {
  it("accepts nothing on the save side that the number side rejects", () => {
    const accepted: string[] = [];
    // Every character in every position, rather than one example per rule: the
    // two patterns can disagree in a single position, and a sample that
    // happens to be a letter everywhere would not see it.
    for (let position = 0; position < 4; position += 1) {
      for (const character of ALPHABET) {
        const code = "FANK".split("");
        code[position] = character;
        accepted.push(code.join(""));
      }
    }

    const disagreement = accepted.filter(
      (code) =>
        PARTNER_CODE.test(code) && !WORKSHEET_PARTNER_CODE_PATTERN.test(code),
    );
    assert.deepEqual(disagreement, []);
  });

  it("keeps the rules the two sides are supposed to have", () => {
    // The pinned cases, so a future edit that widens both patterns together
    // still has to say so out loud.
    assert.equal(PARTNER_CODE.test("FANK"), true);
    assert.equal(PARTNER_CODE.test("H2O1"), true, "digits stay allowed");
    assert.equal(PARTNER_CODE.test("1234"), false, "leading digit refused");
    assert.equal(PARTNER_CODE.test("FAN"), false, "three characters refused");
    assert.equal(PARTNER_CODE.test("FANKY"), false, "five characters refused");
    assert.equal(PARTNER_CODE.test("fank"), false, "lowercase refused");
  });
});
