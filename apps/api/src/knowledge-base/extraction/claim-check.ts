import { toMgPerLitrePo4 } from "@acropora/aquarium-calc";
import {
  ENVIRONMENTS,
  MASS_UNITS,
  PHOSPHATE_UNITS,
  basisWritten,
  numbersAtUnit,
  numbersOf,
  oneSidedBound,
  phosphateNamed,
  squash,
  taxonInText,
  unitWritten,
  type AnchorUnit,
  type Environment,
  type Vocabulary,
} from "@acropora/knowledge-base";

import type { TextSection } from "./jats-text.js";

/**
 * THE OS'S OWN CHECK OF THE AI'S CANDIDATE CLAIMS (plan v4, 9.2 S3; 7a.1).
 *
 * The AI service already refused what it could; this side does not trust
 * that, and reads every claim again against the text IT downloaded:
 * - the passage is in one section of the text, and that section, found here,
 *   is the passage's locator (the model's locator is not used);
 * - every field's anchor is in the text; its own section is its locator;
 * - species, environment and effect are keys of the APPROVED vocabulary, and
 *   a species shows in its anchor by its Latin name: otherwise the value is
 *   an editor's QUESTION, never a field;
 * - a quantity's numbers stand directly before their unit, a mass unit names
 *   its basis, the anchor names phosphate and no nitrogen compound (else
 *   QUANTITY_NOT_PHOSPHATE), a "<" or ">" before its one number makes it a
 *   one-sided bound, and the value is normalised to mg/l PO4 by code;
 * - a sample size is a number of its anchor; an uncertainty or conditions
 *   value is inside its anchor; the closed values are of their lists.
 * Anything that fails is a refusal with its code, counted, never stored.
 */
export const FIELD_NAMES = [
  "species",
  "environment",
  "effect",
  "direction",
  "quantity",
  "studyType",
  "sampleSize",
  "measurementMethod",
  "uncertainty",
  "conditions",
] as const;
export type FieldName = (typeof FIELD_NAMES)[number];

/** A field about the study, not the finding: it anchors to the source. */
export const SOURCE_FIELDS: readonly FieldName[] = [
  "studyType",
  "measurementMethod",
];

const DIRECTIONS = ["INCREASE", "DECREASE", "NONE"] as const;
const STUDY_TYPES = [
  "CONTROLLED_LAB",
  "MESOCOSM",
  "FIELD_EXPERIMENT",
  "FIELD_OBSERVATIONAL",
  "AQUARIUM_CASE",
  "AQUARIUM_SURVEY",
  "REVIEW",
  "META_ANALYSIS",
  "MANUFACTURER",
  "OWN_MEASUREMENT",
  "MODELLING",
] as const;
const MEASUREMENT_METHODS = [
  "COLORIMETRIC_KIT",
  "PHOTOMETER",
  "LAB_SPECTROPHOTOMETRY",
  "AUTOANALYZER",
  "ICP_OES",
  "ICP_MS",
  "ION_CHROMATOGRAPHY",
  "OTHER",
  "NOT_REPORTED",
] as const;

/** The fields whose value is a closed key: their anchor must say more than one word. */
const MIN_TWO_WORDS: readonly FieldName[] = [
  "environment",
  "effect",
  "direction",
  "studyType",
  "measurementMethod",
];

export const MAX_ANCHOR = 400;
export const MAX_PASSAGE = 1_000;
export const MAX_FREE_VALUE = 300;

export interface CheckedAnchor {
  field: FieldName;
  text: string;
  locator: string;
  /** The field's value as stored (a vocabulary key, a number range...); null for a question. */
  normalizedValue: string | null;
  /** A question: the model's word for a value the vocabulary does not hold. */
  proposed?: string;
}

export interface CheckedQuantity {
  min: number | null;
  max: number | null;
  unit: AnchorUnit;
  basis: "PO4" | "P" | null;
  normalizedMinMgL: number | null;
  normalizedMaxMgL: number | null;
}

export interface CheckedClaim {
  passage: { text: string; locator: string };
  species: string | null;
  environment: Environment | null;
  effect: string | null;
  direction: (typeof DIRECTIONS)[number] | null;
  quantity: CheckedQuantity | null;
  studyType: (typeof STUDY_TYPES)[number] | null;
  measurementMethod: (typeof MEASUREMENT_METHODS)[number] | null;
  sampleSize: { value: number; unit: string | null } | null;
  uncertainty: string | null;
  conditions: string | null;
  anchors: CheckedAnchor[];
  refused: { field: string; refusal: string }[];
}

