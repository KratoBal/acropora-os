/**
 * T12, THE CONCLUSION REVIEW (plan v4, 10 T12 and 7a 3.; slice S7): a
 * second model reviews our own conclusions independently, against the claims
 * they rest on. A conclusion (`KnowledgeConclusion`) has no structured scope,
 * so no rule can compare it with its claims: its approval is the editor's,
 * and the second model may only FLAG one that says more than, or other than,
 * its basis. Its silence accepts nothing.
 *
 * This file holds the cases, the second model's input and the score, and
 * runs no model (the fleet-side runner calls it, the same way as the fifth
 * T13 class). Every planted conclusion says more than, or other than, its
 * claims in ONE way, and has a correct pair: a conclusion on the same claims
 * that says only what they support. Every case where the model's verdict is
 * not the expected one is a discrepancy, listed by case id, for a human
 * decision: plan 10 T12, "eltérésnél emberi döntés".
 *
 * The claims are the test set's fixture claims, handed over as the sentence
 * the system itself states for them (`claimStatement`), so the model judges
 * against the wording the answer path would use.
 *
 * Pure: no database, no clock.
 */

import { claimStatement, type OriginalQuantity } from "./claim-statement.js";
import { FIXTURE_CLAIMS, type Polarity } from "./test-set.js";
import type { Vocabulary } from "./vocabulary.js";

export const T12_THRESHOLD =
  "every discrepancy (the model's verdict is not the expected one) answered in the task record";

/** How a planted conclusion goes beyond its claims: one way per case. */
export const T12_KINDS = [
  "STRONGER_CERTAINTY",
  "WIDER_TAXON",
  "OTHER_ENVIRONMENT",
  "VALUE_OUTSIDE_RANGE",
  "OPPOSITE_DIRECTION",
  "BROADER_EFFECT",
  "UNSUPPORTED_CAUSE",
  "RECOMMENDATION",
  "LONGER_TERM",
] as const;
export type T12Kind = (typeof T12_KINDS)[number];

/**
 * The kinds the fleet-side check list (acroveliq `T12_CHECK_LIST`) does NOT
 * name as an example. The list names the other eight, so their score says
 * whether the model finds a NAMED kind; these say whether it finds one it was
 * not told about (barracuda, #334 review; acrobot 39505). The score counts
 * them out on their own line.
 */
export const T12_UNLISTED_KINDS: readonly T12Kind[] = ["LONGER_TERM"];

/**
 * One conclusion for the second model. must-apply: planted, it must be
 * flagged; must-not-apply: its correct pair, it must not be.
 */
export interface ConclusionCase {
  kind: "CONCLUSION";
  id: string;
  group: "T12";
  plantedKind: T12Kind;
  polarity: Polarity;
  /** The conclusion's text, as the editor would write it. */
  text: string;
  /** The ids of FIXTURE_CLAIMS the conclusion rests on. */
  claims: readonly string[];
  criterion: string;
}

/**
 * The fixture claims' quantities as a source would write them, in mg/l PO4:
 * the statement then names the range. (A µmol/l range would do too, but the
 * fleet's personal-data filter masks "µmol" as a proper noun; measured
 * 2026-11-01.)
 */
export const FIXTURE_QUANTITIES: Readonly<Record<string, OriginalQuantity>> = {
  c1sci: { min: "0.0285", max: "0.095", unit: "mg/l", basis: "PO4" },
  c2hob: { min: "0.03", max: "0.1", unit: "mg/l", basis: "PO4" },
};

function conclusionPair(
  plantedKind: T12Kind,
  id: string,
  planted: string,
  correct: string,
  criterion: string,
  claims: readonly string[] = ["c1sci"],
): ConclusionCase[] {
  const one = (polarity: Polarity, suffix: string, text: string) => ({
    kind: "CONCLUSION" as const,
    id: `${id}-${suffix}`,
    group: "T12" as const,
    plantedKind,
    polarity,
    text,
    claims,
    criterion:
      polarity === "must-apply"
        ? `flagged: ${criterion}`
        : `its correct pair is not flagged: ${criterion}`,
  });
  return [
    one("must-apply", "planted", planted),
    one("must-not-apply", "correct", correct),
  ];
}

// The genus stands uninflected in every sentence: the fleet's filter keeps a
// preserved name only as the bare word, and masks "Acroporánál" (measured
// 2026-11-01).
const RANGE = "0,0285 és 0,095 mg/l PO4 közötti foszfát mellett";
const C1 = `Egy zátonyon végzett kísérlet szerint ${RANGE} csökkenhet az Acropora kalcifikációja`;

