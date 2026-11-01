/**
 * THE RESEARCH TEST SET (plan v4, section 10; slice S7): the machine groups
 * as pinned cases, run against the real functions, with each group's
 * threshold written out.
 *
 * The shape follows the Acropora AI's question set (`question-set.ts` in
 * acropora-ai-agent): every case is pinned with the property its result must
 * have, and every probe comes in PAIRS. A `must-apply` case is one where the
 * rule has to fire (a planted error dropped, for its own reason); a
 * `must-not-apply` case is its correct pair, where the rule must stay silent
 * (the sentence goes out). A set built from the first kind only cannot tell
 * "follows the rule" from "drops everything".
 *
 * A planted error counts as detected only if it is dropped FOR THE REASON THE
 * CASE PLANTED. A drop for some other reason (a typo in the case, an unrelated
 * row) would hide that the row under test never fired.
 *
 * In this file (no network, no database): T4 units, T5 layer phrases, T10 no
 * dose, T11 the gate's five cases, the machine classes of T13, and the
 * fifth T13 class as cases, the second model's input and the score of its
 * flags (no run: the model is called by the fleet-side runner, not from
 * here). Not here: T1 (DOI resolution needs the network), T2 and T6-T9 (the
 * API's answer path), T3 and T12 (the editor's gold set and the second
 * model).
 *
 * Nothing here scores with a model. Pure: no database, no clock.
 */

import {
  toMgPerLitrePo4,
  type PhosphateConcentration,
} from "@acropora/aquarium-calc";

import {
  ANSWER_FIXED_SENTENCES,
  ANSWER_GATE_VERSION,
  gateAnswer,
  type GateStatus,
  type PackageClaim,
} from "./answer-gate.js";
import type { ClaimScope } from "./compare.js";
import type { Vocabulary } from "./vocabulary.js";

export const TEST_SET_VERSION = "kb-test-set-v1";

export type TestGroup = "T4" | "T5" | "T10" | "T11" | "T13";
export type Polarity = "must-apply" | "must-not-apply";

/** The machine classes of T13 (plan 10 and 7a, 4.); the fifth, a related but other effect, is the second model's. */
export const T13_CLASSES = [
  "TAXON",
  "NEGATION",
  "ENVIRONMENT",
  "QUANTITY",
  "STRENGTH",
] as const;
export type T13Class = (typeof T13_CLASSES)[number];

/** Plan 10: at least five planted cases per T13 class, each with its correct pair. */
export const T13_MIN_CASES = 5;

/** One sentence through the answer gate. */
export interface GateCase {
  kind: "GATE";
  id: string;
  group: Exclude<TestGroup, "T4">;
  /** T13 only. */
  errorClass: T13Class | null;
  polarity: Polarity;
  /** Verbatim, with its `[[claim:<id>]]` markers. */
  text: string;
  /** The ids of FIXTURE_CLAIMS handed over; the default package when absent. */
  package?: readonly string[];
  /** DROPPED with one of `codes`, or the status the sentence must have. */
  expect:
    | { status: "DROPPED"; codes: readonly string[] }
    | { status: Exclude<GateStatus, "DROPPED"> };
  criterion: string;
}

/** One conversion to the comparison form, mg/l PO4. */
export interface UnitCase {
  kind: "UNIT";
  id: string;
  group: "T4";
  errorClass: null;
  /**
   * must-apply: the converted value equals `expectMgL`. must-not-apply: the
   * input carries the WRONG basis on purpose, and the converted value must
   * NOT equal `expectMgL` (the reading the right basis gives).
   */
  polarity: Polarity;
  input: PhosphateConcentration;
  expectMgL: number;
  criterion: string;
}

export type TestCase = GateCase | UnitCase;

/** Relative tolerance of a unit case: the conversion constants have four significant digits. */
export const UNIT_RELATIVE_TOLERANCE = 1e-3;

// ---------------------------------------------------------------------------
// THE FIXTURE CLAIMS. A controlled experiment on Acropora: phosphate 0.3-1
// µmol/l (0.0285-0.095 mg/l PO4) decreased calcification. The others differ
// from it in the one field a class needs.

const ACROPORA_FIELD: ClaimScope = {
  taxa: ["ACROPORA"],
  environments: ["FIELD"],
  homeReefApplicability: "LIMITED",
  quantity: { minMgL: 0.0285, maxMgL: 0.095 },
  effect: "CALCIFICATION",
  direction: "DECREASE",
  evidenceLevel: "SINGLE_EXPERIMENT",
};

export const FIXTURE_CLAIMS: readonly PackageClaim[] = [
  {
    id: "c1sci",
    layer: "SCIENTIFIC",
    scope: ACROPORA_FIELD,
    citation: "Koop és mtsai, 2001",
  },
  {
    id: "c2hob",
    layer: "HOBBY_EXPERIENCE",
    scope: {
      taxa: ["ACROPORA"],
      environments: ["HOME_AQUARIUM"],
      homeReefApplicability: "DIRECT",
      quantity: { minMgL: 0.03, maxMgL: 0.1 },
      effect: "COLORATION",
      direction: "INCREASE",
      evidenceLevel: "SINGLE_REPORT",
    },
    citation: "Holmes-Farley, 2002",
  },
  {
    // the same experiment, reported as "no effect": the negation class's pair
    id: "c3none",
    layer: "SCIENTIFIC",
    scope: { ...ACROPORA_FIELD, direction: "NONE" },
    citation: "Koop és mtsai, 2001",
  },
  {
    id: "c4lab",
    layer: "SCIENTIFIC",
    scope: { ...ACROPORA_FIELD, environments: ["LAB"] },
    citation: "Labor és mtsai, 2015",
  },
  {
    // field data the editor ruled out for a home aquarium
    id: "c5notapp",
    layer: "SCIENTIFIC",
    scope: { ...ACROPORA_FIELD, homeReefApplicability: "NOT_APPLICABLE" },
    citation: "Terep és mtsai, 2019",
  },
];

