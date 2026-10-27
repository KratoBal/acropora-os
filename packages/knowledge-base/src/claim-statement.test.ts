import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PackageClaim } from "./answer-gate.js";
import {
  claimStatement,
  writtenNumber,
  type OriginalQuantity,
} from "./claim-statement.js";
import type { ClaimScope } from "./compare.js";
import { vocabularyV1 } from "./vocabulary.js";

/**
 * The statement the answering model may copy (S6, slice 3). Every statement
 * that comes out has passed the answer gate on its own claim (the builder
 * checks it), so each `ok` below is also a gate pass; the exact strings pin
 * the wording. The last group shows the self-check refusing a claim whose
 * stored original value disagrees with its normalised range.
 */
const vocabulary = vocabularyV1();

const FIELD_DECREASE: ClaimScope = {
  taxa: ["ACROPORA"],
  environments: ["FIELD"],
  homeReefApplicability: "LIMITED",
  quantity: { minMgL: 0.0285, maxMgL: 0.095 },
  effect: "CALCIFICATION",
  direction: "DECREASE",
  evidenceLevel: "SINGLE_EXPERIMENT",
};
const MICROMOLAR: OriginalQuantity = {
  min: "0.3",
  max: "1",
  unit: "µmol/l",
  basis: null,
};

function build(
  over: Partial<PackageClaim> = {},
  scope: Partial<ClaimScope> = {},
  quantity: OriginalQuantity | null = MICROMOLAR,
) {
  const claim: PackageClaim = {
    id: "k1",
    layer: "SCIENTIFIC",
    citation: "Koop és mtsai, 2001",
    ...over,
    scope: { ...FIELD_DECREASE, ...scope },
  };
  return claimStatement({ claim, quantity, vocabulary });
}
function statement(...args: Parameters<typeof build>): string {
  const r = build(...args);
  assert.ok(r.ok, r.ok ? "" : `${r.failure}: ${r.detail}`);
  return r.statement;
}

describe("the statement", () => {
  it("a scientific claim: layer, certainty, setting, quantity, effect, direction", () => {
    assert.equal(
      statement(),
      "Kutatás szerint, egy kísérletben zátony környezetben, Acropora esetén 0,3–1 µmol/l foszfát mellett a kalcifikáció csökken.",
    );
  });

  it("each layer gets its phrase; the manufacturer's is its certainty phrase too", () => {
    assert.match(
      statement(
        { layer: "HOBBY_EXPERIENCE" },
        { environments: ["HOME_AQUARIUM"], evidenceLevel: "SINGLE_REPORT" },
      ),
      /^Akvarisztikai tapasztalat szerint, egy beszámoló szerint akvárium környezetben/,
    );
    assert.match(
      statement(
        { layer: "MANUFACTURER" },
        { environments: ["HOME_AQUARIUM"], evidenceLevel: "SINGLE_REPORT" },
      ),
      /^A gyártó tájékoztatása szerint akvárium környezetben/,
    );
    assert.match(
      statement({ layer: "OWN_CONCLUSION" }),
      /^Következtetésünk, egy kísérletben/,
    );
  });

  it("each evidence level gets the phrase of that level", () => {
    const lead = (evidenceLevel: ClaimScope["evidenceLevel"]) =>
      statement({}, { evidenceLevel }).split(" zátony")[0];
    assert.deepEqual(
      [
        lead("SINGLE_REPORT"),
        lead("OBSERVATIONAL"),
        lead("SINGLE_EXPERIMENT"),
        lead("CONSISTENT_EXPERIMENTS"),
      ],
      [
        "Kutatás szerint, egy beszámoló szerint",
        "Kutatás szerint, megfigyelés szerint",
        "Kutatás szerint, egy kísérletben",
        "Kutatás szerint, több kísérlet egybehangzóan",
      ],
    );
  });

  it("the three directions", () => {
    assert.match(
      statement({}, { direction: "INCREASE" }),
      / mellett a kalcifikáció nő\.$/,
    );
    assert.match(
      statement({}, { direction: "NONE" }),
      / mellett nincs hatás a kalcifikációra\.$/,
    );
    assert.match(
      statement({}, { direction: "NONE", effect: "COLORATION" }),
      / mellett nincs hatás a színezetre\.$/,
    );
  });

  it("species, groups and several taxa and settings are named as the evidence has them", () => {
    assert.match(
      statement({}, { taxa: ["ACROPORA_MILLEPORA"] }),
      /, Acropora millepora esetén /,
    );
    assert.match(statement({}, { taxa: ["SPS"] }), /, SPS esetén /);
    assert.match(
      statement(
        {},
        { taxa: ["ACROPORA", "MONTIPORA"], environments: ["FIELD", "LAB"] },
      ),
      / zátony és labor környezetben, Acropora és Montipora esetén /,
    );
  });

  it("a claim with no taxon, setting or quantity names none", () => {
    assert.equal(
      statement({}, { taxa: [], environments: [], quantity: null }, null),
      "Kutatás szerint, egy kísérletben a kalcifikáció csökken.",
    );
  });

  it("a mass unit carries its basis, and the basis word agrees with it", () => {
    assert.match(
      statement(
        {},
        { quantity: { minMgL: 0.03, maxMgL: 0.1 } },
        { min: "0.03", max: "0.1", unit: "mg/l", basis: "PO4" },
      ),
      / 0,03–0,1 mg\/l PO4 foszfát mellett /,
    );
    assert.match(
      statement(
        {},
        { quantity: { minMgL: 0.0307, maxMgL: 0.0307 } },
        { min: "0.01", max: "0.01", unit: "mg/l", basis: "P" },
      ),
      / 0,01 mg\/l P foszfor mellett /,
    );
  });

  it("an open side is written as a bound", () => {
    assert.match(
      statement(
        {},
        { quantity: { minMgL: 0.0285, maxMgL: Number.POSITIVE_INFINITY } },
        { min: "0.3", max: null, unit: "µmol/l", basis: null },
      ),
      / legalább 0,3 µmol\/l foszfát mellett /,
    );
    assert.match(
      statement(
        {},
        { quantity: { minMgL: 0, maxMgL: 0.095 } },
        { min: null, max: "1", unit: "µmol/l", basis: null },
      ),
      / legfeljebb 1 µmol\/l foszfát mellett /,
    );
  });
});

