import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkSentence, type ClaimScope } from "./compare.js";
import {
  buildVocabulary,
  DRAFT_VOCABULARY_ROWS,
  draftVocabulary,
} from "./vocabulary.js";

/**
 * One pair per row of the plan's 7a table: a sentence the evidence supports
 * (must pass) and its nearest wrong neighbour (must fail with the named
 * code). The pairs differ in as few words as possible, so a failure points at
 * the row and not at some other part of the sentence.
 *
 * The fixture claim: a controlled field experiment on Acropora, phosphate
 * 0.3-1 µmol/l (0.0285-0.095 mg/l PO4) decreasing calcification.
 */
const vocabulary = draftVocabulary();
const opts = { allowDraftVocabulary: true };

const ACROPORA_FIELD: ClaimScope = {
  taxa: ["ACROPORA"],
  environments: ["FIELD"],
  homeReefApplicability: "LIMITED",
  quantity: { minMgL: 0.0285, maxMgL: 0.095 },
  effect: "CALCIFICATION",
  direction: "DECREASE",
  evidenceLevel: "SINGLE_EXPERIMENT",
};

const BASE =
  "Egy kontrollált kísérletben a zátonyon 0,05 mg/l foszfát csökkentette az Acropora kalcifikációját.";

function codes(sentence: string, claim: ClaimScope = ACROPORA_FIELD): string[] {
  return checkSentence(sentence, claim, vocabulary, opts).failures.map(
    (f) => f.code,
  );
}
function passes(sentence: string, claim: ClaimScope = ACROPORA_FIELD) {
  assert.deepEqual(codes(sentence, claim), [], sentence);
}
function failsWith(
  sentence: string,
  code: string,
  claim: ClaimScope = ACROPORA_FIELD,
) {
  const got = codes(sentence, claim);
  assert.ok(
    got.includes(code),
    `expected ${code} for "${sentence}", got [${got.join(", ")}]`,
  );
}

describe("the base sentence", () => {
  it("passes against its own claim", () => passes(BASE));
});

describe("7a row: taxon", () => {
  it("the same genus passes; another genus is a swap", () => {
    passes(BASE);
    failsWith(BASE.replace("Acropora", "Montipora"), "TAXON_SWAP");
  });

  it("upwards (Acropora data -> SPS) needs the generalisation phrase", () => {
    const wider = BASE.replace("az Acropora", "az SPS-korallok");
    failsWith(wider, "TAXON_GENERALISED_UNMARKED");
    passes(`Általánosítva: ${wider}`);
  });

  it("downwards (genus data -> one species) needs the coarser-data phrase", () => {
    const narrower = BASE.replace("az Acropora", "az Acropora millepora");
    failsWith(narrower, "TAXON_NARROWED_UNMARKED");
    passes(`Nemzetség-szintű adat alapján: ${narrower}`);
  });

  it("species-level evidence carries to the same species without a phrase", () => {
    const species = { ...ACROPORA_FIELD, taxa: ["ACROPORA_MILLEPORA"] };
    passes(BASE.replace("az Acropora", "az Acropora millepora"), species);
    failsWith(
      BASE.replace("az Acropora", "az Acropora tenuis"),
      "TAXON_SWAP",
      species,
    );
  });

  it("a sentence without a recognised taxon fails (an implicit generalisation)", () => {
    failsWith(
      BASE.replace(" az Acropora", " a korallok").replace(
        "korallok",
        "telepek",
      ),
      "TAXON_MISSING",
    );
  });

  it("an unknown species name is not recognised, so it fails as a missing taxon", () => {
    failsWith(BASE.replace("az Acropora", "az Isopora"), "TAXON_MISSING");
  });
});