/** What a case gets when it names no package: the scientific and the hobby claim. */
export const DEFAULT_PACKAGE: readonly string[] = ["c1sci", "c2hob"];

// The sentence c1sci supports, as the model is asked to write it.
const BASE =
  "Kutatás szerint egy kontrollált kísérletben a zátonyon 0,05 mg/l foszfát csökkentette az Acropora kalcifikációját [[claim:c1sci]].";
const HOBBY =
  "Akvarisztikai tapasztalat szerint, egy akvarisztikai beszámoló szerint az otthoni akváriumban 0,05 mg/l foszfát növelte az Acropora színezetét [[claim:c2hob]].";

/** BASE with one change, refusing a change that did not apply. */
function base(from: string, to: string, text = BASE): string {
  const out = text.replace(from, to);
  if (out === text) throw new Error(`test set: "${from}" is not in the base`);
  return out;
}

const DROP = (...codes: string[]) => ({ status: "DROPPED" as const, codes });
const CITED = { status: "CITED" as const };

function gateCase(
  group: GateCase["group"],
  errorClass: T13Class | null,
  polarity: Polarity,
  id: string,
  text: string,
  expect: GateCase["expect"],
  criterion: string,
  pack?: readonly string[],
): GateCase {
  return {
    kind: "GATE",
    id,
    group,
    errorClass,
    polarity,
    text,
    expect,
    criterion,
    ...(pack ? { package: pack } : {}),
  };
}

/** A planted error and its correct pair, both in one class. */
function pair(
  errorClass: T13Class,
  id: string,
  planted: string,
  codes: string[],
  correct: string,
  criterion: string,
  pack?: readonly string[],
): GateCase[] {
  return [
    gateCase(
      "T13",
      errorClass,
      "must-apply",
      `${id}-planted`,
      planted,
      DROP(...codes),
      `dropped: ${criterion}`,
      pack,
    ),
    gateCase(
      "T13",
      errorClass,
      "must-not-apply",
      `${id}-correct`,
      correct,
      CITED,
      `its correct pair goes out: ${criterion}`,
      pack,
    ),
  ];
}

const NONE_BASE = base("csökkentette", "nem csökkentette").replace(
  "c1sci",
  "c3none",
);
const LAB_BASE = base("a zátonyon", "a laborban").replace("c1sci", "c4lab");
const TRANSFER = ", akváriumra csak korlátozottan,";