describe("written numbers", () => {
  it("a Hungarian comma, no trailing zeros, and never a three-decimal value that reads as a thousands group", () => {
    assert.deepEqual(
      ["2", "2.000", "1.50", "0.125", "1.125", "0.000900000", "12.3456"].map(
        writtenNumber,
      ),
      ["2", "2", "1,5", "0,125", "1,1250", "0,0009", "12,3456"],
    );
    assert.equal(writtenNumber("-1"), null);
    assert.equal(writtenNumber("1e3"), null);
  });
  it("the padded value is recognised by the gate", () => {
    statement(
      {},
      { quantity: { minMgL: 1.125, maxMgL: 1.125 } },
      { min: "1.125", max: "1.125", unit: "mg/l", basis: "PO4" },
    );
  });
});

describe("what cannot be stated", () => {
  const failure = (...args: Parameters<typeof build>) => {
    const r = build(...args);
    assert.ok(!r.ok, "expected a failure");
    return r.failure;
  };
  it("names its reason", () => {
    assert.equal(failure({}, { effect: null }), "NO_EFFECT");
    assert.equal(failure({}, { direction: null }), "NO_DIRECTION");
    assert.equal(failure({}, { evidenceLevel: null }), "NO_EVIDENCE_LEVEL");
    assert.equal(
      failure({}, { effect: "MICROBIOME_COMPOSITION" }),
      "TERM_NOT_IN_VOCABULARY",
    );
    assert.equal(failure({}, { taxa: ["ZOANTHUS"] }), "TERM_NOT_IN_VOCABULARY");
    assert.equal(
      failure({}, {}, { ...MICROMOLAR, unit: "mmol/l" }),
      "QUANTITY_NOT_WRITABLE",
    );
    assert.equal(
      failure({}, {}, { min: "0.03", max: "0.1", unit: "mg/l", basis: null }),
      "QUANTITY_NOT_WRITABLE",
    );
    assert.equal(failure({}, {}, null), "QUANTITY_NOT_WRITABLE");
  });
  it("the self-check: an original value outside the claim's normalised range is never handed out", () => {
    const r = build(
      {},
      {},
      { min: "3", max: "5", unit: "µmol/l", basis: null },
    );
    assert.ok(!r.ok);
    assert.equal(r.failure, "BUILT_SENTENCE_FAILS_GATE");
    assert.match(r.detail, /QUANTITY_OUT_OF_RANGE/);
  });
});