export const T12_CONCLUSION_CASES: readonly ConclusionCase[] = [
  ...conclusionPair(
    "STRONGER_CERTAINTY",
    "t12-certainty",
    `Egy zátonyon végzett kísérlet bizonyítja, hogy ${RANGE} csökken az Acropora kalcifikációja.`,
    `${C1}; ezt egy kísérlet mutatta.`,
    "one experiment stated as proof",
  ),
  ...conclusionPair(
    "WIDER_TAXON",
    "t12-taxon",
    `Egy zátonyon végzett kísérlet szerint ${RANGE} csökkenhet a kőkorallok kalcifikációja.`,
    `${C1}; más kőkorallokra ez az adat nem szól.`,
    "Acropora data stated for every stony coral",
  ),
  ...conclusionPair(
    "OTHER_ENVIRONMENT",
    "t12-environment",
    `Egy kísérlet szerint otthoni akváriumban is ${RANGE} csökkenhet az Acropora kalcifikációja.`,
    `${C1}; akváriumra ez az állítás nem szól.`,
    "a reef experiment stated for the home aquarium without the transfer",
  ),
  ...conclusionPair(
    "VALUE_OUTSIDE_RANGE",
    "t12-range",
    "Egy zátonyon végzett kísérlet szerint 0,2 mg/l PO4 feletti foszfát mellett csökkenhet az Acropora kalcifikációja.",
    `${C1}; e tartományon kívülről az állítás nem szól.`,
    "an effect stated above the measured range",
  ),
  ...conclusionPair(
    "OPPOSITE_DIRECTION",
    "t12-direction",
    `Egy zátonyon végzett kísérlet szerint ${RANGE} nőhet az Acropora kalcifikációja.`,
    `${C1}.`,
    "a decrease stated as an increase",
  ),
  ...conclusionPair(
    "BROADER_EFFECT",
    "t12-effect",
    `Egy zátonyon végzett kísérlet szerint ${RANGE} romlik az Acropora egészsége.`,
    `${C1}; más élettani hatásról az állítás nem szól.`,
    "a calcification result stated as the coral's health",
  ),
  ...conclusionPair(
    "UNSUPPORTED_CAUSE",
    "t12-cause",
    "Egy zátonyon végzett kísérlet és egy akvarisztikai beszámoló szerint az Acropora színezete azért erősödhet a foszfáttól, mert közben lassul a kalcifikációja.",
    "Egy zátonyon végzett kísérlet szerint a foszfát csökkentheti az Acropora kalcifikációját, egy akvarisztikai beszámoló szerint pedig erősítheti a színezetét; a kettő kapcsolatáról egyik sem szól.",
    "a cause linking two claims that neither states",
    ["c1sci", "c2hob"],
  ),
  ...conclusionPair(
    "RECOMMENDATION",
    "t12-recommendation",
    `${C1}, ezért Acropora mellett a foszfátot 0,0285 mg/l PO4 alatt kell tartani.`,
    `${C1}; adagolási vagy célérték-ajánlás ebből nem következik.`,
    "a target value recommended from one experiment",
  ),
  ...conclusionPair(
    "LONGER_TERM",
    "t12-duration",
    `Egy zátonyon végzett kísérlet szerint ${RANGE} hosszú távon, éveken át is csökken az Acropora kalcifikációja.`,
    `${C1}; hogy hosszabb idő alatt is így van-e, arról az állítás nem szól.`,
    "a result stated for years, beyond what the claim covers",
  ),
];

/**
 * One item for the second model. It sees neither the case id nor the
 * polarity nor the planted kind: `ref` is the position in a fixed shuffle of
 * the set (a hash of the case id). The claims are the sentences the system
 * states for them.
 */
export interface ConclusionInput {
  ref: string;
  conclusion: string;
  basis: readonly string[];
}

/**
 * The shuffle's salt. Unsalted, FNV-1a of these ids stood four planted
 * conclusions in a row; 5 is the first salt, counting from 0, under which no
 * three planted or three correct ones stand in a row and no conclusion stands
 * next to its own pair (measured 2026-11-01 on the nine pairs, 57 of the first
 * 2000 salts do; on the first eight it was 18, which fails on nine).
 * A test pins both properties: a change to the cases that breaks them turns
 * it red, and the salt is picked again the same way.
 */
export const T12_SHUFFLE_SALT = 5;