const T13_CASES: readonly GateCase[] = [
  // TAXON: a swap, and an unmarked change of scope up AND down
  ...pair(
    "TAXON",
    "taxon-swap-montipora",
    base("az Acropora", "a Montipora"),
    ["TAXON_SWAP"],
    BASE,
    "Montipora for Acropora data",
  ),
  ...pair(
    "TAXON",
    "taxon-swap-pocillopora",
    base("az Acropora", "a Pocillopora"),
    ["TAXON_SWAP"],
    base("a zátonyon", "a korallzátonyon"),
    "Pocillopora for Acropora data",
  ),
  ...pair(
    "TAXON",
    "taxon-swap-euphyllia",
    base("az Acropora", "az Euphyllia"),
    ["TAXON_SWAP"],
    base("kalcifikációját", "meszesedését"),
    "an LPS genus for Acropora data",
  ),
  ...pair(
    "TAXON",
    "taxon-up-sps",
    base("az Acropora", "a kis polipú kőkorallok"),
    ["TAXON_GENERALISED_UNMARKED"],
    base("az Acropora", "általánosítva a kis polipú kőkorallok"),
    "SPS corals from Acropora data, without the generalisation phrase",
  ),
  ...pair(
    "TAXON",
    "taxon-up-stony",
    base("az Acropora", "a kőkorallok"),
    ["TAXON_GENERALISED_UNMARKED"],
    base("az Acropora", "általánosítva a kőkorallok"),
    "stony corals from Acropora data, without the generalisation phrase",
  ),
  ...pair(
    "TAXON",
    "taxon-down-millepora",
    base("az Acropora", "az Acropora millepora"),
    ["TAXON_NARROWED_UNMARKED"],
    base("az Acropora", "nemzetség-szintű adat alapján az Acropora millepora"),
    "a species from genus-level data, without the coarser-data phrase",
  ),
  ...pair(
    "TAXON",
    "taxon-down-tenuis",
    base("az Acropora", "az Acropora tenuis"),
    ["TAXON_NARROWED_UNMARKED"],
    base("az Acropora", "nemzetségszintű adat alapján az Acropora tenuis"),
    "another species from genus-level data, without the phrase",
  ),

  // NEGATION: a negation reversing a decreasing claim, and the other way
  // round an affirmation of a "no effect" claim; the correct pair of the
  // latter is the negated sentence itself
  ...pair(
    "NEGATION",
    "negation-not-decrease",
    base("csökkentette", "nem csökkentette"),
    ["REVERSED_BY_NEGATION"],
    BASE,
    '"nem csökkentette" on a decreasing claim',
  ),
  ...pair(
    "NEGATION",
    "negation-not-inhibit",
    base("csökkentette", "nem gátolta"),
    ["REVERSED_BY_NEGATION"],
    base("csökkentette", "gátolta"),
    '"nem gátolta" on a decreasing claim',
  ),
  ...pair(
    "NEGATION",
    "negation-no-influence",
    base("csökkentette", "nem befolyásolta"),
    ["REVERSED_BY_NEGATION"],
    base("csökkentette", "mérsékelte"),
    '"nem befolyásolta" (no effect) on a decreasing claim',
  ),
  ...pair(
    "NEGATION",
    "negation-affirmed-none",
    base("nem csökkentette", "csökkentette", NONE_BASE),
    ["DIRECTION_REVERSED"],
    NONE_BASE,
    'a "no effect" claim stated as a decrease; the pair is the negated sentence',
    ["c3none"],
  ),
  ...pair(
    "NEGATION",
    "negation-affirmed-none-increase",
    base("nem csökkentette", "növelte", NONE_BASE),
    ["DIRECTION_REVERSED"],
    base("nem csökkentette", "nem befolyásolta", NONE_BASE),
    'a "no effect" claim stated as an increase; the pair negates a neutral verb',
    ["c3none"],
  ),

  // ENVIRONMENT: field or lab data carried into an aquarium without the
  // transfer phrase; and with it, where the editor ruled the transfer out
  ...pair(
    "ENVIRONMENT",
    "environment-field-aquarium",
    base("a zátonyon", "az akváriumban"),
    ["ENVIRONMENT_TRANSFER_UNMARKED"],
    base("a zátonyon", `az akváriumban${TRANSFER}`),
    "reef data stated for an aquarium",
  ),
  ...pair(
    "ENVIRONMENT",
    "environment-field-home",
    base("a zátonyon", "az otthoni akváriumban"),
    ["ENVIRONMENT_TRANSFER_UNMARKED"],
    base("a zátonyon", `az otthoni akváriumban${TRANSFER}`),
    "reef data stated for a home aquarium",
  ),
  ...pair(
    "ENVIRONMENT",
    "environment-field-public",
    base("a zátonyon", "a közakváriumban"),
    ["ENVIRONMENT_TRANSFER_UNMARKED"],
    base("a zátonyon", `a közakváriumban${TRANSFER}`),
    "reef data stated for a public aquarium",
  ),
  ...pair(
    "ENVIRONMENT",
    "environment-lab-aquarium",
    base("a laborban", "a tengeri akváriumban", LAB_BASE),
    ["ENVIRONMENT_TRANSFER_UNMARKED"],
    LAB_BASE,
    "lab data stated for a marine aquarium",
    ["c4lab"],
  ),
  ...pair(
    "ENVIRONMENT",
    "environment-not-applicable",
    base("a zátonyon", `az akváriumban${TRANSFER}`).replace(
      "c1sci",
      "c5notapp",
    ),
    ["ENVIRONMENT_TRANSFER_NOT_APPLICABLE"],
    BASE.replace("c1sci", "c5notapp"),
    "a marked transfer the editor ruled out",
    ["c5notapp"],
  ),

  // QUANTITY: outside the range in every unit, and the basis read wrong
  ...pair(
    "QUANTITY",
    "quantity-above",
    base("0,05 mg/l", "0,2 mg/l"),
    ["QUANTITY_OUT_OF_RANGE"],
    BASE,
    "0.2 mg/l PO4 above 0.0285-0.095",
  ),
  ...pair(
    "QUANTITY",
    "quantity-below",
    base("0,05 mg/l", "0,01 mg/l"),
    ["QUANTITY_OUT_OF_RANGE"],
    base("0,05 mg/l", "0,03 mg/l"),
    "0.01 mg/l PO4 below the range",
  ),
  ...pair(
    "QUANTITY",
    "quantity-basis-p",
    base("0,05 mg/l foszfát", "0,05 mg/l foszfor"),
    ["QUANTITY_OUT_OF_RANGE"],
    base("0,05 mg/l foszfát", "0,015 mg/l foszfor"),
    "0.05 mg/l P is 0.153 mg/l PO4; 0.015 mg/l P is 0.046",
  ),
  ...pair(
    "QUANTITY",
    "quantity-micromolar",
    base("0,05 mg/l foszfát", "2 µmol/l foszfát"),
    ["QUANTITY_OUT_OF_RANGE"],
    base("0,05 mg/l foszfát", "0,5 µmol/l foszfát"),
    "2 µmol/l is 0.19 mg/l PO4; 0.5 µmol/l is 0.047",
  ),
  ...pair(
    "QUANTITY",
    "quantity-range-partly-out",
    base("0,05 mg/l", "0,05–0,2 mg/l"),
    ["QUANTITY_OUT_OF_RANGE"],
    base("0,05 mg/l", "0,03–0,09 mg/l"),
    "a range reaching past the evidence",
  ),
  ...pair(
    "QUANTITY",
    "quantity-ppm",
    base("0,05 mg/l", "0,5 ppm"),
    ["QUANTITY_OUT_OF_RANGE"],
    base("0,05 mg/l", "0,05 ppm"),
    "0.5 ppm PO4 above the range",
  ),

  // STRENGTH: wording stronger than one experiment
  ...pair(
    "STRENGTH",
    "strength-shown",
    base("egy kontrollált kísérletben", "kimutatták, hogy"),
    ["STRENGTH_TOO_STRONG"],
    BASE,
    '"kimutatták" on a single experiment',
  ),
  ...pair(
    "STRENGTH",
    "strength-proven",
    base("egy kontrollált kísérletben", "igazolták, hogy"),
    ["STRENGTH_TOO_STRONG"],
    base("egy kontrollált kísérletben", "egy kísérletben"),
    '"igazolták" on a single experiment',
  ),
  ...pair(
    "STRENGTH",
    "strength-consistent",
    base("egy kontrollált kísérletben", "több kísérlet egybehangzóan"),
    ["STRENGTH_TOO_STRONG"],
    base("egy kontrollált kísérletben", "egy kísérlet szerint"),
    '"több kísérlet egybehangzóan" on a single experiment',
  ),
  ...pair(
    "STRENGTH",
    "strength-plain",
    base("Kutatás szerint egy kontrollált kísérletben", "Kutatás szerint"),
    ["STRENGTH_TOO_STRONG"],
    base("egy kontrollált kísérletben", "megfigyelés szerint"),
    "a plain declarative states the result as settled; a weaker phrase is allowed",
  ),
  ...pair(
    "STRENGTH",
    "strength-proves",
    base(
      "egy kontrollált kísérletben a zátonyon 0,05 mg/l foszfát csökkentette",
      "a zátonyon végzett mérés bizonyítja, hogy 0,05 mg/l foszfát csökkentette",
    ),
    ["STRENGTH_TOO_STRONG"],
    base("egy kontrollált kísérletben", "egy beszámoló szerint"),
    '"bizonyítja" on a single experiment',
  ),
];

