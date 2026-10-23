/**
 * Recognises the claim parts of one Hungarian sentence through the controlled
 * vocabulary (plan v4, 7a section 2): taxa, environment, effect, direction
 * verbs, negation, certainty phrases, scope phrases, quantities with unit and
 * basis. Nothing here judges; `compare.ts` does. What is not recognised is
 * reported as such, so the comparison can fail closed on it.
 */

import {
  parsePhosphateUnit,
  toMgPerLitrePo4,
  type PhosphateUnit,
} from "@acropora/aquarium-calc";

import {
  normaliseText,
  splitWords,
  type Basis,
  type Term,
  type Vocabulary,
} from "./vocabulary.js";

export interface RecognisedQuantity {
  /** The text as written, e.g. "0,05 mg/l". */
  text: string;
  unit: PhosphateUnit;
  /** null when a mass unit has no recognisable basis (explicit or from a basis word). */
  basis: Basis | null;
  /** Normalised range, mg/l PO4; a single value has min = max. null when the basis is unknown. */
  minMgL: number | null;
  maxMgL: number | null;
}

export type NegationState = "AFFIRMATIVE" | "NEGATED" | "UNDECIDABLE";

export interface SentenceParts {
  taxa: string[];
  environments: string[];
  effects: string[];
  /** Directions of the recognised verbs, deduplicated (INCREASE, DECREASE, NEUTRAL). */
  verbDirections: string[];
  negation: NegationState;
  /** Why the negation could not be decided, when it could not. */
  negationReason: string | null;
  certainty: string[];
  scopePhrases: string[];
  unsupported: string[];
  quantities: RecognisedQuantity[];
  /** Numbers that are not part of a recognised quantity (a percentage, a year, an ambiguous "1,500"). */
  unrecognisedNumbers: string[];
}

interface Match<T extends Term> {
  term: T;
  start: number;
  length: number;
}

// Hungarian lengthens a stem-final a/e before a suffix: "Acropora" ->
// "Acroporák", "milleporán". The stem matches in both shapes.
const LENGTHENED: Readonly<Record<string, string>> = { a: "á", e: "é" };

function wordMatches(formWord: string, word: string, exact: boolean): boolean {
  if (exact || formWord.length <= 2) return word === formWord;
  if (word.startsWith(formWord)) return true;
  const long = LENGTHENED[formWord.slice(-1)];
  return (
    long !== undefined &&
    word.length > formWord.length &&
    word.startsWith(formWord.slice(0, -1) + long)
  );
}

/**
 * Longest-first, non-overlapping matches of one vocabulary kind. At each
 * position the form with more words wins, then the longer form.
 */
export function matchTerms<T extends Term>(
  words: readonly string[],
  terms: readonly T[],
): Match<T>[] {
  const matches: Match<T>[] = [];
  let i = 0;
  while (i < words.length) {
    let best: (Match<T> & { chars: number }) | null = null;
    for (const term of terms)
      for (const form of term.forms) {
        if (i + form.length > words.length) continue;
        if (!form.every((fw, k) => wordMatches(fw, words[i + k]!, term.exact)))
          continue;
        const chars = form.join(" ").length;
        if (
          best === null ||
          form.length > best.length ||
          (form.length === best.length && chars > best.chars)
        )
          best = { term, start: i, length: form.length, chars };
      }
    if (best !== null) {
      matches.push({ term: best.term, start: best.start, length: best.length });
      i += best.length;
    } else i += 1;
  }
  return matches;
}

const unique = <T>(xs: readonly T[]): T[] => [...new Set(xs)];

// Number forms: a decimal comma or point. Three digits after the separator
// with a non-zero integer part ("1,500") may be a thousands group, so it is
// ambiguous and not read (the JEV unit parser's rule).
const NUMBER = String.raw`\d+(?:[.,]\d+)?`;
const UNIT_SPELLINGS = [
  "µmol/l",
  "µmol/L",
  "μmol/l",
  "μmol/L",
  "umol/l",
  "umol/L",
  "µg/l",
  "µg/L",
  "μg/l",
  "μg/L",
  "ug/l",
  "ug/L",
  "mg/l",
  "mg/L",
  "µM",
  "μM",
  "uM",
  "ppm",
  "ppb",
].sort((a, b) => b.length - a.length);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const QUANTITY = new RegExp(
  `(?<![\\p{L}\\d.,])(${NUMBER})(?:\\s*[-–—]\\s*(${NUMBER}))?\\s*(${UNIT_SPELLINGS.map(escape).join("|")})` +
    `(?:-\\p{L}+)?(?:\\s*(PO4(?:³⁻|3-)?|PO₄(?:³⁻)?|P)(?![\\p{L}\\d]))?`,
  "gu",
);
// A number standing alone: not glued to a letter (PO4, H2O) and not inside another number.
const BARE_NUMBER = /(?<![\p{L}\d.,])\d+(?:[.,]\d+)*/gu;