describe("7a row: negation", () => {
  const noEffect: ClaimScope = { ...ACROPORA_FIELD, direction: "NONE" };
  const negated = BASE.replace("csökkentette", "nem csökkentette");

  it("a negated decrease reverses a decreasing claim", () => {
    failsWith(negated, "REVERSED_BY_NEGATION");
  });

  it("the same negated sentence matches a claim that really found no effect", () => {
    passes(negated, noEffect);
    failsWith(BASE, "DIRECTION_REVERSED", noEffect);
  });

  it("'nincs hatással' is a no-effect statement", () => {
    passes(
      "Egy kontrollált kísérletben a zátonyon 0,05 mg/l foszfát nincs hatással az Acropora kalcifikációjára.",
      noEffect,
    );
  });

  it("two negators cannot be decided", () => {
    failsWith(
      negated.replace("foszfát", "foszfát sem"),
      "NEGATION_UNDECIDABLE",
      noEffect,
    );
  });

  it("a negator next to a subordinate clause cannot be decided", () => {
    failsWith(
      negated.replace("foszfát", "foszfát, amely a vízben volt,"),
      "NEGATION_UNDECIDABLE",
      noEffect,
    );
  });

  // barracuda, #1825 review (35515): the negator negated a different part.
  const negatesAnotherPart =
    "A nem kezelt kontrollhoz képest egy kontrollált kísérletben a zátonyon 0,05 mg/l foszfát csökkentette az Acropora kalcifikációját.";

  it("a negator that is not before the verb does not turn a decrease into 'no effect'", () => {
    failsWith(negatesAnotherPart, "NEGATION_UNDECIDABLE", noEffect);
  });

  it("the same sentence is undecidable against a decreasing claim too, not a lucky pass", () => {
    failsWith(negatesAnotherPart, "NEGATION_UNDECIDABLE");
  });

  it("a negated taxon ('nem Acropora fajokon') is undecidable, not a negated effect", () => {
    failsWith(
      BASE.replace("az Acropora", "a nem Acropora fajok"),
      "NEGATION_UNDECIDABLE",
      noEffect,
    );
  });

  it("a contrast word ('helyett') cannot be decided", () => {
    failsWith(
      BASE.replace("foszfát", "foszfát a nitrát helyett"),
      "NEGATION_UNDECIDABLE",
    );
  });

  it("'nemzetség' is not the negator 'nem'", () => {
    const parts = checkSentence(
      `Nemzetség-szintű adat alapján: ${BASE.replace("az Acropora", "az Acropora millepora")}`,
      ACROPORA_FIELD,
      vocabulary,
      opts,
    ).parts;
    assert.equal(parts.negation, "AFFIRMATIVE");
  });
});

describe("7a row: environment", () => {
  const inAquarium = BASE.replace("a zátonyon", "az akváriumban");
  const marked = `${inAquarium.slice(0, -1)}; terepi mérés, akváriumra csak korlátozottan.`;

  it("field data in an aquarium sentence needs the transfer phrase", () => {
    failsWith(inAquarium, "ENVIRONMENT_TRANSFER_UNMARKED");
    passes(marked);
  });

  it("the phrase is not enough when the editor ruled the transfer out or has not decided", () => {
    failsWith(marked, "ENVIRONMENT_TRANSFER_NOT_APPLICABLE", {
      ...ACROPORA_FIELD,
      homeReefApplicability: "NOT_APPLICABLE",
    });
    failsWith(marked, "ENVIRONMENT_TRANSFER_UNDECIDED", {
      ...ACROPORA_FIELD,
      homeReefApplicability: null,
    });
  });

  it("another environment that is not a transfer to an aquarium is a mismatch", () => {
    failsWith(BASE.replace("a zátonyon", "a laborban"), "ENVIRONMENT_MISMATCH");
  });

  it("a sentence without an environment fails", () => {
    failsWith(BASE.replace(" a zátonyon", ""), "ENVIRONMENT_NOT_STATED");
  });

  it("'zátonyakvárium' is an aquarium, not a reef", () => {
    failsWith(
      BASE.replace("a zátonyon", "a zátonyakváriumban"),
      "ENVIRONMENT_TRANSFER_UNMARKED",
    );
  });
});

describe("7a row: quantity", () => {
  it("a value inside the range passes; one outside fails", () => {
    passes(BASE);
    failsWith(BASE.replace("0,05", "0,2"), "QUANTITY_OUT_OF_RANGE");
  });

  it("rounding is allowed up to the tolerance only", () => {
    passes(BASE.replace("0,05", "0,10"));
    failsWith(BASE.replace("0,05", "0,11"), "QUANTITY_OUT_OF_RANGE");
  });

  it("a µmol/l value is compared after conversion, without a basis", () => {
    passes(BASE.replace("0,05 mg/l foszfát", "0,5 µmol/l foszfát"));
    failsWith(
      BASE.replace("0,05 mg/l foszfát", "2 µmol/l foszfát"),
      "QUANTITY_OUT_OF_RANGE",
    );
  });

  it("the same number as mg/l P is three times more PO4, and falls out of range", () => {
    passes(BASE.replace("0,05 mg/l", "0,03 mg/l P"));
    failsWith(
      BASE.replace("0,05 mg/l", "0,05 mg/l P"),
      "QUANTITY_OUT_OF_RANGE",
    );
  });

  it("a mass unit without PO4 or P fails", () => {
    failsWith(BASE.replace("foszfát", "tápanyag"), "QUANTITY_BASIS_UNKNOWN");
  });

  it("a range must fit inside the evidence range at both ends", () => {
    passes(BASE.replace("0,05 mg/l foszfát", "0,03–0,09 mg/l foszfát"));
    failsWith(
      BASE.replace("0,05 mg/l foszfát", "0,01–0,09 mg/l foszfát"),
      "QUANTITY_OUT_OF_RANGE",
    );
  });

  it("a number that is not a phosphate quantity fails", () => {
    failsWith(
      BASE.replace("csökkentette", "20%-kal csökkentette"),
      "QUANTITY_UNRECOGNISED",
    );
    failsWith(BASE.replace("0,05 mg/l", "0,05 mg"), "QUANTITY_UNRECOGNISED");
  });

  it("a quantity about a claim without one fails", () => {
    failsWith(BASE, "QUANTITY_NOT_IN_EVIDENCE", {
      ...ACROPORA_FIELD,
      quantity: null,
    });
  });
});