const T5_CASES: readonly GateCase[] = [
  gateCase(
    "T5",
    null,
    "must-apply",
    "layer-missing",
    base("Kutatás szerint egy", "Egy"),
    DROP("LAYER_PHRASE_MISSING"),
    "a scientific claim cited without its layer phrase",
  ),
  gateCase(
    "T5",
    null,
    "must-apply",
    "layer-other-added",
    base("Kutatás szerint", "Kutatás szerint és a gyártó szerint"),
    DROP("LAYER_PHRASE_OF_OTHER_LAYER"),
    "another layer's phrase beside the right one",
  ),
  gateCase(
    "T5",
    null,
    "must-apply",
    "layer-swapped",
    base("Akvarisztikai tapasztalat szerint", "Kutatás szerint", HOBBY),
    DROP("LAYER_PHRASE_MISSING", "LAYER_PHRASE_OF_OTHER_LAYER"),
    "a hobby claim presented as research",
  ),
  gateCase(
    "T5",
    null,
    "must-apply",
    "layer-conclusion",
    base("Kutatás szerint", "Következtetésünk szerint"),
    DROP("LAYER_PHRASE_MISSING", "LAYER_PHRASE_OF_OTHER_LAYER"),
    "a scientific claim presented as our own conclusion",
  ),
  gateCase(
    "T5",
    null,
    "must-not-apply",
    "layer-scientific",
    BASE,
    CITED,
    "the scientific phrase on a scientific claim",
  ),
  gateCase(
    "T5",
    null,
    "must-not-apply",
    "layer-scientific-plural",
    base("Kutatás szerint", "Kutatások szerint"),
    CITED,
    "the plural form of the same phrase",
  ),
  gateCase(
    "T5",
    null,
    "must-not-apply",
    "layer-hobby",
    HOBBY,
    CITED,
    "the hobby phrase on a hobby claim",
  ),
];

const T10_CASES: readonly GateCase[] = [
  gateCase(
    "T10",
    null,
    "must-apply",
    "dose-in-cited-sentence",
    base(
      " [[claim:c1sci]].",
      ", ezért napi 5 ml adalék kell 100 literenként [[claim:c1sci]].",
    ),
    DROP("QUANTITY_UNRECOGNISED"),
    "a dose added to a cited scientific sentence",
  ),
  gateCase(
    "T10",
    null,
    "must-apply",
    "dose-unmarked",
    "Napi 5 ml foszfátmegkötő kell 100 literenként.",
    DROP("UNMARKED"),
    "a dose sentence without a marker",
  ),
  gateCase(
    "T10",
    null,
    "must-apply",
    "dose-drops",
    base(
      " [[claim:c1sci]].",
      ", ezért adagolj naponta 2 cseppet [[claim:c1sci]].",
    ),
    DROP("QUANTITY_UNRECOGNISED"),
    "drops per day in a cited scientific sentence",
  ),
  gateCase(
    "T10",
    null,
    "must-not-apply",
    "concentration-not-dose",
    BASE,
    CITED,
    "a concentration the evidence covers is not a dose",
  ),
];