/** FNV-1a of the salted case id: a fixed shuffle, as the T13 flag input. */
function orderKey(id: string): number {
  const salted = `${T12_SHUFFLE_SALT}:${id}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < salted.length; i++) {
    h ^= salted.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** The second model's input, and the key that maps each ref back to its case. */
export function conclusionInputs(
  vocabulary: Vocabulary,
  cases: readonly ConclusionCase[] = T12_CONCLUSION_CASES,
): { inputs: ConclusionInput[]; key: Readonly<Record<string, string>> } {
  const items = cases.map((c) => {
    const basis = c.claims.map((claimId) => {
      const claim = FIXTURE_CLAIMS.find((x) => x.id === claimId);
      if (!claim)
        throw new Error(`test set: ${c.id} rests on an unknown claim`);
      const r = claimStatement({
        claim,
        quantity: FIXTURE_QUANTITIES[claimId] ?? null,
        vocabulary,
      });
      if (!r.ok)
        throw new Error(
          `test set: ${c.id}: no statement for ${claimId} (${r.failure})`,
        );
      return r.statement;
    });
    return { id: c.id, conclusion: c.text, basis };
  });
  items.sort(
    (a, b) => orderKey(a.id) - orderKey(b.id) || (a.id < b.id ? -1 : 1),
  );
  const key: Record<string, string> = {};
  const inputs = items.map(({ id, ...item }, i) => {
    const ref = `k${String(i + 1).padStart(2, "0")}`;
    key[ref] = id;
    return { ref, ...item };
  });
  return { inputs, key };
}

/** The second model's answer on one item. */
export interface ConclusionVerdict {
  ref: string;
  flagged: boolean;
}

/** A case where the model's verdict is not the expected one: for a human decision. */
export interface Discrepancy {
  id: string;
  plantedKind: T12Kind;
  expected: "JELEZ" | "NEM";
  /** "nincs": the model gave no verdict, which is silence, so not flagged. */
  got: "JELEZ" | "NEM" | "nincs";
}

export interface ConclusionScore {
  threshold: string;
  plantedFlagged: number;
  plantedTotal: number;
  correctFlagged: number;
  correctTotal: number;
  /** Every case the verdict of which is not the expected one, in key order. */
  discrepancies: Discrepancy[];
  /** Refs the model gave no verdict on. */
  unanswered: string[];
  /** The kinds the check list does not name, counted out on their own (included in the totals above too). */
  unlisted: {
    kinds: readonly T12Kind[];
    plantedFlagged: number;
    plantedTotal: number;
    correctFlagged: number;
    correctTotal: number;
  };
}

/**
 * Scores the verdicts. Silence accepts nothing (plan 7a, 3.): an item
 * without a verdict counts as not flagged, and a planted one is then a
 * discrepancy. A verdict on a ref outside the key, or two verdicts on one
 * ref, means the answer is of another set, and throws.
 */
export function scoreConclusions(
  key: Readonly<Record<string, string>>,
  verdicts: readonly ConclusionVerdict[],
  cases: readonly ConclusionCase[] = T12_CONCLUSION_CASES,
): ConclusionScore {
  const flagged = new Map<string, boolean>();
  for (const v of verdicts) {
    if (!(v.ref in key))
      throw new Error(`conclusion score: unknown ref ${v.ref}`);
    if (flagged.has(v.ref))
      throw new Error(`conclusion score: two verdicts on ${v.ref}`);
    flagged.set(v.ref, v.flagged);
  }
  const byId = new Map(cases.map((c) => [c.id, c]));
  let plantedTotal = 0;
  let plantedFlagged = 0;
  let correctTotal = 0;
  let correctFlagged = 0;
  const discrepancies: Discrepancy[] = [];
  const unanswered: string[] = [];
  const unlisted = {
    kinds: T12_UNLISTED_KINDS,
    plantedFlagged: 0,
    plantedTotal: 0,
    correctFlagged: 0,
    correctTotal: 0,
  };
  for (const [ref, id] of Object.entries(key)) {
    const c = byId.get(id);
    if (!c)
      throw new Error(`conclusion score: the key names ${id}, not in the set`);
    const f = flagged.get(ref);
    if (f === undefined) unanswered.push(ref);
    const got = f === undefined ? "nincs" : f ? "JELEZ" : "NEM";
    const planted = c.polarity === "must-apply";
    if (planted) {
      plantedTotal++;
      if (f === true) plantedFlagged++;
    } else {
      correctTotal++;
      if (f === true) correctFlagged++;
    }
    if (T12_UNLISTED_KINDS.includes(c.plantedKind)) {
      if (planted) {
        unlisted.plantedTotal++;
        if (f === true) unlisted.plantedFlagged++;
      } else {
        unlisted.correctTotal++;
        if (f === true) unlisted.correctFlagged++;
      }
    }
    if (planted !== (f === true))
      discrepancies.push({
        id,
        plantedKind: c.plantedKind,
        expected: planted ? "JELEZ" : "NEM",
        got,
      });
  }
  return {
    threshold: T12_THRESHOLD,
    plantedFlagged,
    plantedTotal,
    correctFlagged,
    correctTotal,
    discrepancies,
    unanswered,
    unlisted,
  };
}

/** The score as one report line, each discrepancy under it, marked for a human decision. */
export function formatConclusionScore(s: ConclusionScore): string {
  const n = s.discrepancies.length;
  const lines = [
    `T12: planted flagged ${s.plantedFlagged}/${s.plantedTotal}, correct pair flagged ${s.correctFlagged}/${s.correctTotal} -> ${n === 0 ? "no discrepancy" : `${n} discrepanc${n === 1 ? "y" : "ies"}, each for a human decision`} (${s.threshold})`,
    `T12 kinds the check list does not name (${s.unlisted.kinds.join(", ")}): planted flagged ${s.unlisted.plantedFlagged}/${s.unlisted.plantedTotal}, correct pair flagged ${s.unlisted.correctFlagged}/${s.unlisted.correctTotal}`,
  ];
  for (const d of s.discrepancies)
    lines.push(
      `  ${d.id} (${d.plantedKind}): expected ${d.expected}, got ${d.got} -> EMBERI DONTES`,
    );
  if (s.unanswered.length)
    lines.push(`  no verdict: ${s.unanswered.join(", ")}`);
  return lines.join("\n");
}