describe("7a row: effect and direction", () => {
  it("the opposite verb reverses the claim", () => {
    failsWith(BASE.replace("csökkentette", "növelte"), "DIRECTION_REVERSED");
  });

  it("a related but different effect is a mismatch", () => {
    failsWith(
      BASE.replace("kalcifikációját", "vázsűrűségét"),
      "EFFECT_MISMATCH",
    );
  });

  it("an effect must be stated", () => {
    failsWith(BASE.replace("kalcifikációját", "telepét"), "EFFECT_NOT_STATED");
  });

  it("an undirected verb is not enough for a directed claim", () => {
    failsWith(
      BASE.replace("csökkentette", "befolyásolta"),
      "DIRECTION_NOT_STATED",
    );
  });

  it("verbs of both directions are ambiguous", () => {
    failsWith(
      BASE.replace("csökkentette", "növelte és csökkentette"),
      "DIRECTION_AMBIGUOUS",
    );
  });
});

describe("7a row: strength", () => {
  it("a verb above the claim's level is too strong", () => {
    failsWith(
      BASE.replace("Egy kontrollált kísérletben", "Kimutatták, hogy"),
      "STRENGTH_TOO_STRONG",
    );
  });

  it("a plain declarative claims the top level", () => {
    failsWith(
      BASE.replace("Egy kontrollált kísérletben a", "A"),
      "STRENGTH_TOO_STRONG",
    );
    passes(BASE.replace("Egy kontrollált kísérletben a", "A"), {
      ...ACROPORA_FIELD,
      evidenceLevel: "CONSISTENT_EXPERIMENTS",
    });
  });

  it("an observation may not 'cause' but may 'point to'", () => {
    const observational: ClaimScope = {
      ...ACROPORA_FIELD,
      evidenceLevel: "OBSERVATIONAL",
    };
    passes(
      BASE.replace(
        "Egy kontrollált kísérletben",
        "Egy terepi megfigyelés szerint",
      ),
      observational,
    );
    failsWith(BASE, "STRENGTH_TOO_STRONG", observational);
    failsWith(
      BASE.replace(
        "Egy kontrollált kísérletben",
        "Egy terepi megfigyelés szerint",
      ).replace("csökkentette", "csökkentette, és ezt okozza"),
      "STRENGTH_TOO_STRONG",
      observational,
    );
  });

  it("a claim without an evidence level cannot be stated", () => {
    failsWith(BASE, "STRENGTH_NO_LEVEL", {
      ...ACROPORA_FIELD,
      evidenceLevel: null,
    });
  });
});

describe("7a row: overgeneralisation", () => {
  it("is reported when the sentence is wider than the evidence, and not otherwise", () => {
    failsWith(
      BASE.replace("az Acropora", "az SPS-korallok"),
      "SCOPE_WIDER_THAN_EVIDENCE",
    );
    failsWith(BASE.replace("0,05", "0,2"), "SCOPE_WIDER_THAN_EVIDENCE");
    passes(BASE);
  });

  it("a mismatch that is not a widening does not report it", () => {
    const got = codes(BASE.replace("csökkentette", "növelte"));
    assert.ok(!got.includes("SCOPE_WIDER_THAN_EVIDENCE"), got.join(", "));
  });
});

describe("guards the table relies on", () => {
  it("a conditional construction fails", () => {
    failsWith(
      BASE.replace("Egy kontrollált", "Csak ha a fény erős, egy kontrollált"),
      "UNSUPPORTED_CONSTRUCTION",
    );
  });

  it("'ha' is matched as a word, not inside 'hatás'", () => {
    const noEffect: ClaimScope = { ...ACROPORA_FIELD, direction: "NONE" };
    const got = codes(
      "Egy kontrollált kísérletben a zátonyon 0,05 mg/l foszfát nincs hatással az Acropora kalcifikációjára.",
      noEffect,
    );
    assert.ok(!got.includes("UNSUPPORTED_CONSTRUCTION"), got.join(", "));
  });

  it("a DRAFT vocabulary gates nothing unless the caller opts in", () => {
    const got = checkSentence(BASE, ACROPORA_FIELD, vocabulary).failures.map(
      (f) => f.code,
    );
    assert.deepEqual(got, ["VOCABULARY_NOT_APPROVED"]);
    const approved = buildVocabulary(
      DRAFT_VOCABULARY_ROWS.map((r) => ({ ...r, status: "APPROVED" as const })),
    );
    assert.deepEqual(
      checkSentence(BASE, ACROPORA_FIELD, approved).failures.map((f) => f.code),
      [],
    );
  });
});