const T11_CASES: readonly GateCase[] = [
  gateCase(
    "T11",
    null,
    "must-apply",
    "gate-a-number-unmarked",
    base(" [[claim:c1sci]]", ""),
    DROP("UNMARKED"),
    "(a) a number without a marker",
  ),
  gateCase(
    "T11",
    null,
    "must-apply",
    "gate-b-technical-unmarked",
    "A foszfáthiány fokozza a fehéredés-érzékenységet.",
    DROP("UNMARKED"),
    "(b) a technical sentence without a number and without a marker",
  ),
  gateCase(
    "T11",
    null,
    "must-apply",
    "gate-c-wrong-value",
    base("0,05 mg/l", "0,5 mg/l"),
    DROP("QUANTITY_OUT_OF_RANGE"),
    "(c) a marker with the wrong value",
  ),
  gateCase(
    "T11",
    null,
    "must-apply",
    "gate-d-outside-package",
    BASE.replace("c1sci", "c4lab").replace("a zátonyon", "a laborban"),
    DROP("MARKER_OUTSIDE_PACKAGE"),
    "(d) an existing claim outside the package, its value matching",
  ),
  gateCase(
    "T11",
    null,
    "must-not-apply",
    "gate-d-handed-over",
    BASE.replace("c1sci", "c4lab").replace("a zátonyon", "a laborban"),
    CITED,
    "(d) the same sentence with the claim handed over: the package is the only difference",
    ["c1sci", "c4lab"],
  ),
  gateCase(
    "T11",
    null,
    "must-not-apply",
    "gate-e-correct",
    BASE,
    CITED,
    "(e) a correct marker",
  ),
  ...ANSWER_FIXED_SENTENCES.map((s, i) =>
    gateCase(
      "T11",
      null,
      "must-not-apply",
      `gate-e-fixed-${i + 1}`,
      s,
      { status: "FIXED" },
      "(e) a fixed non-technical sentence",
    ),
  ),
];

const p = (
  value: number,
  unit: PhosphateConcentration["unit"],
  basis: PhosphateConcentration["basis"],
): PhosphateConcentration => ({ value, unit, basis });

function unitCase(
  polarity: Polarity,
  id: string,
  input: PhosphateConcentration,
  expectMgL: number,
  criterion: string,
): UnitCase {
  return {
    kind: "UNIT",
    id,
    group: "T4",
    errorClass: null,
    polarity,
    input,
    expectMgL,
    criterion,
  };
}

// The expected values by hand: PO4 94.970 g/mol, P 30.974 g/mol
// (phosphate-units.ts header). 1 µmol/l = 0.09497 mg/l PO4;
// 1 mg/l P = 3.0661 mg/l PO4.
const T4_CASES: readonly UnitCase[] = [
  unitCase(
    "must-apply",
    "unit-mg-po4",
    p(0.05, "mg/l", "PO4"),
    0.05,
    "mg/l PO4 is the comparison form",
  ),
  unitCase(
    "must-apply",
    "unit-micromolar",
    p(1, "µmol/l", "PO4"),
    0.09497,
    "1 µmol/l = 0.09497 mg/l PO4",
  ),
  unitCase(
    "must-apply",
    "unit-micromolar-basis-free",
    p(1, "µmol/l", "P"),
    0.09497,
    "a molar unit has no basis: µmol/l P is the same amount",
  ),
  unitCase(
    "must-apply",
    "unit-mg-p",
    p(0.1, "mg/l", "P"),
    0.30661,
    "1 mg/l P = 3.0661 mg/l PO4",
  ),
  unitCase(
    "must-apply",
    "unit-ppm-po4",
    p(0.03, "ppm", "PO4"),
    0.03,
    "ppm is read as mg/l",
  ),
  unitCase(
    "must-apply",
    "unit-ppb-po4",
    p(50, "ppb", "PO4"),
    0.05,
    "ppb is read as µg/l",
  ),
  unitCase(
    "must-apply",
    "unit-ppb-p",
    p(10, "ppb", "P"),
    0.030661,
    "10 ppb P = 0.0307 mg/l PO4",
  ),
  unitCase(
    "must-apply",
    "unit-ug-p",
    p(15, "µg/l", "P"),
    0.045992,
    "15 µg/l P = 0.0460 mg/l PO4",
  ),
  // the wrong basis, on purpose: the reading must miss the right value
  unitCase(
    "must-not-apply",
    "unit-p-read-as-po4",
    p(0.1, "mg/l", "PO4"),
    0.30661,
    "0.1 mg/l P entered as PO4 must not give the P reading",
  ),
  unitCase(
    "must-not-apply",
    "unit-po4-read-as-p",
    p(0.05, "mg/l", "P"),
    0.05,
    "0.05 mg/l PO4 entered as P must not give the PO4 reading",
  ),
  unitCase(
    "must-not-apply",
    "unit-ppb-p-read-as-po4",
    p(10, "ppb", "PO4"),
    0.030661,
    "10 ppb P entered as PO4 must not give the P reading",
  ),
  unitCase(
    "must-not-apply",
    "unit-ppm-po4-read-as-p",
    p(0.03, "ppm", "P"),
    0.03,
    "0.03 ppm PO4 entered as P must not give the PO4 reading",
  ),
];

export const TEST_SET: readonly TestCase[] = [
  ...T4_CASES,
  ...T5_CASES,
  ...T10_CASES,
  ...T11_CASES,
  ...T13_CASES,
];

/** The plan's threshold per group, as the report prints it. */
export const THRESHOLDS: Readonly<Record<TestGroup, string>> = {
  T4: "100%, and the wrong basis misses",
  T5: "100% on must-apply, 0 wrong phrase on must-not",
  T10: "0 dose sentence in a research answer",
  T11: "(a)-(d) dropped, (e) passes",
  T13: "100% planted dropped, 0 correct pair dropped",
};

// ---------------------------------------------------------------------------
// THE RUN

export interface TestSetDeps {
  gate: typeof gateAnswer;
  toMgPerLitrePo4: (q: PhosphateConcentration) => number;
  vocabulary: Vocabulary;
}

