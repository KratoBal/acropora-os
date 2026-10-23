import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  basisWritten,
  numbersAtUnit,
  taxonInText,
  unitWritten,
} from "./anchor-check.js";
import { vocabularyV1 } from "./vocabulary.js";

/**
 * THE OS'S OWN READING OF AN ANCHOR (S3). The same cases the AI service's
 * guard answers, read again here: what turns it red is a number away from its
 * unit, a micrometre read as micromolar, a P-basis anchor taken as PO4, or a
 * taxon key whose name is not in its anchor.
 */
describe("a quantity's number stands with its unit", () => {
  it("single values, ranges, between ... and, and an error", () => {
    assert.deepEqual([...numbersAtUnit("µmol/l", "at 2 µM phosphate")], [2]);
    assert.deepEqual([...numbersAtUnit("µmol/l", "0.5–2 µM")].sort(), [0.5, 2]);
    assert.deepEqual(
      [...numbersAtUnit("µmol/l", "0,5 to 2 μmol L−1")].sort(),
      [0.5, 2],
    );
    assert.deepEqual(
      [...numbersAtUnit("µmol/l", "between 0.5 and 2 µM")].sort(),
      [0.5, 2],
    );
    assert.deepEqual([...numbersAtUnit("µmol/l", "1.5 ± 0.2 µM")], [1.5]);
    assert.deepEqual([...numbersAtUnit("mg/l", "0.3 mg/L phosphate")], [0.3]);
    assert.deepEqual([...numbersAtUnit("mg/l", "0.03 mg l-1 PO4")], [0.03]);
  });

  it("30 days and a pH are not concentrations", () => {
    assert.deepEqual(
      [...numbersAtUnit("µmol/l", "after 30 days at 0.5 µM")],
      [0.5],
    );
    assert.deepEqual([...numbersAtUnit("µmol/l", "pH 8.1 and 0.5 µM")], [0.5]);
    // a between-range with no unit after it is not a concentration either
    assert.deepEqual(
      [...numbersAtUnit("µmol/l", "between 8.0 and 8.3 and 0.5 µM")],
      [0.5],
    );
  });

  it("µM is micromolar, µm a micrometre", () => {
    assert.equal(unitWritten("µmol/l", "2 µM phosphate"), true);
    assert.equal(unitWritten("µmol/l", "fragments of 2 µm"), false);
    assert.deepEqual([...numbersAtUnit("µmol/l", "fragments of 2 µm")], []);
  });
});

describe("the basis of a mass unit", () => {
  it("PO4-P, SRP and phosphorus are P, even next to 'phosphate'; a bare p is not read", () => {
    assert.equal(basisWritten("P", "0.3 mg/L phosphate (PO4-P)"), true);
    assert.equal(basisWritten("PO4", "0.3 mg/L phosphate (PO4-P)"), false);
    assert.equal(basisWritten("PO4", "0.3 mg/L phosphate"), true);
    assert.equal(basisWritten("P", "0.3 mg/L SRP"), true);
    assert.equal(basisWritten("P", "0.3 mg/L (p < 0.05)"), false);
  });
});

describe("a taxon in its anchor", () => {
  const v = vocabularyV1();
  it("a genus or a species by its Latin form, a species also abbreviated", () => {
    assert.equal(taxonInText(v, "ACROPORA", "Acropora spp. colonies"), true);
    assert.equal(
      taxonInText(v, "ACROPORA_MILLEPORA", "Colonies of Acropora millepora"),
      true,
    );
    assert.equal(
      taxonInText(v, "ACROPORA_MILLEPORA", "A. millepora nubbins"),
      true,
    );
    assert.equal(
      taxonInText(v, "ACROPORA_MILLEPORA", "M. millepora nubbins"),
      false,
    );
    assert.equal(
      taxonInText(v, "ACROPORA_MILLEPORA", "Acropora tenuis"),
      false,
    );
  });

  it("a group named in English does not meet its Hungarian form: a question, not a field", () => {
    assert.equal(taxonInText(v, "STONY_CORAL", "scleractinian corals"), false);
    assert.equal(taxonInText(v, "NOT_A_KEY", "Acropora"), false);
  });
});