export interface CheckResult {
  claims: CheckedClaim[];
  /** Claims dropped whole, by code. */
  refusedClaims: string[];
}

/**
 * The stored text of a quantity and a sample size (the anchor's
 * `normalizedValue`). The editor's review (S4) compares a kept anchor with the
 * claim's columns through these, so both sides share one format.
 */
export const quantityText = (
  min: number | null,
  max: number | null,
  unit: string,
  basis: "PO4" | "P" | null,
) => `${min ?? ""}-${max ?? ""} ${unit}${basis ? ` ${basis}` : ""}`;
export const sampleSizeText = (n: number, unit: string | null) =>
  unit ? `${n} ${unit}` : `${n}`;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) =>
  typeof v === "string" && v.trim() ? v.trim() : null;
/** A model-written word kept for the editor: short, printable, no markup. */
const proposedOf = (v: string) =>
  v.replace(/[^\p{L}\p{N} _.,()'-]/gu, "").slice(0, 64);
/** Nine decimals, as the column holds them. */
const nine = (n: number) => Math.round(n * 1e9) / 1e9;

export function checkClaims(
  raw: readonly unknown[],
  sections: readonly TextSection[],
  vocabulary: Vocabulary,
): CheckResult {
  if (vocabulary.status !== "APPROVED")
    throw new Error("the claim check needs an APPROVED vocabulary");
  const squashed = sections.map((s) => ({
    locator: s.locator,
    text: squash(s.text),
  }));
  const locate = (text: string) =>
    squashed.find((s) => s.text.includes(text))?.locator ?? null;
  const taxa = new Set(vocabulary.taxa.map((t) => t.key));
  const effects = new Set(vocabulary.effects.map((t) => t.key));
  const environments = new Set<string>(
    vocabulary.environments.map((t) => t.key),
  );

  const result: CheckResult = { claims: [], refusedClaims: [] };
  for (const item of raw) {
    if (!isRecord(item) || !isRecord(item.passage)) {
      result.refusedClaims.push("NO_PASSAGE");
      continue;
    }
    const passageText = str(item.passage.text);
    if (!passageText || passageText.length > MAX_PASSAGE) {
      result.refusedClaims.push("NO_PASSAGE");
      continue;
    }
    const passage = squash(passageText);
    const passageLocator = locate(passage);
    if (!passageLocator) {
      result.refusedClaims.push("PASSAGE_NOT_IN_TEXT");
      continue;
    }
    const claim: CheckedClaim = {
      passage: { text: passage, locator: passageLocator },
      species: null,
      environment: null,
      effect: null,
      direction: null,
      quantity: null,
      studyType: null,
      measurementMethod: null,
      sampleSize: null,
      uncertainty: null,
      conditions: null,
      anchors: [],
      refused: [],
    };
    const refuse = (field: string, refusal: string) =>
      claim.refused.push({ field: proposedOf(field) || "-", refusal });

    // the AI service's questions: kept as questions when their anchor is real
    for (const q of Array.isArray(item.questions) ? item.questions : []) {
      if (!isRecord(q)) continue;
      const field = q.field;
      const anchorText = str(q.anchor);
      const proposed = str(q.proposed);
      if (
        (field !== "species" &&
          field !== "environment" &&
          field !== "effect") ||
        !anchorText ||
        !proposed
      )
        continue;
      const anchor = squash(anchorText);
      const locator = anchor.length <= MAX_ANCHOR ? locate(anchor) : null;
      if (!locator) {
        refuse(field, "ANCHOR_NOT_IN_TEXT");
        continue;
      }
      claim.anchors.push({
        field,
        text: anchor,
        locator,
        normalizedValue: null,
        proposed: proposedOf(proposed),
      });
    }

    for (const f of Array.isArray(item.fields) ? item.fields : []) {
      if (!isRecord(f) || typeof f.field !== "string") continue;
      const field = f.field as FieldName;
      if (!(FIELD_NAMES as readonly string[]).includes(field)) {
        refuse(f.field, "UNKNOWN_FIELD");
        continue;
      }
      const anchorText = str(f.anchor);
      if (!anchorText || anchorText.length > MAX_ANCHOR) {
        refuse(field, "NO_ANCHOR");
        continue;
      }
      const anchor = squash(anchorText);
      const locator = locate(anchor);
      if (!locator) {
        refuse(field, "ANCHOR_NOT_IN_TEXT");
        continue;
      }
      // a one-word anchor ("the", "decreased") is in the text and proves
      // nothing: a closed-value field's anchor is at least two words (barracuda, #1838)
      if (
        MIN_TWO_WORDS.includes(field) &&
        anchor.split(" ").filter(Boolean).length < 2
      ) {
        refuse(field, "ANCHOR_TOO_SHORT");
        continue;
      }
      const accept = (normalizedValue: string) =>
        claim.anchors.push({ field, text: anchor, locator, normalizedValue });
      const question = (proposed: string) =>
        claim.anchors.push({
          field,
          text: anchor,
          locator,
          normalizedValue: null,
          proposed: proposedOf(proposed),
        });
      const value = str(f.value);

      switch (field) {
        case "species":
          if (!value) refuse(field, "NO_VALUE");
          else if (!taxa.has(value)) question(value);
          // a key the vocabulary holds, but its name is not in the anchor
          else if (!taxonInText(vocabulary, value, anchor)) question(value);
          else {
            claim.species = value;
            accept(value);
          }
          break;
        case "environment":
          if (!value) refuse(field, "NO_VALUE");
          else if (
            !environments.has(value) ||
            !(ENVIRONMENTS as readonly string[]).includes(value)
          )
            question(value);
          else {
            claim.environment = value as Environment;
            accept(value);
          }
          break;
        case "effect":
          if (!value) refuse(field, "NO_VALUE");
          else if (!effects.has(value)) question(value);
          else {
            claim.effect = value;
            accept(value);
          }
          break;
        case "direction":
          if (!value || !(DIRECTIONS as readonly string[]).includes(value))
            refuse(field, "UNKNOWN_VALUE");
          else {
            claim.direction = value as CheckedClaim["direction"];
            accept(value);
          }
          break;
        case "studyType":
          if (!value || !(STUDY_TYPES as readonly string[]).includes(value))
            refuse(field, "UNKNOWN_VALUE");
          else {
            claim.studyType = value as CheckedClaim["studyType"];
            accept(value);
          }
          break;
        case "measurementMethod":
          if (
            !value ||
            !(MEASUREMENT_METHODS as readonly string[]).includes(value)
          )
            refuse(field, "UNKNOWN_VALUE");
          else {
            claim.measurementMethod =
              value as CheckedClaim["measurementMethod"];
            accept(value);
          }
          break;
        case "uncertainty":
        case "conditions":
          if (!value || value.length > MAX_FREE_VALUE)
            refuse(field, "NO_VALUE");
          else if (!anchor.includes(squash(value)))
            refuse(field, "VALUE_NOT_IN_ANCHOR");
          else {
            claim[field] = squash(value);
            accept(squash(value));
          }
          break;
        case "sampleSize": {
          const n = f.value;
          if (typeof n !== "number" || !Number.isInteger(n) || n < 1)
            refuse(field, "UNKNOWN_VALUE");
          else if (!numbersOf(anchor).has(n))
            refuse(field, "NUMBER_NOT_IN_ANCHOR");
          else {
            // the model's word, as for a question: printable and short
            const unit = proposedOf(str(f.unit) ?? "").slice(0, 32) || null;
            claim.sampleSize = { value: n, unit };
            accept(sampleSizeText(n, unit));
          }
          break;
        }
        case "quantity": {
          const num = (v: unknown) =>
            v === null || v === undefined
              ? null
              : typeof v === "number" && Number.isFinite(v) && v >= 0
                ? v
                : Number.NaN;
          let min = num(f.min);
          let max = num(f.max);
          const unit = f.unit as AnchorUnit;
          const basis = f.basis === "PO4" || f.basis === "P" ? f.basis : null;
          if (
            Number.isNaN(min) ||
            Number.isNaN(max) ||
            (min === null && max === null)
          )
            refuse(field, "UNKNOWN_VALUE");
          else if (min !== null && max !== null && min > max)
            refuse(field, "RANGE_INVERTED");
          else if (!(PHOSPHATE_UNITS as readonly string[]).includes(unit))
            refuse(field, "UNIT_UNKNOWN");
          else if (!unitWritten(unit, anchor))
            refuse(field, "UNIT_NOT_IN_ANCHOR");
          else if (
            [min, max].some(
              (n) => n !== null && !numbersAtUnit(unit, anchor).has(n),
            )
          )
            refuse(field, "NUMBER_NOT_AT_UNIT");
          else if (MASS_UNITS.includes(unit) && basis === null)
            refuse(field, "BASIS_MISSING");
          else if (
            MASS_UNITS.includes(unit) &&
            basis !== null &&
            !basisWritten(basis, anchor)
          )
            refuse(field, "BASIS_NOT_IN_ANCHOR");
          // a nitrate or ammonium number in a phosphate claim is no quantity of
          // it: stored unconverted, a later gate would still read it as PO4
          // (barracuda 35814 a, acrobot 35816)
          else if (!phosphateNamed(anchor))
            refuse(field, "QUANTITY_NOT_PHOSPHATE");
          else {
            // "< 9 µM" is an upper bound with no lower one: the model gave it
            // as 9-9 (acrobot 35808); one number, read by its own comparator
            const single =
              min === null ? max : max === null || max === min ? min : null;
            const bound =
              single === null ? null : oneSidedBound(unit, anchor, single);
            if (bound === "UPPER") [min, max] = [null, single];
            if (bound === "LOWER") [min, max] = [single, null];
            // the conversion is code, never the model (plan 6, Mértékegység)
            const norm = (n: number | null) =>
              n === null
                ? null
                : nine(
                    toMgPerLitrePo4({ value: n, unit, basis: basis ?? "PO4" }),
                  );
            claim.quantity = {
              min,
              max,
              unit,
              basis,
              normalizedMinMgL: norm(min),
              normalizedMaxMgL: norm(max),
            };
            accept(quantityText(min, max, unit, basis));
          }
          break;
        }
      }
    }
    result.claims.push(claim);
  }
  return result;
}

/**
 * A CLAIM IS THIS SOURCE'S OWN FINDING (acrobot's review of the first eleven
 * stage claims, 35808: nine of eleven were not findings). Applied to an
 * extraction's checked claims, never to an editor's correction (that one is
 * checked on its single anchor, whose section may well be Methods):
 * - a passage in the methods section describes how, not what was found
 *   (METHODS_PASSAGE); its fields (species, sample size) may still anchor there;
 * - a passage that cites another work ("Neil et al. (2025)", "(Tanaka et al.,
 *   2007)", "[12]") reports someone else's result: this source is not its
 *   evidence (CITED_RESULT). Over-caution by design: an own result stated
 *   together with a citation is dropped too, and the editor can add it by hand;
 * - a claim with neither an effect (a field or a question) nor a direction is
 *   a background value, not a finding (NO_FINDING);
 * - a passage with no word of change or effect ("increased", "reduced",
 *   "correlated", "did not change"...) is a background value even when the
 *   model gave it an effect and a direction (NO_CHANGE_WORD; acrobot 35941,
 *   the inflow concentrations of the first re-extraction). It is the editor's
 *   to attach as another claim's condition: no rule can tell which claim;
 * - an effect key whose words are not in its anchor is the model mapping an
 *   unlisted effect to the nearest key (an internal nutrient reserve given as
 *   SYMBIONT_DENSITY, acrobot 35941): it becomes a question, as an unknown
 *   word does. A key this table does not know (one an editor added) is left;
 * - the study's own fields (study type, method) are stored once per source:
 *   a repeated value keeps its first anchor, and two different values for one
 *   field keep neither (SOURCE_FIELD_CONFLICT), since a source has one design.
 */
const METHODS_SECTION =
  /(?<![a-z])(?:methods?|methodology|materials)(?![a-z])/i;
const CITATION = new RegExp(
  [
    // "et al", the commonest form
    "(?<![\\p{L}])et al(?![\\p{L}])",
    // "(Tanaka, 2007)", "(Vega Thurber 2014; ...)", "(Smith and Jones, 2019a)"
    "\\(\\s*\\p{Lu}[\\p{L}'’-]+(?:\\s+(?:\\p{Lu}[\\p{L}'’-]+|and|&))*,?\\s+(?:19|20)\\d{2}[a-z]?\\s*[;,)]",
    // "Wiedenmann (2013)", "Neil et al. (2025)" already caught above
    "\\p{Lu}[\\p{L}'’-]+\\s+\\((?:19|20)\\d{2}[a-z]?\\)",
    // numeric references "[12]", "[3, 4]", "[5–7]"
    "\\[\\s*\\d{1,3}(?:\\s*[,–-]\\s*\\d{1,3})*\\s*\\]",
  ].join("|"),
  "u",
);

/**
 * The words a finding states its change with, in the papers' English. A
 * deliberately broad list: a missed background value is the editor's one
 * click, a dropped finding is lost (the asymmetry of the CITED_RESULT rule
 * runs the other way, because a cited result is never this source's).
 */
const CHANGE_WORD = new RegExp(
  "(?<![\\p{L}])(?:" +
    [
      "increas",
      "decreas",
      "reduc",
      "enhanc",
      "elevat",
      "inhibit",
      "suppress",
      "promot",
      "stimulat",
      "impair",
      "declin",
      "improv",
      "accelerat",
      "slow",
      "rose",
      "rise",
      "rising",
      "fell",
      "fall",
      "drop",
      "lower",
      "higher",
      "greater",
      "affect",
      "impact",
      "effect",
      "influenc",
      "alter",
      "chang",
      "correlat",
      "associat",
      "linked",
      "depend",
      "limit",
      "stabili",
      "unchanged",
      "differ",
      "significant",
      "respon",
      "caus",
      "led to",
      "result(?:s|ed)? in",
      "mitigat",
      "aggravat",
      "exacerbat",
      "worsen",
      "attenuat",
      "boost",
      "loss",
      "lost",
      "gain",
      "doubl",
      "halv",
    ].join("|") +
    ")",
  "iu",
);

export function namesAChange(passage: string): boolean {
  return CHANGE_WORD.test(passage);
}

/** The English words an effect key's anchor names it with. */
export const EFFECT_WORDS: Readonly<Record<string, RegExp>> = {
  CALCIFICATION: /calcif/i,
  SKELETAL_DENSITY: /(?:skelet\w*|bulk)\s+densit/i,
  GROWTH: /grow|(?:linear|skeletal)\s+extension|weight gain/i,
  BLEACHING: /bleach/i,
  BLEACHING_SUSCEPTIBILITY:
    /bleach\w*\s+(?:susceptib|sensitiv|toleran|resist)|thermal\s+(?:toleran|sensitiv)/i,
  COLORATION: /colou?r|pigment/i,
  SYMBIONT_DENSITY:
    /(?:symbiont|zooxanthella\w*|symbiodini\w*|algal)\s+(?:cell\s+)?(?:densit|abundance|number|count)|cell\s+densit/i,
  PHOTOSYNTHESIS: /photosynth|fv\s*\/\s*fm|quantum\s+yield|photochemi/i,
};

/** Whether an effect key's anchor names that effect; true for a key the table does not know. */
export function effectNamed(key: string, anchor: string): boolean {
  const words = EFFECT_WORDS[key];
  return words === undefined || words.test(anchor);
}

export function citesAnotherWork(passage: string): boolean {
  return CITATION.test(passage);
}

export function isMethodsSection(locator: string): boolean {
  return METHODS_SECTION.test(locator);
}

/** An effect key its anchor does not name: a question, worded by its anchor. */
function effectAsQuestion(c: CheckedClaim): CheckedClaim {
  let unnamed = false;
  const anchors = c.anchors.map((a) => {
    if (
      a.field !== "effect" ||
      a.normalizedValue === null ||
      effectNamed(a.normalizedValue, a.text)
    )
      return a;
    unnamed = true;
    // the sentence's own words, never the raw key the model chose
    return { ...a, normalizedValue: null, proposed: proposedOf(a.text) };
  });
  return unnamed ? { ...c, effect: null, anchors } : { ...c, anchors };
}

export function keepOwnFindings(claims: readonly CheckedClaim[]): {
  claims: CheckedClaim[];
  refusedClaims: string[];
  refusedFields: string[];
} {
  const refusedClaims: string[] = [];
  const refusedFields: string[] = [];
  const kept: CheckedClaim[] = [];
  for (const c of claims) {
    if (isMethodsSection(c.passage.locator))
      refusedClaims.push("METHODS_PASSAGE");
    else if (citesAnotherWork(c.passage.text))
      refusedClaims.push("CITED_RESULT");
    else if (
      c.effect === null &&
      c.direction === null &&
      !c.anchors.some((a) => a.field === "effect")
    )
      refusedClaims.push("NO_FINDING");
    else if (!namesAChange(c.passage.text))
      refusedClaims.push("NO_CHANGE_WORD");
    else kept.push(effectAsQuestion(c));
  }

  for (const field of SOURCE_FIELDS) {
    const values = new Set(
      kept.flatMap((c) =>
        c.anchors
          .filter((a) => a.field === field)
          .map((a) => a.normalizedValue),
      ),
    );
    let first = true;
    for (const c of kept) {
      c.anchors = c.anchors.filter((a) => {
        if (a.field !== field) return true;
        if (values.size > 1) return false;
        const keep = first;
        first = false;
        return keep;
      });
      if (values.size > 1 || !c.anchors.some((a) => a.field === field))
        (c as unknown as Record<string, unknown>)[field] = null;
    }
    if (values.size > 1) refusedFields.push("SOURCE_FIELD_CONFLICT");
  }
  return { claims: kept, refusedClaims, refusedFields };
}