export interface CaseResult {
  id: string;
  polarity: Polarity;
  passed: boolean;
  /** What happened, for a failed case: the status and the reasons, or the value. */
  got: string;
}

export interface GroupResult {
  /** A group of this set, or of another set built on the same report (the API's). */
  group: string;
  errorClass: string | null;
  threshold: string;
  mustApply: { total: number; passed: number };
  mustNotApply: { total: number; passed: number };
  failed: CaseResult[];
  /** Every case passed, and each polarity has its minimum number of cases. */
  met: boolean;
}

/**
 * One group's line of the report. A group without a case on either side
 * measures nothing, so it is not met; nor is one below `minPerPolarity`.
 */
export function summariseGroup(
  group: string,
  errorClass: string | null,
  threshold: string,
  results: readonly CaseResult[],
  minPerPolarity = 1,
): GroupResult {
  const count = (polarity: Polarity) => {
    const of = results.filter((r) => r.polarity === polarity);
    return { total: of.length, passed: of.filter((r) => r.passed).length };
  };
  const mustApply = count("must-apply");
  const mustNotApply = count("must-not-apply");
  const failed = results.filter((r) => !r.passed);
  const min = Math.max(1, minPerPolarity);
  return {
    group,
    errorClass,
    threshold,
    mustApply,
    mustNotApply,
    failed,
    met:
      failed.length === 0 &&
      mustApply.total >= min &&
      mustNotApply.total >= min,
  };
}

export interface TestSetReport {
  version: string;
  gateVersion: string;
  vocabularyVersion: number;
  groups: GroupResult[];
  met: boolean;
}

function runCase(c: TestCase, deps: TestSetDeps): CaseResult {
  const result = (passed: boolean, got: string): CaseResult => ({
    id: c.id,
    polarity: c.polarity,
    passed,
    got,
  });
  if (c.kind === "UNIT") {
    let value: number;
    try {
      value = deps.toMgPerLitrePo4(c.input);
    } catch (e) {
      return result(false, `threw: ${(e as Error).message}`);
    }
    const equal =
      Math.abs(value - c.expectMgL) <=
      UNIT_RELATIVE_TOLERANCE * Math.abs(c.expectMgL);
    return result(
      c.polarity === "must-apply" ? equal : !equal,
      `${value} mg/l PO4, expected ${c.polarity === "must-apply" ? "" : "not "}${c.expectMgL}`,
    );
  }
  const ids = new Set(c.package ?? DEFAULT_PACKAGE);
  const r = deps.gate({
    text: c.text,
    package: FIXTURE_CLAIMS.filter((claim) => ids.has(claim.id)),
    vocabulary: deps.vocabulary,
  });
  if (r.sentences.length !== 1)
    return result(false, `${r.sentences.length} sentences, a case is one`);
  const s = r.sentences[0]!;
  const codes = s.reasons.map((x) => x.code);
  const got = `${s.status}${codes.length ? ` [${codes.join(", ")}]` : ""}`;
  if (c.expect.status === "DROPPED")
    return result(
      s.status === "DROPPED" && c.expect.codes.some((x) => codes.includes(x)),
      got,
    );
  return result(s.status === c.expect.status, got);
}

const DEFAULT_DEPS = (vocabulary: Vocabulary): TestSetDeps => ({
  gate: gateAnswer,
  toMgPerLitrePo4,
  vocabulary,
});

/**
 * Runs the set. `deps` replaces the functions under test: the real ones by
 * default, a deliberately broken one for a calibration.
 */
export function runTestSet(
  vocabulary: Vocabulary,
  deps: Partial<Omit<TestSetDeps, "vocabulary">> = {},
  cases: readonly TestCase[] = TEST_SET,
): TestSetReport {
  const d = { ...DEFAULT_DEPS(vocabulary), ...deps };
  const keys: { group: TestGroup; errorClass: T13Class | null }[] = [];
  for (const c of cases)
    if (!keys.some((k) => k.group === c.group && k.errorClass === c.errorClass))
      keys.push({ group: c.group, errorClass: c.errorClass });
  const groups = keys.map(({ group, errorClass }) =>
    summariseGroup(
      group,
      errorClass,
      THRESHOLDS[group],
      cases
        .filter((c) => c.group === group && c.errorClass === errorClass)
        .map((c) => runCase(c, d)),
      group === "T13" ? T13_MIN_CASES : 1,
    ),
  );
  return {
    version: TEST_SET_VERSION,
    gateVersion: ANSWER_GATE_VERSION,
    vocabularyVersion: vocabulary.version,
    groups,
    met: groups.length > 0 && groups.every((g) => g.met),
  };
}