function readNumber(raw: string): number | null {
  const m = /^(\d+)(?:[.,](\d+))?$/.exec(raw);
  if (!m) return null;
  const [, int = "", fraction] = m;
  if (fraction !== undefined && fraction.length === 3 && !/^0+$/.test(int))
    return null;
  return Number(fraction === undefined ? int : `${int}.${fraction}`);
}

// A subordinate clause: a comma followed by a subordinating conjunction.
const SUBORDINATE =
  /,\s*(?:hogy|ami|amely\p{L}*|aki|mert|mivel|míg|bár|de|ha)(?!\p{L})/u;

export function recogniseSentence(
  sentence: string,
  vocabulary: Vocabulary,
): SentenceParts {
  const text = sentence.normalize("NFC");
  const lower = normaliseText(text);
  const words = splitWords(lower);
  const keys = <T extends Term>(terms: readonly T[]) =>
    unique(matchTerms(words, terms).map((m) => m.term.key));

  // Negation: one negator outside any subordinate clause is a negation; more
  // than one, a negator next to a subordinate clause, or a contrast word
  // ("helyett") cannot be decided by rule.
  const negations = matchTerms(words, vocabulary.negations);
  const negators = negations.filter((m) => m.term.extra.role === "NEGATOR");
  const contrast = negations.filter((m) => m.term.extra.role === "UNDECIDABLE");
  let negation: NegationState = "AFFIRMATIVE";
  let negationReason: string | null = null;
  if (contrast.length > 0) {
    negation = "UNDECIDABLE";
    negationReason = `contrast construction "${words[contrast[0]!.start]}"`;
  } else if (negators.length > 1) {
    negation = "UNDECIDABLE";
    negationReason = `${negators.length} negators`;
  } else if (negators.length === 1) {
    if (SUBORDINATE.test(lower)) {
      negation = "UNDECIDABLE";
      negationReason = "a negator in a sentence with a subordinate clause";
    } else negation = "NEGATED";
  }

  // Quantities, then every number the quantities did not account for.
  const quantities: RecognisedQuantity[] = [];
  const unrecognisedNumbers: string[] = [];
  const covered: Array<[number, number]> = [];
  const basisWords = keys(vocabulary.basisWords);
  for (const m of text.matchAll(QUANTITY)) {
    const [whole, fromRaw = "", toRaw, unitRaw = "", basisRaw] = m;
    const start = m.index ?? 0;
    covered.push([start, start + whole.length]);
    const unit = parsePhosphateUnit(unitRaw);
    const from = readNumber(fromRaw);
    const to = toRaw === undefined ? from : readNumber(toRaw);
    if (unit === null || from === null || to === null || to < from) {
      unrecognisedNumbers.push(whole);
      continue;
    }
    let basis: Basis | null = null;
    if (basisRaw !== undefined) basis = basisRaw === "P" ? "P" : "PO4";
    else if (basisWords.length === 1) basis = basisWords[0] as Basis;
    const molar = unit === "µmol/l";
    const known = molar || basis !== null;
    const value = (v: number) =>
      toMgPerLitrePo4({ value: v, unit, basis: basis ?? "PO4" });
    quantities.push({
      text: whole.trim(),
      unit,
      basis,
      minMgL: known ? value(from) : null,
      maxMgL: known ? value(to) : null,
    });
  }
  for (const m of text.matchAll(BARE_NUMBER)) {
    const at = m.index ?? 0;
    if (!covered.some(([a, b]) => at >= a && at < b))
      unrecognisedNumbers.push(m[0]);
  }

  return {
    taxa: keys(vocabulary.taxa),
    environments: keys(vocabulary.environments),
    effects: keys(vocabulary.effects),
    verbDirections: unique(
      matchTerms(words, vocabulary.directionVerbs).map(
        (m) => m.term.extra.direction,
      ),
    ),
    negation,
    negationReason,
    certainty: keys(vocabulary.certainty),
    scopePhrases: keys(vocabulary.scopePhrases),
    unsupported: keys(vocabulary.unsupported),
    quantities,
    unrecognisedNumbers,
  };
}