/** The report as text, one line per group (or T13 class), failures listed under it. */
export function formatTestSetReport(report: TestSetReport): string {
  const lines = [
    `${report.version}, ${report.gateVersion}, vocabulary v${report.vocabularyVersion}: ${report.met ? "MET" : "NOT MET"}`,
  ];
  for (const g of report.groups) {
    const name = g.errorClass ? `${g.group} ${g.errorClass}` : g.group;
    lines.push(
      `${name}: must-apply ${g.mustApply.passed}/${g.mustApply.total}, must-not-apply ${g.mustNotApply.passed}/${g.mustNotApply.total} -> ${g.met ? "met" : "NOT met"} (${g.threshold})`,
    );
    for (const f of g.failed) lines.push(`  ${f.id} (${f.polarity}): ${f.got}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// THE FIFTH T13 CLASS: A RELATED BUT OTHER EFFECT (plan 10 T13, 7a 3.-4.)
//
// No rule decides whether a sentence speaks of the same effect as its claim
// (calcification and skeletal porosity are related, not the same). A second
// model may only FLAG such a sentence: a flag sends it to the editor, silence
// accepts nothing. So these cases are not in TEST_SET and runTestSet does not
// touch them; the fleet-side runner hands `flagInputs` to the model and scores
// its answer with `scoreFlags`.
//
// What the gate already catches is not in this class: another effect word
// (vázsűrűség, növekedés) is EFFECT_MISMATCH, a related effect outside the
// vocabulary alone (vázvastagság, fluoreszcencia) is EFFECT_NOT_STATED. What
// is left, and planted here, is a sentence that ALSO names the claim's effect
// word, but states another effect beside it or through it. Every case passes
// the gate (`gateFlagCases`): one that is ever dropped has been taken over by
// a rule, and belongs to a machine class.

export const T13_FLAG_CLASS = "RELATED_EFFECT" as const;

export const T13_FLAG_THRESHOLD =
  "the flag rate counted out; any planted case not flagged sends the class to manual review";

/**
 * One sentence for the second model. must-apply: planted, it must be
 * flagged; must-not-apply: its correct pair (the same effect in other
 * words), it must not be.
 */
export interface FlagCase {
  kind: "FLAG";
  id: string;
  group: "T13";
  errorClass: typeof T13_FLAG_CLASS;
  polarity: Polarity;
  /** Verbatim, with its `[[claim:<id>]]` marker. */
  text: string;
  /** The ids of FIXTURE_CLAIMS handed over; the default package when absent. */
  package?: readonly string[];
  criterion: string;
}

function flagPair(
  id: string,
  planted: string,
  correct: string,
  criterion: string,
  pack?: readonly string[],
): FlagCase[] {
  const flagCase = (polarity: Polarity, suffix: string, text: string) => ({
    kind: "FLAG" as const,
    id: `${id}-${suffix}`,
    group: "T13" as const,
    errorClass: T13_FLAG_CLASS,
    polarity,
    text,
    criterion:
      polarity === "must-apply"
        ? `flagged: ${criterion}`
        : `its correct pair is not flagged: ${criterion}`,
    ...(pack ? { package: pack } : {}),
  });
  return [
    flagCase("must-apply", "planted", planted),
    flagCase("must-not-apply", "correct", correct),
  ];
}

const CALC = "kalcifikációját";
const COLOR = "színezetét";

export const T13_RELATED_EFFECT_CASES: readonly FlagCase[] = [
  ...flagPair(
    "related-linear-extension",
    base(CALC, "kalcifikációját és lineáris kiterjedését"),
    base(CALC, "meszesedését"),
    "linear extension stated beside calcification",
  ),
  ...flagPair(
    "related-porosity",
    base(CALC, "kalcifikációját és vázporozitását"),
    base(CALC, "mészvázépítését"),
    "skeletal porosity stated beside calcification",
  ),
  ...flagPair(
    "related-thickness",
    base(CALC, "kalcifikáció után mért vázvastagságát"),
    base(CALC, "meszesedésének ütemét"),
    "skeletal thickness stated through calcification",
  ),
  ...flagPair(
    "related-polyp-extension",
    base(CALC, "kalcifikációt kísérő polipnyitottságát"),
    base(CALC, "kalcifikációs rátáját"),
    "polyp extension stated through calcification",
  ),
  ...flagPair(
    "related-energy-reserve",
    base(CALC, "kalcifikációhoz szükséges energiatartalékát"),
    BASE,
    "the energy reserve stated through calcification",
  ),
  ...flagPair(
    "related-fluorescence",
    base(COLOR, "színezetét és fluoreszcenciáját", HOBBY),
    base(COLOR, "színintenzitását", HOBBY),
    "fluorescence stated beside coloration",
  ),
  ...flagPair(
    "related-pigment",
    base(COLOR, "színezetéért felelős pigmentjeinek mennyiségét", HOBBY),
    base(COLOR, "színezetének erősségét", HOBBY),
    "the pigment content stated through coloration",
  ),
];

/** What the gate says of each flag case: every one must be CITED. */
export function gateFlagCases(
  vocabulary: Vocabulary,
  gate: typeof gateAnswer = gateAnswer,
  cases: readonly FlagCase[] = T13_RELATED_EFFECT_CASES,
): { id: string; got: string; passes: boolean }[] {
  return cases.map((c) => {
    const ids = new Set(c.package ?? DEFAULT_PACKAGE);
    const r = gate({
      text: c.text,
      package: FIXTURE_CLAIMS.filter((claim) => ids.has(claim.id)),
      vocabulary,
    });
    const statuses = r.sentences.map(
      (s) =>
        `${s.status}${s.reasons.length ? ` [${s.reasons.map((x) => x.code).join(", ")}]` : ""}`,
    );
    return {
      id: c.id,
      got: statuses.join(" | "),
      passes: r.sentences.length === 1 && r.sentences[0]!.status === "CITED",
    };
  });
}

/**
 * One item for the second model. It sees neither the case id nor the
 * polarity: `ref` is the position in the set sorted by sentence, so a planted
 * case and its pair do not stand side by side. The sentence carries no
 * marker; the claim is given by its fields.
 */
export interface FlagInput {
  ref: string;
  sentence: string;
  claim: {
    effect: string;
    /** The vocabulary's first form of the effect, as the sentence would name it. */
    effectLabel: string;
    direction: string;
    taxa: readonly string[];
  };
}

const MARKER_IN_TEXT = /\s*\[\[claim:([A-Za-z0-9_-]{1,64})\]\]/gu;

/** The second model's input, and the key that maps each ref back to its case. */
export function flagInputs(
  vocabulary: Vocabulary,
  cases: readonly FlagCase[] = T13_RELATED_EFFECT_CASES,
): { inputs: FlagInput[]; key: Readonly<Record<string, string>> } {
  const items = cases.map((c) => {
    const claimIds = [...c.text.matchAll(MARKER_IN_TEXT)].map((m) => m[1]!);
    if (claimIds.length !== 1)
      throw new Error(
        `test set: ${c.id} cites ${claimIds.length} claims, a flag case cites one`,
      );
    const claim = FIXTURE_CLAIMS.find((x) => x.id === claimIds[0]);
    if (!claim) throw new Error(`test set: ${c.id} cites an unknown claim`);
    const { direction } = claim.scope;
    const effect = vocabulary.effects.find((t) => t.key === claim.scope.effect);
    if (!effect || !direction)
      throw new Error(
        `test set: ${c.id} needs a claim with an effect in the vocabulary and a direction`,
      );
    return {
      id: c.id,
      sentence: c.text.replace(MARKER_IN_TEXT, ""),
      claim: {
        effect: effect.key,
        effectLabel: effect.forms[0]!.join(" "),
        direction,
        taxa: claim.scope.taxa,
      },
    };
  });
  items.sort((a, b) =>
    a.sentence < b.sentence ? -1 : a.sentence > b.sentence ? 1 : 0,
  );
  const key: Record<string, string> = {};
  const inputs = items.map(({ id, ...item }, i) => {
    const ref = `f${String(i + 1).padStart(2, "0")}`;
    key[ref] = id;
    return { ref, ...item };
  });
  return { inputs, key };
}

/** The second model's answer on one item. */
export interface FlagVerdict {
  ref: string;
  flagged: boolean;
}

export interface FlagScore {
  errorClass: typeof T13_FLAG_CLASS;
  threshold: string;
  plantedFlagged: number;
  plantedTotal: number;
  correctFlagged: number;
  correctTotal: number;
  /** Planted cases not flagged, by case id. A missing verdict is silence: not flagged. */
  plantedMissed: string[];
  /** Correct pairs flagged, by case id: work for the editor, not an error. */
  correctFlaggedIds: string[];
  /** Refs the model gave no verdict on. */
  unanswered: string[];
  /** Plan 10 T13: any planted case not flagged sends every item of the class to the editor. */
  manualReview: boolean;
}

/**
 * Scores the flags. Silence accepts nothing (plan 7a, 3.): an item without a
 * verdict counts as not flagged. A verdict on a ref outside the key, or two
 * verdicts on one ref, means the answer is of another set, and throws.
 */
export function scoreFlags(
  key: Readonly<Record<string, string>>,
  verdicts: readonly FlagVerdict[],
  cases: readonly FlagCase[] = T13_RELATED_EFFECT_CASES,
): FlagScore {
  const flagged = new Map<string, boolean>();
  for (const v of verdicts) {
    if (!(v.ref in key)) throw new Error(`flag score: unknown ref ${v.ref}`);
    if (flagged.has(v.ref))
      throw new Error(`flag score: two verdicts on ${v.ref}`);
    flagged.set(v.ref, v.flagged);
  }
  const byId = new Map(cases.map((c) => [c.id, c]));
  const planted: string[] = [];
  const correct: string[] = [];
  const plantedMissed: string[] = [];
  const correctFlaggedIds: string[] = [];
  const unanswered: string[] = [];
  for (const [ref, id] of Object.entries(key)) {
    const c = byId.get(id);
    if (!c) throw new Error(`flag score: the key names ${id}, not in the set`);
    const f = flagged.get(ref);
    if (f === undefined) unanswered.push(ref);
    if (c.polarity === "must-apply") {
      planted.push(id);
      if (f !== true) plantedMissed.push(id);
    } else {
      correct.push(id);
      if (f === true) correctFlaggedIds.push(id);
    }
  }
  return {
    errorClass: T13_FLAG_CLASS,
    threshold: T13_FLAG_THRESHOLD,
    plantedFlagged: planted.length - plantedMissed.length,
    plantedTotal: planted.length,
    correctFlagged: correctFlaggedIds.length,
    correctTotal: correct.length,
    plantedMissed,
    correctFlaggedIds,
    unanswered,
    manualReview: planted.length === 0 || plantedMissed.length > 0,
  };
}

/** The flag score as one report line, failures listed under it. */
export function formatFlagScore(s: FlagScore): string {
  const lines = [
    `T13 ${s.errorClass}: planted flagged ${s.plantedFlagged}/${s.plantedTotal}, correct pair flagged ${s.correctFlagged}/${s.correctTotal} -> ${s.manualReview ? "MANUAL REVIEW" : "every planted case flagged"} (${s.threshold})`,
  ];
  for (const id of s.plantedMissed) lines.push(`  ${id}: not flagged`);
  for (const id of s.correctFlaggedIds) lines.push(`  ${id}: flagged`);
  if (s.unanswered.length)
    lines.push(`  no verdict: ${s.unanswered.join(", ")}`);
  return lines.join("\n");
}
